import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { fitnessService } from "@/server/fitness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/fitness/xunji-key —— 训记 apiKey 绑定状态（脱敏，【我的 → 训记同步】卡） */
export const GET = withModule("fitness", async (req, ctx) => {
  return NextResponse.json(await fitnessService.xunjiKeyInfo(ctx.user.id));
});

/** PUT /api/fitness/xunji-key { apiKey } —— 绑定/更新（先远端即时校验，坏 key 不落库） */
export const PUT = withModule("fitness", async (req, ctx) => {
  const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
  if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    throw ApiError.badRequest("apiKey 需为非空字符串");
  }
  const masked = await fitnessService.xunjiKeySave(ctx.user.id, body.apiKey);
  return NextResponse.json({ bound: true, ...masked });
});

/** DELETE /api/fitness/xunji-key —— 解绑（训记侧已写入的数据不受影响） */
export const DELETE = withModule("fitness", async (req, ctx) => {
  await fitnessService.xunjiKeyRemove(ctx.user.id);
  return NextResponse.json({ bound: false });
});
