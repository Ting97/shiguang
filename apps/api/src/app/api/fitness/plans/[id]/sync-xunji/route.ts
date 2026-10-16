import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/[id]/sync-xunji —— 计划双写训记 App（用户点按钮即确认；二次同步走更新防重复）。
 * REQ-023：无 body 首次同步——遇目录外动作名返回 {needsConfirmation, unmatched:[{name,candidates}]};
 * 带 {mappings:{拾光名:官方名}, skips:[跳过动作]} 的确认调用——映射入每用户别名表后执行同步 */
export const POST = withAuthParams(async (req, ctx) => {
  const { id } = await ctx.params;
  let confirm: { mappings?: Record<string, string>; skips?: string[] } | undefined;
  try {
    const body = (await req.json()) as { mappings?: Record<string, string>; skips?: string[] } | null;
    if (body && (body.mappings !== undefined || body.skips !== undefined)) confirm = body;
  } catch {
    // 无 body（首次同步）合法
  }
  return NextResponse.json(await fitnessService.syncPlanToXunji(ctx.user.id, String(id), undefined, confirm));
});
