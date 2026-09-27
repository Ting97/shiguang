import { NextRequest, NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { syncBitget } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/trading/bitget/sync —— 拉取 CFD 数据：{login?, from, to, dryRun?, scope?}；
 * scope self=本账户（自主+跟单镜像）/ trader=带单仓位 / all=两者（docs/16 场景 A/B） */
export const POST = withModule("trading", async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as {
    login?: string;
    nickname?: string;
    from?: string;
    to?: string;
    dryRun?: boolean;
    scope?: "self" | "trader" | "all";
  };
  return NextResponse.json(
    await syncBitget(user.id, {
      login: body.login,
      nickname: body.nickname,
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
      dryRun: body.dryRun,
      scope: body.scope,
    }),
  );
});
