import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/[id]/sync-xunji —— 计划双写训记 App（用户点按钮即确认；二次同步走更新防重复）。
 * REQ-023：无 body 首次同步——遇目录外动作名返回 {needsConfirmation, unmatched:[{name,candidates}]};
 * 带 {mappings:{拾光名:官方名}, skips:[跳过动作]} 的确认调用——映射入每用户别名表后执行同步 */
export const POST = withModuleParams("fitness", async (req, ctx) => {
  // REQ-042：写入用户自己绑定的训记账号（service 层校验绑定）——不再部署级运营者账号，无需 admin 收口
  const { id } = await ctx.params;
  assertUuidParam(id, "id"); // 缺预检时畸形 id 直落 PG 22P02 → 500（同文件 PATCH/DELETE 已有，十四轮补齐）
  let confirm: { mappings?: Record<string, string>; skips?: string[] } | undefined;
  try {
    const body = (await readJsonCapped(req) as any) as { mappings?: Record<string, string>; skips?: string[] } | null;
    if (body && (body.mappings !== undefined || body.skips !== undefined)) {
      // 值类型收口：目录快照为空时映射值会直落 unnest($::text[])，非字符串 → PG 22P03 → 500
      const bad =
        body.mappings !== undefined &&
        (typeof body.mappings !== "object" ||
          body.mappings === null ||
          Object.entries(body.mappings).some(([k, v]) => typeof k !== "string" || k.length > 40 || typeof v !== "string" || v.length > 40));
      if (bad) throw ApiError.badRequest("mappings 需为 {拾光动作名: 训记官方名} 的字符串映射");
      if (body.skips !== undefined && (!Array.isArray(body.skips) || body.skips.some((s) => typeof s !== "string" || s.length > 40)))
        throw ApiError.badRequest("skips 需为动作名数组");
      confirm = body;
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // 无 body（首次同步）合法
  }
  return NextResponse.json(await fitnessService.syncPlanToXunji(ctx.user.id, String(id), undefined, confirm));
});
