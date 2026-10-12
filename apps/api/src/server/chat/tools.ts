/**
 * chat 域只读工具注册表（REQ-015 批次 A）——AI 对话助手的数据查询面。
 * - 协议无关：ChatTool = {name, description, params(zod), execute(ctx, params)}，
 *   与 packages/ai 的 AgentToolSpec、未来 MCP registerTool 同构（批次 D 包 MCP 端点零改动复用）
 * - 只读：全部为白名单参数化 SELECT，SQL 只允许 $n 占位符，一律强制 user_id 过滤（越权防线）
 * - 跨域读表集中登记于 CHAT_READABLE_TABLES（照 insight 域 CQRS 读模型模式；写操作永远禁止）
 * - 金额返回「分」整数（AGENTS 代码规范），由模型按提示词约定换算为元表述
 */
import { z } from "zod";
import { pool } from "@/server/platform/db";
import { bjAddDays, bjMondayOf, bjToday } from "@shiguangri/shared/date";
import type { AgentToolSpec } from "@shiguangri/ai";

/** chat 域跨域只读表清单（依赖规则同 insight 域：新增跨域读先登记） */
export const CHAT_READABLE_TABLES = [
  "time_blocks",
  "activities",
  "todos",
  "goal_spaces",
  "transactions",
  "contacts",
  "interactions",
  "entries",
  "review_caches",
  "user_ai_profiles",
] as const;

/** 工具执行上下文：会话属主（所有查询的强制过滤条件） */
export interface ChatToolCtx {
  userId: string;
}

export interface ChatTool {
  name: string;
  description: string;
  params: z.ZodType<Record<string, unknown>>;
  execute: (ctx: ChatToolCtx, params: Record<string, unknown>) => Promise<unknown>;
}

// ---- 公共构件 ----

/** 北京日期串（YYYY-MM-DD）校验：合法日历日 + 不早于 2020 年（挡脏输入，非业务约束） */
const bjDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期须为 YYYY-MM-DD").refine(
  (s) => {
    const d = new Date(`${s}T00:00:00+08:00`);
    return !Number.isNaN(d.getTime()) && s >= "2020-01-01";
  },
  { message: "日期不合法" },
);

/** 北京某日 00:00 的 timestamptz 串（UTC getter + 8h 之外的时区安全写法：直接拼 +08:00 偏移） */
const bjDayStart = (d: string) => `${d}T00:00:00+08:00`;

/** 区间守卫：from ≤ to 且跨度 ≤ 366 天；返回 [起, 止+1日) 的左闭右开 timestamptz 串对 */
function rangeOf(from: string, to: string): [string, string] {
  if (from > to) throw new Error("开始日期晚于结束日期");
  const spanMs = new Date(`${to}T00:00:00+08:00`).getTime() - new Date(`${from}T00:00:00+08:00`).getTime();
  if (spanMs > 366 * 86_400_000) throw new Error("查询区间不能超过一年");
  const next = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86_400_000);
  const nextStr = next.toISOString().slice(0, 10);
  return [bjDayStart(from), bjDayStart(nextStr)];
}

/** 明细行在北京时区的 MM-DD HH:MI 展示串（避免模型自行做时区换算出错） */
const bjTs = (col: string) => `to_char(${col} at time zone 'Asia/Shanghai', 'MM-DD HH24:MI')`;

// ---- 8 个只读工具 ----

const queryTimeBlocks: ChatTool = {
  name: "query_time_blocks",
  description: "查询时间块（日程/已发生的事）：按北京日期区间统计各类活动投入时长，并返回最近明细。适用：这周/某段时间在忙什么、某类活动（工作/健身/睡眠…）花了多少时间。",
  params: z.object({
    from: bjDate.describe("开始日期（含），北京时间"),
    to: bjDate.describe("结束日期（含），北京时间"),
  }),
  async execute(ctx, p) {
    const { from, to } = p as { from: string; to: string };
    const [start, end] = rangeOf(from, to);
    const { rows: byActivity } = await pool.query(
      `select a.name as activity, count(*)::int as blocks, sum(b.duration_min)::int as minutes
       from time_blocks b join activities a on a.id = b.activity_id
       where b.user_id = $1 and b.start_at >= $2 and b.start_at < $3
       group by a.name order by minutes desc nulls last`,
      [ctx.userId, start, end],
    );
    const { rows: detail } = await pool.query(
      `select b.title, a.name as activity, ${bjTs("b.start_at")} as start_bj, b.duration_min as minutes
       from time_blocks b join activities a on a.id = b.activity_id
       where b.user_id = $1 and b.start_at >= $2 and b.start_at < $3
       order by b.start_at desc limit 10`,
      [ctx.userId, start, end],
    );
    return { range: { from, to }, byActivity, detail };
  },
};

const queryTransactions: ChatTool = {
  name: "query_transactions",
  description: "查询收支流水（仅已确认流水，不含待确认草稿）：按北京日期区间汇总支出/收入与分类构成。适用：这周/这个月花了多少、哪类花销最多。",
  params: z.object({
    from: bjDate.describe("开始日期（含），北京时间"),
    to: bjDate.describe("结束日期（含），北京时间"),
  }),
  async execute(ctx, p) {
    const { from, to } = p as { from: string; to: string };
    const [start, end] = rangeOf(from, to);
    const { rows: totals } = await pool.query(
      `select direction, sum(amount_cents)::bigint as cents, count(*)::int as n
       from transactions
       where user_id = $1 and occurred_at >= $2 and occurred_at < $3 and not is_draft
       group by direction`,
      [ctx.userId, start, end],
    );
    const { rows: byCategory } = await pool.query(
      `select category, sum(amount_cents)::bigint as cents, count(*)::int as n
       from transactions
       where user_id = $1 and occurred_at >= $2 and occurred_at < $3 and not is_draft and direction = 'out'
       group by category order by cents desc limit 8`,
      [ctx.userId, start, end],
    );
    const { rows: detail } = await pool.query(
      `select category, counterparty, direction, amount_cents::bigint as cents, ${bjTs("occurred_at")} as occurred_bj
       from transactions
       where user_id = $1 and occurred_at >= $2 and occurred_at < $3 and not is_draft
       order by occurred_at desc limit 10`,
      [ctx.userId, start, end],
    );
    // 金额单位统一「分」（整数）——提示词已约定模型表述时换算为元
    return { range: { from, to }, totals, byCategory, detail, centsUnit: "分（1元=100分）" };
  },
};

const queryTodos: ChatTool = {
  name: "query_todos",
  description: "查询待办与行动：默认查未完成的（含到期/过期/今日标记/重要），可指定只看到期未完成或已完成的。适用：我有什么待办、什么过期了、最近完成了什么。",
  params: z.object({
    view: z.enum(["open", "due_soon", "done_recent"]).default("open").describe(
      "open=全部未完成；due_soon=7 天内到期（含已过期）的未完成；done_recent=最近 14 天已完成",
    ),
    limit: z.number().int().min(1).max(30).default(20).describe("返回条数上限"),
  }),
  async execute(ctx, p) {
    const { view, limit } = p as { view: "open" | "due_soon" | "done_recent"; limit: number };
    const common = `from todos t left join goal_spaces s on s.id = t.space_id
       where t.user_id = $1`;
    if (view === "done_recent") {
      const { rows } = await pool.query(
        `select t.title, t.kind, s.name as space, t.is_important, ${bjTs("t.done_at")} as done_bj
         ${common} and t.status = 'done' and t.done_at >= now() - interval '14 days'
         order by t.done_at desc limit $2`,
        [ctx.userId, limit],
      );
      return { view, items: rows };
    }
    const dueFilter = view === "due_soon" ? " and (t.due_at is not null and t.due_at < now() + interval '7 days')" : "";
    const { rows } = await pool.query(
      `select t.title, t.kind, s.name as space, t.is_important, t.repeat_daily,
              case when t.due_at is null then null else ${bjTs("t.due_at")} end as due_bj,
              case when t.due_at is not null and t.due_at < now() then true else false end as overdue
       ${common} and t.status = 'pending'${dueFilter}
       order by t.is_important desc, t.due_at asc nulls last, t.created_at asc limit $2`,
      [ctx.userId, limit],
    );
    return { view, items: rows };
  },
};

const queryContacts: ChatTool = {
  name: "query_contacts",
  description: "查询联系人档案：可只看重要（importance≥4）且近期（30 天）无往来的「久未联系」名单。适用：我该联系谁了、有哪些重要的人。",
  params: z.object({
    staleOnly: z.boolean().default(false).describe("true=只看 importance≥4 且近 30 天无往来的人"),
    limit: z.number().int().min(1).max(30).default(20).describe("返回条数上限"),
  }),
  async execute(ctx, p) {
    const { staleOnly, limit } = p as { staleOnly: boolean; limit: number };
    const { rows } = await pool.query(
      `select c.name, c.group_tag, c.importance, c.intimacy,
              (select max(i.occurred_at) from interactions i where i.contact_id = c.id) as last_interaction
       from contacts c
       where c.user_id = $1
         and ($2 = false or (
           c.importance >= 4
           and coalesce((select max(i.occurred_at) from interactions i where i.contact_id = c.id), c.created_at) < now() - interval '30 days'
         ))
       order by c.importance desc, c.intimacy desc limit $3`,
      [ctx.userId, staleOnly, limit],
    );
    return { staleOnly, items: rows };
  },
};

const queryInteractions: ChatTool = {
  name: "query_interactions",
  description: "查询与某个联系人的往来记录（见面/通话/送礼/请客…，含关联礼金金额）。适用：最近和老王有联系吗、给谁随过礼。",
  params: z.object({
    contactName: z.string().min(1).max(30).describe("联系人姓名（支持部分匹配）"),
    from: bjDate.optional().describe("开始日期（含），默认近 90 天"),
    to: bjDate.optional().describe("结束日期（含），默认今天"),
    limit: z.number().int().min(1).max(30).default(15).describe("返回条数上限"),
  }),
  async execute(ctx, p) {
    const { contactName, from, to, limit } = p as {
      contactName: string; from?: string; to?: string; limit: number;
    };
    // 联系人解析（属主内 ilike 部分匹配，多条命中取往来最近的一条并告知其余）
    const { rows: matched } = await pool.query(
      `select c.id, c.name, c.importance, c.intimacy,
              (select max(i.occurred_at) from interactions i where i.contact_id = c.id) as last_interaction
       from contacts c
       where c.user_id = $1 and c.name ilike $2
       order by last_interaction desc nulls last limit 5`,
      [ctx.userId, `%${contactName}%`],
    );
    if (!matched.length) return { contact: contactName, found: false, items: [] };
    const contact = matched[0];
    // 缺省窗口近 90 天（与工具描述一致）；rangeOf 内含 ≤366 天跨度守卫
    const todayBj = bjToday();
    const [start, end] = rangeOf(from ?? bjAddDays(todayBj, -89), to ?? todayBj);
    const { rows: items } = await pool.query(
      `select i.type, i.summary, ${bjTs("i.occurred_at")} as occurred_bj,
              t.amount_cents::bigint as cents, t.direction
       from interactions i left join transactions t on t.id = i.tx_id
       where i.user_id = $1 and i.contact_id = $2 and i.occurred_at >= $3 and i.occurred_at < $4
       order by i.occurred_at desc limit $5`,
      [ctx.userId, contact.id, start, end, limit],
    );
    return {
      contact: { name: contact.name, importance: contact.importance, intimacy: contact.intimacy },
      otherMatches: matched.slice(1).map((m: { name: string }) => m.name),
      items,
      centsUnit: "分（1元=100分）",
    };
  },
};

const queryMood: ChatTool = {
  name: "query_mood",
  description: "查询心情记录走势：近 N 天带心情标签的动态（心情词 + 情绪强度 -100~100）。适用：我最近心情怎么样、情绪有没有持续低落。",
  params: z.object({
    days: z.number().int().min(1).max(90).default(14).describe("回看天数"),
  }),
  async execute(ctx, p) {
    const { days } = p as { days: number };
    const { rows } = await pool.query(
      `select mood, mood_score, ${bjTs("created_at")} as at_bj, left(raw_text, 40) as text
       from entries
       where user_id = $1 and mood is not null and created_at >= now() - ($2 || ' days')::interval
       order by created_at asc limit 60`,
      [ctx.userId, String(days)],
    );
    const scores = rows.map((r: { mood_score: number | null }) => r.mood_score ?? 0);
    const avg = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : null;
    return { days, averageScore: avg, items: rows };
  },
};

const getReview: ChatTool = {
  name: "get_review",
  description: "读取已生成的复盘小结（系统按日/周/月/年自动聚合的 AI 小结，含要点与建议）。适用：这周复盘说了什么、上个月的总结。没生成过会明确返回无缓存。",
  params: z.object({
    kind: z.enum(["day", "week", "month", "year"]).describe("复盘档位"),
    date: bjDate.describe("该档位内的任一天（周报传周内任一天即可，系统会定位所在周）"),
  }),
  async execute(ctx, p) {
    const { kind, date } = p as { kind: "day" | "week" | "month" | "year"; date: string };
    const periodKey =
      kind === "day" ? date
      : kind === "week" ? bjMondayOf(date)
      : kind === "month" ? date.slice(0, 7)
      : date.slice(0, 4);
    const { rows } = await pool.query(
      `select kind, period_key, review, to_char(updated_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as updated_bj
       from review_caches
       where user_id = $1 and kind = $2 and period_key = $3`,
      [ctx.userId, kind, periodKey],
    );
    if (!rows.length) return { kind, periodKey, cached: false };
    return { kind, periodKey, cached: true, review: rows[0].review, updatedBj: rows[0].updated_bj };
  },
};

const getUserProfile: ChatTool = {
  name: "get_user_profile",
  description: "读取系统长期积累的用户 AI 画像（习惯/偏好/规律/事实，随月度复盘更新）。适用：给出更懂用户的建议前先看画像。",
  params: z.object({}),
  async execute(ctx) {
    const { rows } = await pool.query(
      `select profile, to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as updated_bj
       from user_ai_profiles where user_id = $1`,
      [ctx.userId],
    );
    if (!rows.length) return { hasProfile: false };
    return { hasProfile: true, profile: rows[0].profile, updatedBj: rows[0].updated_bj };
  },
};

/** 注册表全集（MVP 8 个只读工具；写操作走批次 A.5「操作意图卡」，不在此列） */
export const CHAT_TOOLS: ChatTool[] = [
  queryTimeBlocks,
  queryTransactions,
  queryTodos,
  queryContacts,
  queryInteractions,
  queryMood,
  getReview,
  getUserProfile,
];

/** 转成 packages/ai chatAgent 需要的 AgentToolSpec（绑定会话属主） */
export function toAgentTools(ctx: ChatToolCtx): AgentToolSpec[] {
  return CHAT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.params as unknown as z.ZodType<Record<string, unknown>>,
    execute: (args) => t.execute(ctx, args),
  }));
}

/** 供前端/审计展示的工具名 → 中文摘要 */
export const TOOL_LABELS: Record<string, string> = {
  query_time_blocks: "时间块",
  query_transactions: "收支流水",
  query_todos: "待办",
  query_contacts: "联系人",
  query_interactions: "往来记录",
  query_mood: "心情",
  get_review: "复盘小结",
  get_user_profile: "用户画像",
};
