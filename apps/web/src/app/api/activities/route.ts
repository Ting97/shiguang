import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/activities —— 全部分类 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { rows } = await pool.query(
    `select * from activities where user_id = $1 order by sort_order, created_at`,
    [user.id],
  );
  return NextResponse.json({ activities: rows });
}

/** POST /api/activities —— 新增自定义分类 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    color?: string;
    defaultMin?: number;
  };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "名称必填" }, { status: 400 });

  try {
    const created = (
      await pool.query(
        `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
         values (gen_random_uuid()::text, $1, $2, $3, $4, $5,
                 (select coalesce(max(sort_order), 0) + 1 from activities where user_id = $1), false)
         returning *`,
        [
          user.id,
          name,
          body.icon?.trim() || "🏷",
          /^#[0-9a-fA-F]{6}$/.test(body.color ?? "") ? body.color : "#64748b",
          Math.min(Math.max(body.defaultMin ?? 30, 5), 720),
        ],
      )
    ).rows[0];
    return NextResponse.json({ activity: created });
  } catch (e) {
    if (String(e).includes("activities_user_id_name_key")) {
      return NextResponse.json({ error: "已存在同名分类" }, { status: 400 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
