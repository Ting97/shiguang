import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { importDebtsPreview, importDebtsCommit, type ImportPayload } from "@/server/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 与 trading 导入 50000 笔上限同思路：负债导入行数上限（防畸形超大 body 打爆事务） */
const MAX_LIABILITIES = 5000;

/**
 * POST /api/debts/import —— R2 负债数据迁移导入（REQ-005 FR-2.x）
 * body {dryRun, data:{liabilities[], accounts[]}}：dryRun 逐行判重 + 对账摘要；commit 事务写入（仅 create 行）
 */
export const POST = withModule("debt", async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; data?: ImportPayload };
  if (!body.data) throw new ApiError(400, "invalid_input", "data 缺失");
  const rowCount = Array.isArray(body.data.liabilities) ? body.data.liabilities.length : 0;
  if (rowCount > MAX_LIABILITIES) {
    throw new ApiError(400, "invalid_input", `单次导入上限 ${MAX_LIABILITIES} 行（当前 ${rowCount} 行）`);
  }
  if (body.dryRun) return NextResponse.json(await importDebtsPreview(user.id, body.data));
  return NextResponse.json(await importDebtsCommit(user.id, body.data));
});
