import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthSchema } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { getModule } from "@shiguangri/shared/modules";
import { resolveUserModules, invalidateModuleCache } from "@/server/platform";
import { pool } from "@/server/platform/db";
import { writeAuditRecord } from "@/server/ai";
import { me } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  module: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * PATCH /api/auth/module-prefs {module, enabled} —— 【我的】→功能管理 的用户自选开关（REQ-028）。
 * 校验链（任一不过 403，与有效态计算同口径）：key ∈ 注册表 → 非 core → 开关可见可拨
 * （controllable 已涵盖「全局开+无强制+可见性真」）→ 父域链有效开。
 * upsert user_module_prefs → 失效缓存 → 返回新 me()（前端直接 setUser 即时显隐）。
 */
export const PATCH = withAuthSchema(bodySchema, async (req, { user, valid }) => {
  const { module, enabled } = valid;
  if (user.role === "admin") {
    throw ApiError.forbidden("管理员账号全模块直通，无需自选开关");
  }
  const def = getModule(module);
  if (!def) throw ApiError.badRequest("模块不存在");
  const resolved = await resolveUserModules(user);
  const self = resolved.prefs.find((p) => p.key === module);
  if (!self) throw ApiError.badRequest("模块不存在");
  if (!self.controllable) {
    throw ApiError.forbidden("该模块由系统或管理员管控，不可自选开关");
  }
  if (def.parent) {
    const parent = resolved.prefs.find((p) => p.key === def.parent);
    if (parent && !parent.effective) {
      throw ApiError.forbidden("请先开启上级模块");
    }
  }

  await pool.query(
    `insert into user_module_prefs (user_id, module, enabled)
     values ($1,$2,$3)
     on conflict (user_id, module) do update set enabled = excluded.enabled, updated_at = now()`,
    [user.id, module, enabled],
  );
  invalidateModuleCache(user.id);
  void writeAuditRecord({
    userId: user.id,
    stage: "module_prefs",
    model: null,
    ok: true,
    error: `module=${module} enabled=${enabled}`,
  });
  return NextResponse.json(await me(user));
});
