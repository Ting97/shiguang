import { NextResponse } from "next/server";
import { pool, findOverlap, overlapError } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";

export const runtime = "nodejs";

/** POST /api/blocks —— 手动创建时间块（日视图缺口补录）；不允许与已有日程重叠 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    startAt?: string;
    endAt?: string;
    activityId?: string;
  };
  if (!body.title?.trim() || !body.startAt || !body.endAt || !body.activityId) {
    return NextResponse.json({ error: "标题、起止时间、类别均必填" }, { status: 400 });
  }
  const conflict = await findOverlap(user.id, body.startAt, body.endAt);
  if (conflict) {
    return NextResponse.json({ error: overlapError(conflict), conflict }, { status: 409 });
  }
  try {
    const block = (
      await pool.query(
        `insert into time_blocks (user_id, activity_id, title, start_at, end_at, time_mode, source)
         values ($1,$2,$3,$4,$5,'manual','manual') returning *`,
        [user.id, body.activityId, body.title.trim(), body.startAt, body.endAt],
      )
    ).rows[0];
    return NextResponse.json({ block });
  } catch (e) {
    const msg = String(e);
    if (msg.includes("time_blocks_check") || msg.includes("end_at_start_at")) {
      return NextResponse.json({ error: "结束时间必须晚于开始时间" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
