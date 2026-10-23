import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withModule } from "@/server/platform/http/route";
import { resolveUserModules } from "@/server/platform/modules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reminders —— 工作台横幅数据源（W12 提醒推送）
 * - 有生日/纪念日的联系人（date 用 to_char 转字符串，防 pg date 被 node-pg 序列化成 UTC ISO 差一天）
 * - remind_at 已到、仍未完成的待办（创建待办时 remind_at = due - 15 分钟）
 * 条目筛选/排序由 lib/reminders.pickReminders 完成
 * 模块门禁：路由整体挂在 people（联系人生日/纪念日），但到期待办属 goal 域——goal 关闭后
 * 横幅待办条目同口径剔除（与 push/daily 的逐模块清零互为镜像，十九轮对齐：旧版两出口口径相反）
 */
export const GET = withModule("people", async (_req, { user }) => {
  // 9-F：两查互不依赖，并行执行
  const [{ rows: contacts }, { rows: todos }, mods] = await Promise.all([
    pool.query(
      `select id, name,
              to_char(birthday, 'YYYY-MM-DD') as birthday,
              birthday_cal, lunar_month, lunar_day, lunar_leap,
              to_char(anniversary, 'YYYY-MM-DD') as anniversary
       from contacts
       where user_id = $1
         and (birthday is not null or anniversary is not null
              or (birthday_cal = 'lunar' and lunar_month is not null and lunar_day is not null))`,
      [user.id],
    ),
    pool.query(
      `select id, title, due_at, remind_at
       from todos
       where user_id = $1 and status = 'pending' and remind_at is not null and remind_at <= now()
       order by due_at asc nulls last`,
      [user.id],
    ),
    resolveUserModules(user).then(({ modules }) => new Set(modules)),
  ]);

  return NextResponse.json({ contacts, todos: mods.has("goal") ? todos : [] });
});
