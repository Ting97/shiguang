import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isValidYearMonth, assertUuidParam } from "@/server/platform/http/validate";
import { reserveOverview, setReserveCheck } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/debts/reserve?ym=YYYY-MM —— R3 当月应还清单（按账户合并）+ 勾选 + 储蓄覆盖（FR-3.1~3.3） */
export const GET = withModule("debt", async (req, { user }) => {
  const ym = new URL(req.url).searchParams.get("ym") ?? "";
  // 仅验形状会放行 2025-13 → 落 date 列 500：月份需在 01-12
  if (!isValidYearMonth(ym)) throw new ApiError(400, "invalid_input", "ym 需为 YYYY-MM（月份 01-12）");
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
  if (!isValidYearMonth(body.ym)) throw new ApiError(400, "invalid_input", "ym 需为 YYYY-MM（月份 01-12）");
  if (typeof body.checked !== "boolean") throw new ApiError(400, "invalid_input", "checked 必填");
  if (body.liabilityId !== undefined) assertUuidParam(body.liabilityId, "liabilityId"); // 非法 uuid 落 SQL 会 22P02 → 500
  return NextResponse.json(
    await setReserveCheck(user.id, body as { ym: string; liabilityId?: string; all?: boolean; checked: boolean }),
  );
});
