import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 按指定密钥拉取 CFD 资金流水归组成 trades；
 * {keyLabel?, login?, nickname?, from?, to?, dryRun?}。from 缺省=增量（最后平仓日-1 天，只翻几页）；
 * 每行流水一笔平仓成交，全量翻页后在窗口（北京日历日）内过滤入库，不同密钥落各自交易账号 */
export const POST = withModule("trading", async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as {
    keyLabel?: string;
    login?: string;
    nickname?: string;
    from?: string;
    to?: string;
    dryRun?: boolean;
  };
  return NextResponse.json(
    await syncBitget(user.id, {
      keyLabel: body.keyLabel,
      login: body.login,
      nickname: body.nickname,
      from: body.from ? String(body.from) : undefined,
      to: body.to ? String(body.to) : undefined,
      dryRun: body.dryRun,
    }),
  );
});
