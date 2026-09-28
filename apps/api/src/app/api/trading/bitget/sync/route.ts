import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 拉取 UTA 合约成交明细 + CFD 流水归组成 trades；{login?, nickname?, from, to, dryRun?}。
 * 本账户单通道：自主交易、跟单镜像都在合约成交明细里；官方仅提供近 90 天数据，超出自动截断 */
export const POST = withModule("trading", async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { login?: string; nickname?: string; from?: string; to?: string; dryRun?: boolean };
  return NextResponse.json(
    await syncBitget(user.id, {
      login: body.login,
      nickname: body.nickname,
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
      dryRun: body.dryRun,
    }),
  );
});
