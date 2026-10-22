import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/platform/db";
import { withAdmin, withAdminSchema } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isUuid } from "@/server/platform/http/validate";
import { getModule } from "@shiguangri/shared/modules";
import { listUserModules, invalidateModuleCache } from "@/server/platform/modules";
import { writeAuditRecord } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HINT = "受控模块见 /api/admin/modules 注册表";

/** GET /api/admin/grants —— 按用户覆盖矩阵（REQ-028：user_module_controls 全量 + 旧表兼容读）。
 *  旧 user_module_grants 已停写（063 搬为强制开），无 controls 行的旧授权仍会被搬出，
 *  故 GET 只读 controls 即为权威视图。 */
export const GET = withAdmin(async () => {
  const { rows } = await pool.query(
    `select user_id, module, force_state, switch_visible, updated_by, updated_at
     from user_module_controls order by updated_at desc`,
    [],
  );
  return NextResponse.json({ grants: rows });
});

const postSchema = z.object({
  userId: z.string().min(1),
  module: z.string().min(1),
  /** 强制态：on/off/null（null=清除强制，跟随上层） */
  force_state: z.enum(["on", "off"]).nullable().optional(),
  /** 开关可见性：boolean/null（null=清除覆盖，跟随全局 user_toggleable） */
  switch_visible: z.boolean().nullable().optional(),
});

/** POST /api/admin/grants {userId, module, force_state?, switch_visible?} —— 写按用户覆盖（REQ-028 三态化）。
 *  维度语义：undefined=不改动；null=清除该维度（跟随上层）；"on"/"off"/boolean=设置。
 *  两维度全缺省=兼容旧「授权」语义（强制开）；清除后两维度皆空=删行。
 *  core 模块不可覆盖；写后失效该用户缓存即时生效；审计。
 *  管理员写门禁（withAdminSchema）：按用户覆盖可绕过受控模块商业门禁，普通用户 403。 */
export const POST = withAdminSchema(postSchema, async (req, { user, valid }) => {
  const { userId, module, force_state, switch_visible } = valid;
  const def = getModule(module);
  if (!def) throw ApiError.badRequest(`module 不在注册表（${HINT}）`);
  if (!isUuid(userId)) throw ApiError.badRequest("userId 参数不合法");
  if (def.core) throw ApiError.forbidden("核心模块不可设置覆盖");
  const exists = await pool.query(`select 1 from profiles where id = $1`, [userId]);
  if (!exists.rows[0]) throw ApiError.notFound("用户不存在");

  const isLegacyGrant = force_state === undefined && switch_visible === undefined;
  let nextForce: "on" | "off" | null;
  let nextVisible: boolean | null;
  if (isLegacyGrant) {
    nextForce = "on";
    nextVisible = null;
  } else {
    const cur = await pool.query(
      `select force_state, switch_visible from user_module_controls where user_id = $1 and module = $2`,
      [userId, module],
    );
    const curForce = (cur.rows[0]?.force_state as "on" | "off" | null | undefined) ?? null;
    const curVisible = (cur.rows[0]?.switch_visible as boolean | null | undefined) ?? null;
    nextForce = force_state === undefined ? curForce : force_state;
    nextVisible = switch_visible === undefined ? curVisible : switch_visible;
  }

  if (nextForce === null && nextVisible === null) {
    await pool.query(`delete from user_module_controls where user_id = $1 and module = $2`, [
      userId,
      module,
    ]);
  } else {
    await pool.query(
      `insert into user_module_controls (user_id, module, force_state, switch_visible, updated_by)
       values ($1,$2,$3,$4,$5)
       on conflict (user_id, module) do update set
         force_state = excluded.force_state, switch_visible = excluded.switch_visible,
         updated_by = excluded.updated_by, updated_at = now()`,
      [userId, module, nextForce, nextVisible, user.id],
    );
  }
  invalidateModuleCache(userId);
  void writeAuditRecord({
    userId: user.id,
    stage: "module_admin",
    model: null,
    ok: true,
    error: `grant user=${userId} module=${module} force=${String(nextForce)} visible=${String(nextVisible)}`,
  });
  return NextResponse.json({ ok: true, modules: await listUserModules(userId, "user") });
});

/** DELETE /api/admin/grants?userId=&module= —— 清除该用户该模块的全部覆盖（幂等） */
export const DELETE = withAdmin(async (req, { user }) => {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const module = searchParams.get("module");
  if (!userId || !module || !getModule(module)) {
    // ApiError 统一错误体（含 code，与 POST 同形状）：手写 NextResponse 缺 code，前端按 code 分支不一致
    throw ApiError.badRequest(`userId 与 module（${HINT}）必填`);
  }
  if (!isUuid(userId)) {
    throw ApiError.badRequest("userId 参数不合法");
  }
  await pool.query(`delete from user_module_controls where user_id = $1 and module = $2`, [
    userId,
    module,
  ]);
  invalidateModuleCache(userId);
  // 撤销覆盖与写入同口径审计（商业敏感权限操作不留痕与 POST 不对称——十四轮补齐）
  void writeAuditRecord({
    userId: user.id,
    stage: "module_admin",
    model: null,
    ok: true,
    error: `revoke user=${userId} module=${module}`,
  });
  return NextResponse.json({ ok: true });
});
