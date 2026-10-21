import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { chatService } from "@/server/chat";

export const runtime = "nodejs";

/** POST /api/chat/proposals/[id] —— A.5 确认卡处置（REQ-016）：
 * accept 在前端已成功保存业务数据（POST /api/fitness/plans）后回执；dismiss 直接放弃。 */
export const POST = withModuleParams("ai", async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  const body = (await readJsonCapped(req) as any) as { action?: string };
  if (body.action !== "accept" && body.action !== "dismiss") {
    return NextResponse.json({ error: "action 须为 accept 或 dismiss", code: "invalid_input" }, { status: 400 });
  }
  await chatService.resolveProposal(user.id, id, body.action);
  return NextResponse.json({ ok: true });
});
