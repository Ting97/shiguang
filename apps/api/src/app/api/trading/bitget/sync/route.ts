import { NextRequest, NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 按指定密钥拉取 CFD 资金流水归组成 trades；
 * {keyLabel?, login?, nickname?, from?, to?, dryRun?}。from 缺省=增量（最后平仓日-1 天，只翻几页）；
 * 每行流水一笔平仓成交，全量翻页后在窗口（北京日历日）内过滤入库，不同密钥落各自交易账号。
 * readJsonCapped：替代裸 req.json()，超大 body 413（keyLabel/login 类型由 service 层 optionalTrimmed 拦成 400） */
export const POST = withModule("trading", async (req: NextRequest, { user }) => {
  const body = (await readJsonCapped(req) as any) as {
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
