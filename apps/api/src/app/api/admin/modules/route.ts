import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin, withAdminSchema } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { MODULE_REGISTRY, getModule } from "@shiguangri/shared/modules";
import { invalidateModuleCache } from "@/server/platform";
import { pool } from "@/server/platform/db";
import { writeAuditRecord } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  module: z.string().min(1),
  enabled: z.boolean().optional(),
  user_toggleable: z.boolean().optional(),
});

/** GET /api/admin/modules —— 注册表 + module_states 合并视图（后台「模块」tab 数据源）。
 *  states 行缺失=未配置，以注册表 defaultOn/userToggleableDefault 兜底展示生效值；
 *  附每模块「按用户覆盖」计数（user_module_controls 引用数，提示管理员有个别覆盖在生效）。 */
export const GET = withAdmin(async () => {
  const [statesR, controlsR] = await Promise.all([
    pool.query(`select module, enabled, user_toggleable, updated_at from module_states`),
    pool.query(`select module, count(*)::int as n from user_module_controls group by module`),
  ]);
  const states = new Map(statesR.rows.map((r: { module: string }) => [r.module, r]));
  const controls = new Map(controlsR.rows.map((r: { module: string; n: number }) => [r.module, r.n]));
  const modules = MODULE_REGISTRY.map((def) => {
    const st = states.get(def.key) as
      | { enabled: boolean; user_toggleable: boolean; updated_at: string }
      | undefined;
    return {
      key: def.key,
      name: def.name,
      level: def.level,
      parent: def.parent ?? null,
      core: def.core ?? false,
      // 未配置时返回注册表默认（configured=false 标记后台显示「默认」）
      configured: Boolean(st),
      enabled: st ? st.enabled : def.defaultOn,
      userToggleable: st ? st.user_toggleable : def.userToggleableDefault,
      defaultEnabled: def.defaultOn,
      defaultUserToggleable: def.userToggleableDefault,
      userOverrides: controls.get(def.key) ?? 0,
      updatedAt: st?.updated_at ?? null,
    };
  });
  return NextResponse.json({ modules });
});

/** PATCH /api/admin/modules {module, enabled?, user_toggleable?} —— 全局层开关（REQ-028）。
 *  core 模块不可改；两维度全空=400。upsert module_states → 全清缓存（影响所有用户）→ 审计。
 *  管理员写门禁（withAdminSchema）：全局开关影响全站，普通用户 403。 */
export const PATCH = withAdminSchema(patchSchema, async (req, { user, valid }) => {
  const { module, enabled, user_toggleable } = valid;
  const def = getModule(module);
  if (!def) throw ApiError.badRequest("模块不存在");
  if (def.core) throw ApiError.forbidden("核心模块不可关闭");
  if (enabled === undefined && user_toggleable === undefined) {
    throw ApiError.badRequest("enabled 与 user_toggleable 至少传一项");
  }
  // 单语句 upsert + coalesce 兜底（二十轮）：旧版先读 cur 再算 next 的 read-modify-write，
  // 两管理员并发各改一个维度时后写者以陈旧值覆盖前者维度
  const { rows } = await pool.query(
    `insert into module_states (module, enabled, user_toggleable, updated_by)
     values ($1, coalesce($2, $3), coalesce($4, $5), $6)
     on conflict (module) do update set
       enabled = coalesce($2, module_states.enabled),
       user_toggleable = coalesce($4, module_states.user_toggleable),
       updated_by = excluded.updated_by, updated_at = now()
     returning enabled, user_toggleable`,
    [module, enabled ?? null, def.defaultOn, user_toggleable ?? null, def.userToggleableDefault, user.id],
  );
  const nextEnabled = rows[0].enabled;
  const nextToggleable = rows[0].user_toggleable;
  invalidateModuleCache(); // 全局层变更：全清
  void writeAuditRecord({
    userId: user.id,
    stage: "module_admin",
    model: null,
    ok: true,
    error: `module=${module} enabled=${nextEnabled} user_toggleable=${nextToggleable}`,
  });
  return NextResponse.json({ ok: true });
});
