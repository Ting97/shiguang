import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { reserveOverview, setReserveCheck } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debts/reserve?ym=YYYY-MM —— R3 当月应还清单（按账户合并）+ 勾选 + 储蓄覆盖（FR-3.1~3.3） */
export const GET = withModule("debt", async (req, { user }) => {
  const ym = new URL(req.url).searchParams.get("ym") ?? "";
  return NextResponse.json(await reserveOverview(user.id, ym));
});

/** PUT /api/debts/reserve —— 勾选备付：{ym, liabilityId, checked} 单项 或 {ym, all, checked} 一键（FR-3.2） */
export const PUT = withModule("debt", async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as {
    ym?: string;
    liabilityId?: string;
    all?: boolean;
    checked?: boolean;
  };
  if (!body.ym || !/^\d{4}-\d{2}$/.test(body.ym)) throw new ApiError(400, "invalid_input", "ym 需为 YYYY-MM");
  if (typeof body.checked !== "boolean") throw new ApiError(400, "invalid_input", "checked 必填");
  return NextResponse.json(
    await setReserveCheck(user.id, body as { ym: string; liabilityId?: string; all?: boolean; checked: boolean }),
  );
});
