import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { getBitgetKeysStatus, saveBitgetKeys, deleteBitgetKeys } from "@/server/finance";

export const runtime = "nodejs";

/** GET /api/trading/bitget/keys —— 已绑定密钥列表（逐把回掩码 key，不回明文） */
export const GET = withModule("trading", async (_req, { user }) =>
  NextResponse.json(await getBitgetKeysStatus(user.id)),
);

/** PUT /api/trading/bitget/keys —— 绑定/更新一把只读凭据 {label?, apiKey, apiSecret, passphrase}（加密落库） */
export const PUT = withModule("trading", async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;
  };
  return NextResponse.json(await saveBitgetKeys(user.id, body));
});

/** DELETE /api/trading/bitget/keys?label=xxx —— 解绑指定密钥；不带 label 解绑全部 */
export const DELETE = withModule("trading", async (req: NextRequest, { user }) => {
  const label = req.nextUrl.searchParams.get("label") ?? undefined;
  return NextResponse.json(await deleteBitgetKeys(user.id, label));
});
