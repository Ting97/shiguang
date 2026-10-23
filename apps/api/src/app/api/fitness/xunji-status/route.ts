import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/xunji-status —— 当前用户是否已绑定训记 apiKey（前端控制同步按钮显隐）。
 * REQ-042 起每用户自己绑定（不再部署级运营者账号）：非管理员绑定了同样可用 */
export const GET = withModule("fitness", async (req, ctx) => {
  return NextResponse.json(await fitnessService.xunjiEnabled(ctx.user.id));
});
