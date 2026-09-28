import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 拉取 CFD 资金流水归组成 trades；{login?, nickname?, from, to, dryRun?}。
 * 每行流水一笔平仓成交（XAUUSD 等差价合约）；全量翻页后在 from/to（北京日历日）窗口内过滤入库 */
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
