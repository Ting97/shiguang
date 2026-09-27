import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { getBitgetKeysStatus, saveBitgetKeys, deleteBitgetKeys } from "@/server/finance";

export const runtime = "nodejs";

/** GET /api/trading/bitget/keys —— 绑定状态（只回掩码 key） */
export const GET = withModule("trading", async (_req, { user }) =>
  NextResponse.json(await getBitgetKeysStatus(user.id)),
);

/** PUT /api/trading/bitget/keys —— 绑定/更新只读凭据 {apiKey, apiSecret, passphrase}（加密落库） */
export const PUT = withModule("trading", async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { apiKey?: string; apiSecret?: string; passphrase?: string };
  return NextResponse.json(await saveBitgetKeys(user.id, body));
});

/** DELETE /api/trading/bitget/keys —— 解绑 */
export const DELETE = withModule("trading", async (_req, { user }) =>
  NextResponse.json(await deleteBitgetKeys(user.id)),
);
