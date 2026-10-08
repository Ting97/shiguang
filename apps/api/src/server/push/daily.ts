/**
 * 每日提醒推送（REQ-009 9-D）：patrol tick 内调用，北京时间 PUSH_DAILY_HOUR（默认 9，config 集中读）
 * 点后每天最多一次（内存标记节流，单实例部署口径）。
 * 数据源与 GET /api/reminders 同源（contacts 生日/纪念日 + todos 到期未完成），另含
 * 久未联系的重要联系人（importance>=4 且 30 天无往来；农历生日经 @shiguangri/shared/lunar 换算）。
 * 投递走 Expo push API（exp.host，不装 expo-server-sdk，直接 fetch，body {to,title,body}），
 * 单条失败静默记日志；用户无启用 token 自然跳过。
 */
import { pool } from "@/server/platform/db";
import { loadConfig } from "@/server/platform/config";
import { log } from "@/server/platform/http/logger";
import { bjToday } from "@shiguangri/shared/date";
import { lunarBirthdayCountdown } from "@shiguangri/shared/lunar";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** 久未联系阈值（天）：重要联系人（importance>=4）超过该天数无往来提醒 */
const STALE_DAYS = 30;
/** 到期待办只追近 3 天内到期的：更早的过期项不重复打扰（工作台横幅仍完整可见） */
const DUE_LOOKBACK_DAYS = 3;

/** 内存节流：已跑成功的北京日期串（YYYY-MM-DD）；空串 = 本日尚未跑 */
let lastRunDate = "";

/** 北京当前小时（UTC getter + 8h，禁用本地 getHours——AGENTS 代码规范） */
function bjHour(): number {
  return Number(new Date(Date.now() + 8 * 3600_000).toISOString().slice(11, 13));
}

/** 单条 Expo push 投递；失败静默记日志（推送是增强路径，绝不抛出打断巡检） */
async function expoPushSend(to: string, title: string, body: string): Promise<void> {
  try {
    const r = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      // 无超时时上游挂起可吊满 undici 默认 300s/token，逐 token 串行会把当日推送与巡检 tick 拖垮
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, title, body }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      log.warn({ status: r.status, detail: detail.slice(0, 200) }, "daily-push-send-failed");
    }
  } catch (e) {
    log.warn({ err: String(e).slice(0, 120) }, "daily-push-send-error");
  }
}

interface ReminderCounts {
  dueTodos: number;
  birthdays: number;
  anniversaries: number;
  staleContacts: number;
}

function summarize(c: ReminderCounts): string | null {
  const parts: string[] = [];
  if (c.dueTodos > 0) parts.push(`📋 ${c.dueTodos} 条待办今日到期`);
  if (c.birthdays > 0) parts.push(`🎂 今天 ${c.birthdays} 个生日`);
  if (c.anniversaries > 0) parts.push(`💕 今天 ${c.anniversaries} 个纪念日`);
  if (c.staleContacts > 0) parts.push(`💬 ${c.staleContacts} 位重要的人久未联系（${STALE_DAYS} 天）`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * 每日提醒扫描 + 推送。到点（hour >= pushDailyHour）且今天未跑过才执行；
 * 扫描级失败回滚今日标记（下个 tick 重试），投递级失败不重试（避免重复打扰）。
 */
export async function runDailyReminderPush(): Promise<void> {
  const { pushDailyHour } = loadConfig();
  const today = bjToday();
  if (bjHour() < pushDailyHour || lastRunDate === today) return;
  lastRunDate = today; // 先占位：同一实例本日只跑一轮

  try {
    const bj = today; // 北京今天 YYYY-MM-DD（UTC getter + 8h 口径，与 shared/date 一致）
    // 到期待办：pending 且 due_at < 北京今日 24 点。旧版 `date_trunc('day', now()+8h)` 按
    // 会话时区（生产 UTC）截断，边界=北京次日 08:00——次日 0-8 点到期的待办全被误报「今日到期」；
    // 改 `at time zone 'Asia/Shanghai'` 显式北京日界（与 /api/today 同范式）
    const dueRes = pool.query<{ user_id: string; n: number }>(
      `select t.user_id, count(*)::int as n
       from todos t
       where t.status = 'pending'
         and t.due_at is not null
         and t.due_at < (date_trunc('day', now() at time zone 'Asia/Shanghai') + interval '1 day') at time zone 'Asia/Shanghai'
         and t.due_at > now() - make_interval(days => $1)
       group by t.user_id`,
      [DUE_LOOKBACK_DAYS],
    );
    // 生日/纪念日联系人：与 GET /api/reminders 同一查询（全量捞，生日判定在 JS 侧做农历换算）
    const contactRes = pool.query<{
      user_id: string;
      name: string;
      birthday: string | null;
      birthday_cal: string;
      lunar_month: number | null;
      lunar_day: number | null;
      lunar_leap: boolean | null;
      anniversary: string | null;
    }>(
      `select user_id, name,
              to_char(birthday, 'YYYY-MM-DD') as birthday,
              birthday_cal, lunar_month, lunar_day, lunar_leap,
              to_char(anniversary, 'YYYY-MM-DD') as anniversary
       from contacts
       where birthday is not null or anniversary is not null
         or (birthday_cal = 'lunar' and lunar_month is not null and lunar_day is not null)`,
    );
    // 久未联系：重要联系人（importance>=4）最近一次往来（无往来按建档时间）早于阈值
    const staleRes = pool.query<{ user_id: string; n: number }>(
      `select c.user_id, count(*)::int as n
       from contacts c
       left join (
         select contact_id, max(coalesce(occurred_at, created_at)) as last_at
         from interactions
         group by contact_id
       ) last_i on last_i.contact_id = c.id
       where c.importance >= 4
         and coalesce(last_i.last_at, c.created_at) < now() - make_interval(days => $1)
       group by c.user_id`,
      [STALE_DAYS],
    );
    const [{ rows: dueRows }, { rows: contactRows }, { rows: staleRows }] = await Promise.all([dueRes, contactRes, staleRes]);

    // 按用户聚合（Map 保序，输出稳定）
    const byUser = new Map<string, ReminderCounts>();
    const ensure = (uid: string) => {
      let c = byUser.get(uid);
      if (!c) {
        c = { dueTodos: 0, birthdays: 0, anniversaries: 0, staleContacts: 0 };
        byUser.set(uid, c);
      }
      return c;
    };
    for (const r of dueRows) ensure(r.user_id).dueTodos = Number(r.n);
    for (const r of staleRows) ensure(r.user_id).staleContacts = Number(r.n);
    for (const r of contactRows) {
      const isSolarBirthdayToday = r.birthday != null && r.birthday.slice(5) === bj.slice(5);
      const isLunarBirthdayToday =
        r.birthday_cal === "lunar" &&
        r.lunar_month != null &&
        r.lunar_day != null &&
        lunarBirthdayCountdown({ month: r.lunar_month, day: r.lunar_day, leap: r.lunar_leap === true }) === 0;
      const isAnniversaryToday = r.anniversary != null && r.anniversary.slice(5) === bj.slice(5);
      const c = ensure(r.user_id);
      if (isSolarBirthdayToday || isLunarBirthdayToday) c.birthdays += 1;
      if (isAnniversaryToday) c.anniversaries += 1;
    }

    // 无任何提醒的用户剔除
    const targets = [...byUser.entries()].filter(([, c]) => summarize(c) != null);
    if (targets.length === 0) return;

    // 取启用中的推送 token（一台设备一个 token；同一用户多设备各发一条）
    const { rows: tokenRows } = await pool.query<{ user_id: string; token: string }>(
      `select user_id, token from device_tokens where enabled and user_id = any($1::uuid[])`,
      [targets.map(([uid]) => uid)],
    );
    if (tokenRows.length === 0) return;

    let sent = 0;
    for (const row of tokenRows) {
      const body = summarize(byUser.get(row.user_id)!);
      if (!body) continue;
      await expoPushSend(row.token, "拾光 · 今日提醒", body);
      sent += 1;
    }
    log.info({ users: targets.length, sent }, "daily-push");
  } catch (e) {
    // 扫描级失败：回滚今日标记，下个 tick（5 分钟后）重试
    lastRunDate = "";
    log.warn({ err: String(e).slice(0, 120) }, "daily-push-scan-error");
  }
}
