import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reminders —— 工作台横幅数据源（W12 提醒推送）
 * - 有生日/纪念日的联系人（date 用 to_char 转字符串，防 pg date 被 node-pg 序列化成 UTC ISO 差一天）
 * - remind_at 已到、仍未完成的待办（创建待办时 remind_at = due - 15 分钟）
 * 条目筛选/排序由 lib/reminders.pickReminders 完成
 */
export const GET = withAuth(async (_req, { user }) => {
  const { rows: contacts } = await pool.query(
    `select id, name,
            to_char(birthday, 'YYYY-MM-DD') as birthday,
            birthday_cal, lunar_month, lunar_day, lunar_leap,
            to_char(anniversary, 'YYYY-MM-DD') as anniversary
     from contacts
     where user_id = $1
       and (birthday is not null or anniversary is not null
            or (birthday_cal = 'lunar' and lunar_month is not null and lunar_day is not null))`,
    [user.id],
  );
  const { rows: todos } = await pool.query(
    `select id, title, due_at, remind_at
     from todos
     where user_id = $1 and status = 'pending' and remind_at is not null and remind_at <= now()
     order by due_at asc nulls last`,
    [user.id],
  );

  return NextResponse.json({ contacts, todos });
});
