import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["day", "week", "month", "year"] as const;
const KEY_RE = /^\d{4}(-\d{2})?(-\d{2})?$/;

/**
 * GET /api/review?kind=day|week|month|year&period=… —— 只读返回已持久化的小结（不触发 LLM、不耗次数）。
 * period：day=YYYY-MM-DD / week=周一 YYYY-MM-DD（与 POST 缓存键一致）/ month=YYYY-MM / year=YYYY。
 * 无论缓存新旧都返回上次的小结（供卡片挂载时展示）；无则 review=null。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind") as (typeof KINDS)[number] | null;
  const period = searchParams.get("period");
  if (!kind || !KINDS.includes(kind) || !period || !KEY_RE.test(period)) {
    return NextResponse.json({ error: "kind/period 参数不合法" }, { status: 400 });
  }
  const { rows } = await pool.query(
    `select review, updated_at from review_caches where user_id = $1 and kind = $2 and period_key = $3`,
    [user.id, kind, period],
  );
  const row = rows[0];
  return NextResponse.json({
    review: row?.review ?? null,
    generatedAt: row?.updated_at ?? null,
  });
}
