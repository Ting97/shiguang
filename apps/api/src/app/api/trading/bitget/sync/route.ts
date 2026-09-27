import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 拉取 CFD 资金流水+历史订单归组成 trades；{login?, from, to, dryRun?} */
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
