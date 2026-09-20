import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/** POST /api/feed/:id/dismiss-conflict —— 关闭日程冲突警示条（服务端标记 reasonDismissed，多端持久） */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const { rowCount } = await pool.query(
    `update entry_recognitions
     set result = coalesce(result, '{}'::jsonb) || '{"reasonDismissed": true}'::jsonb
     where entry_id = $1 and user_id = $2 and domain = 'schedule'`,
    [id, user.id],
  );
  if (!rowCount) return NextResponse.json({ error: "无冲突提示可关闭" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
