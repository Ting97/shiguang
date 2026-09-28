import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 拉取 CFD 资金流水+成交历史归组成 trades；{login?, from, to, dryRun?}。
 * 本账户单通道：自主交易、跟单镜像、带单仓位都在这份流水里（Bitget CFD 无独立带单端点） */
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
