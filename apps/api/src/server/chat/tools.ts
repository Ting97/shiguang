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
import { loadConfig } from "@/server/platform/config";
import { bjAddDays, bjMondayOf, bjToday } from "@shiguangri/shared/date";
import { FitnessPlanDraftV2, type AgentToolSpec } from "@shiguangri/ai";
import { draftToCanonicalPlan, readTrains, makeLocalResolver } from "@/server/fitness";

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
  // 负债/交易（032/037，授权模块：查询前须过模块门禁）
  "liabilities",
  "liability_payments",
  "trades",
  "trade_accounts",
  "user_module_controls",
  "profiles",
  // 财务/目标/饮食/备付（全数据面接入）
  "diet_records",
  "accounts",
  "budgets",
  "space_reflections",
  "debt_reserve_checks",
  "trade_reserve_banks",
  // 健身（REQ-016：计划/执行/指标/目标/动作库）
  "fitness_daily_plans",
  "fitness_session_logs",
  "fitness_body_metrics",
  "fitness_goals",
  "fitness_profiles",
  "fitness_exercises",
  // 补登实际被读但此前漏登记的表（modules 为计划/日志联表的模块字典、sleep_logs 为每日睡眠序列）——
  // 本登记簿是跨域读的文档/审计口径：新增跨域读表必须同步登记，防注册表与真实读面漂移
  "fitness_sleep_logs",
  "fitness_modules",
] as const;

/** 工具执行上下文：会话属主（所有查询的强制过滤条件）；提案工具另带会话归属 */
export interface ChatToolCtx {
  userId: string;
  /** 当前会话 id（提案登记归属；查询工具不使用） */
  conversationId?: string;
}

export interface ChatTool {
  name: string;
  description: string;
  params: z.ZodType<Record<string, unknown>>;
  execute: (ctx: ChatToolCtx, params: Record<string, unknown>) => Promise<unknown>;
}

// ---- 公共构件 ----

/** 北京日期串（YYYY-MM-DD）校验：合法日历日（防 2025-02-30 静默滚动成 3 月）+ 不早于 2020 年（挡脏输入，非业务约束） */
const bjDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期须为 YYYY-MM-DD").refine(
  (s) => {
    const [y, m, d] = s.split("-").map(Number);
    const real = m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
    return real && s >= "2020-01-01";
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
  return [bjDayStart(from), bjDayStart(bjAddDays(to, 1))];
}

/** 明细行在北京时区的 MM-DD HH:MI 展示串（避免模型自行做时区换算出错） */
const bjTs = (col: string) => `to_char(${col} at time zone 'Asia/Shanghai', 'MM-DD HH24:MI')`;

/** timestamptz 列 → 北京钟面展示（null 透传 null）；todo 到期/完成时间用 */
const dueExpr = (col: string) => `case when ${col} is null then null else ${bjTs(col)} end`;

/** ilike 模糊匹配前转义通配符：用户输入里的 % _ \ 会被当模式元字符
 * （"%" 直拼等于全表模糊扫，"\" 会吞掉后续字符造成误匹配），统一 \% \_ \\ 后再拼 %...% */
const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 模块门禁（REQ-028）：与路由 getModuleUser 同口径——admin 直通，普通用户走三层有效态 */
async function moduleAllowed(ctx: ChatToolCtx, module: "debt" | "trading"): Promise<boolean> {
  const { resolveUserModules } = await import("@/server/platform/modules");
  const { rows } = await pool.query(`select role from profiles where id = $1`, [ctx.userId]);
  const role = String(rows[0]?.role ?? "user");
  const { modules } = await resolveUserModules({ id: ctx.userId, role });
  return modules.includes(module);
}

/** 授权模块未开通时的统一返回：模型据此如实告知而非报错 */
const MODULE_OFF = (label: string) => ({ enabled: false, hint: `用户未开通${label}模块，请说明该查询不可用并指引去财务页开通` });

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
    // 与统计页同口径（time/repo statsRepo）：按区间交集钳制时长、含跨天块（昨晚 23:00 的睡眠块
    // start_at 在区间外，旧 start_at 过滤会漏掉，模型口径与统计页对不上）
    const { rows: byActivity } = await pool.query(
      `select a.name as activity, count(*)::int as blocks,
              sum(floor(extract(epoch from least(b.end_at, $3::timestamptz) - greatest(b.start_at, $2::timestamptz)) / 60))::int as minutes
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1 and b.start_at < $3::timestamptz and b.end_at > $2::timestamptz
       group by a.name order by minutes desc nulls last`,
      [ctx.userId, start, end],
    );
    const { rows: detail } = await pool.query(
      `select b.title, a.name as activity, ${bjTs("b.start_at")} as start_bj,
              floor(extract(epoch from least(b.end_at, $3::timestamptz) - greatest(b.start_at, $2::timestamptz)) / 60)::int as minutes
       from time_blocks b join activities a on a.id = b.activity_id and a.user_id = b.user_id
       where b.user_id = $1 and b.start_at < $3::timestamptz and b.end_at > $2::timestamptz
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
    // 金额单位统一「分」（整数）——提示词已约定模型表述时换算为元；::bigint 经 pg 返回字符串，统一转回数字
    const numRow = (r: { cents: unknown }) => ({ ...r, cents: Number(r.cents) });
    return { range: { from, to }, totals: totals.map(numRow), byCategory: byCategory.map(numRow), detail: detail.map(numRow), centsUnit: "分（1元=100分）" };
  },
};

const queryTodos: ChatTool = {
  name: "query_todos",
  description:
    "查询待办与行动（kind：todo=任务 / action=行动）：视图 open=未完成（含详情摘要/所属待办/每日重复完成次数/今日标记）、due_soon=7 天内到期、today_actions=今日行动清单（与首页「今日行动」同口径：重复行动+今日标记+今日到期+过期未完成）、done_recent=最近 14 天已完成。适用：我有什么待办、今天要做哪些行动、什么过期了。",
  params: z.object({
    view: z.enum(["open", "due_soon", "today_actions", "done_recent"]).default("open").describe("列表视图"),
    kind: z.enum(["all", "todo", "action"]).default("all").describe("按类型过滤"),
    limit: z.number().int().min(1).max(30).default(20).describe("返回条数上限"),
  }),
  async execute(ctx, p) {
    const { view, kind, limit } = p as {
      view: "open" | "due_soon" | "today_actions" | "done_recent";
      kind: "all" | "todo" | "action";
      limit: number;
    };
    const BJ_TODAY = `(now() at time zone 'Asia/Shanghai')::date`;

    if (view === "today_actions") {
      // 与 goal 域 todoRepo.todayActions 同口径（只读镜像）
      const { rows } = await pool.query(
        `select x.title, x.kind, x.status, x.parent_title, x.repeat_daily, x.today_tagged, x.due_bj
         from (
           select a.title, a.kind, a.status, a.due_at, a.repeat_daily, a.today_tag_date,
                  ${dueExpr("a.due_at")} as due_bj,
                  (a.today_tag_date = ${BJ_TODAY}) as today_tagged,
                  p.title as parent_title, a.sort, a.created_at
           from todos a left join todos p on p.id = a.parent_todo_id
           where a.user_id = $1 and a.kind = 'action'
             and ( a.repeat_daily
                or a.today_tag_date = ${BJ_TODAY}
                or ((a.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY})
                or ((a.due_at at time zone 'Asia/Shanghai')::date < ${BJ_TODAY} and a.status = 'pending')
                or p.today_tag_date = ${BJ_TODAY}
                or ((p.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY} and p.status = 'pending') )
           union all
           select t.title, t.kind, t.status, t.due_at, t.repeat_daily, t.today_tag_date,
                  ${dueExpr("t.due_at")} as due_bj,
                  (t.today_tag_date = ${BJ_TODAY}) as today_tagged,
                  null::text as parent_title, t.sort, t.created_at
           from todos t
           where t.user_id = $1 and t.parent_todo_id is null and t.kind = 'todo'
             and ((t.status in ('pending','done') and (t.due_at at time zone 'Asia/Shanghai')::date = ${BJ_TODAY})
               or (t.status = 'pending' and t.due_at is not null and (t.due_at at time zone 'Asia/Shanghai')::date < ${BJ_TODAY}))
         ) x
         where ($2 = 'all' or x.kind = $2)
         order by (x.status = 'done'), x.due_at nulls last, x.created_at, x.sort
         limit $3`,
        [ctx.userId, kind, limit],
      );
      return { view, count: rows.length, items: rows };
    }

    const common = `from todos t
       left join goal_spaces s on s.id = t.space_id
       left join todos p on p.id = t.parent_todo_id
       where t.user_id = $1 and ($2 = 'all' or t.kind = $2)`;
    if (view === "done_recent") {
      const { rows } = await pool.query(
        `select t.title, t.kind, s.name as space, t.is_important, t.repeat_daily, t.repeat_done_count,
                ${dueExpr("t.done_at")} as done_bj
         ${common} and t.status = 'done' and t.done_at >= now() - interval '14 days'
         order by t.done_at desc limit $3`,
        [ctx.userId, kind, limit],
      );
      return { view, count: rows.length, items: rows };
    }
    const dueFilter = view === "due_soon" ? " and (t.due_at is not null and t.due_at < now() + interval '7 days')" : "";
    const { rows } = await pool.query(
      `select t.title, t.kind, s.name as space, t.is_important, t.repeat_daily, t.repeat_done_count,
              left(t.note, 80) as note,
              (t.today_tag_date = ${BJ_TODAY}) as today_tagged,
              p.title as parent_title,
              ${dueExpr("t.due_at")} as due_bj,
              case when t.due_at is not null and t.due_at < now() then true else false end as overdue
       ${common} and t.status = 'pending'${dueFilter}
       order by t.is_important desc, t.due_at asc nulls last, t.created_at asc limit $3`,
      [ctx.userId, kind, limit],
    );
    return { view, count: rows.length, items: rows };
  },
};

const getTodoDetail: ChatTool = {
  name: "get_todo_detail",
  description:
    "查询单个待办/行动的详情与子行动：按标题关键词匹配最近一条，返回备注全文、重要/每日重复/今日标记、所属空间，及其拆解出的行动清单（含完成状态与重复完成次数）。适用：看下某待办的详情、它拆了哪些行动。",
  params: z.object({
    title: z.string().min(1).max(60).describe("标题关键词（部分匹配，取最近创建的一条）"),
  }),
  async execute(ctx, p) {
    const { title } = p as { title: string };
    const BJ_TODAY = `(now() at time zone 'Asia/Shanghai')::date`;
    const { rows } = await pool.query(
      `select t.id, t.title, t.kind, t.status, t.note, t.is_important, t.repeat_daily, t.repeat_done_count,
              s.name as space, p.title as parent_title,
              ${dueExpr("t.due_at")} as due_bj,
              (t.today_tag_date = ${BJ_TODAY}) as today_tagged
       from todos t
       left join goal_spaces s on s.id = t.space_id
       left join todos p on p.id = t.parent_todo_id
       where t.user_id = $1 and t.title ilike $2
       order by t.created_at desc limit 1`,
      [ctx.userId, `%${escapeLike(title)}%`],
    );
    if (!rows.length) return { found: false, title };
    const todo = rows[0];
    const { rows: children } = await pool.query(
      `select title, status, repeat_daily, repeat_done_count,
              ${dueExpr("due_at")} as due_bj
       from todos
       where user_id = $1 and parent_todo_id = $2
       order by sort`,
      [ctx.userId, todo.id],
    );
    return { found: true, todo, children };
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
      [ctx.userId, `%${escapeLike(contactName)}%`],
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
      // 与 query_transactions 同口径：::bigint 经 pg 返回字符串统一转回数字（左关联合流水可为 null，透传）
      items: items.map((r: Record<string, unknown> & { cents: unknown }) => ({
        ...r,
        cents: r.cents == null ? null : Number(r.cents),
      })),
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
  description:
    "读取已生成的复盘小结（系统自动聚合的 AI 小结，含要点与建议）：日/周/月/年复盘 + trade_week 收支周报。适用：这周复盘说了什么、上个月的总结、收支周报。没生成过会明确返回无缓存。",
  params: z.object({
    kind: z.enum(["day", "week", "month", "year", "trade_week"]).describe("复盘档位；trade_week=收支周报（交易复盘请用 query_trading）"),
    date: bjDate.describe("该档位内的任一天（周报传周内任一天即可，系统会定位所在周）"),
  }),
  async execute(ctx, p) {
    const { kind, date } = p as { kind: "day" | "week" | "month" | "year" | "trade_week"; date: string };
    const periodKey =
      kind === "day" ? date
      : kind === "week" || kind === "trade_week" ? bjMondayOf(date)
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

const queryEntries: ChatTool = {
  name: "query_entries",
  description:
    "检索动态原文（用户发过的一句话记录，含五域识别结果标记）：按关键词模糊匹配和/或日期区间过滤，返回时间+原文+心情。适用：我之前有没有记过某件事、那天发了什么。",
  params: z.object({
    q: z.string().max(50).optional().describe("关键词（原文模糊匹配，可省略）"),
    from: bjDate.optional().describe("开始日期（含，北京时间），默认不限"),
    to: bjDate.optional().describe("结束日期（含），默认今天"),
    limit: z.number().int().min(1).max(30).default(15).describe("返回条数上限"),
  }),
  async execute(ctx, p) {
    const { q, from, to, limit } = p as { q?: string; from?: string; to?: string; limit: number };
    const conditions = ["user_id = $1"];
    const args: unknown[] = [ctx.userId];
    if (q) {
      args.push(`%${escapeLike(q)}%`);
      conditions.push(`raw_text ilike $${args.length}`);
    }
    const todayBj = bjToday();
    args.push(bjDayStart(from ?? "2020-01-01"));
    conditions.push(`created_at >= $${args.length}`);
    args.push(bjDayStart(bjAddDays(to ?? todayBj, 1)));
    conditions.push(`created_at < $${args.length}`);
    const { rows } = await pool.query(
      `select left(raw_text, 80) as text, mood, mood_score,
              ${bjTs("created_at")} as at_bj
       from entries
       where ${conditions.join(" and ")}
       order by created_at desc limit $${args.length + 1}`,
      [...args, limit],
    );
    return { q: q ?? null, range: { from: from ?? null, to: to ?? todayBj }, count: rows.length, items: rows };
  },
};

const queryDiet: ChatTool = {
  name: "query_diet",
  description:
    "查询饮食记录：按日期区间汇总摄入热量（按餐次）与最近条目明细。适用：这周吃了什么、今天摄入多少热量。",
  params: z.object({
    from: bjDate.describe("开始日期（含），北京时间"),
    to: bjDate.describe("结束日期（含）"),
  }),
  async execute(ctx, p) {
    const { from, to } = p as { from: string; to: string };
    const [start, end] = rangeOf(from, to);
    const { rows: byMeal } = await pool.query(
      `select d.meal, count(*)::int as records, coalesce(sum(d.total_kcal), 0)::int as kcal
       from diet_records d
       where d.user_id = $1 and d.created_at >= $2 and d.created_at < $3
       group by d.meal`,
      [ctx.userId, start, end],
    );
    const { rows: detail } = await pool.query(
      `select d.meal, d.items, d.total_kcal, ${bjTs("d.created_at")} as at_bj
       from diet_records d
       where d.user_id = $1 and d.created_at >= $2 and d.created_at < $3
       order by d.created_at desc limit 10`,
      [ctx.userId, start, end],
    );
    return { range: { from, to }, byMeal, detail };
  },
};

const queryAccounts: ChatTool = {
  name: "query_accounts",
  description:
    "查询资产账户（钱包/银行卡等）：各账户名称与余额（余额=期初口径，流水不入账）及合计净资产。适用：我有多少钱、各账户余额。",
  params: z.object({}),
  async execute(ctx) {
    const { rows } = await pool.query(
      `select name, icon, opening_balance_cents::bigint as balance_cents
       from accounts
       where user_id = $1 and not archived
       order by sort_order`,
      [ctx.userId],
    );
    return {
      items: rows,
      totalBalanceCents: rows.reduce((a: number, r: { balance_cents: string | number }) => a + Number(r.balance_cents), 0),
      balanceNote: "余额=期初口径（流水不入账，与财务页一致）",
      centsUnit: "分（1元=100分）",
    };
  },
};

const queryBudgets: ChatTool = {
  name: "query_budgets",
  description:
    "查询月度预算与使用进度：预算上限、本月已支出（已确认流水，北京时间当月）、剩余与预警阈值。适用：这个月预算还剩多少、花超了吗。",
  params: z.object({}),
  async execute(ctx) {
    const { rows: budget } = await pool.query(
      `select monthly_limit_cents::bigint as limit_cents, alert_threshold
       from budgets where user_id = $1`,
      [ctx.userId],
    );
    if (!budget.length || !budget[0].limit_cents) return { enabled: false, hint: "用户未设置月度预算，指引去财务页设置" };
    const monthStart = `${bjToday().slice(0, 7)}-01`;
    const [start, end] = rangeOf(monthStart, bjToday());
    const { rows: spent } = await pool.query(
      `select coalesce(sum(amount_cents), 0)::bigint as cents
       from transactions
       where user_id = $1 and occurred_at >= $2 and occurred_at < $3 and not is_draft and direction = 'out'`,
      [ctx.userId, start, end],
    );
    const limitCents = Number(budget[0].limit_cents);
    const spentCents = Number(spent[0].cents);
    return {
      month: monthStart.slice(0, 7),
      limitCents,
      spentCents,
      remainCents: limitCents - spentCents,
      usedPct: limitCents ? Math.round((spentCents / limitCents) * 100) : null,
      alertThreshold: budget[0].alert_threshold,
      centsUnit: "分（1元=100分）",
    };
  },
};

const queryGoals: ChatTool = {
  name: "query_goals",
  description:
    "查询目标空间（长期目标容器）：名称/描述/目标日期 + 空间内待办完成度 + 感悟篇数。适用：我有哪些目标、某个目标进展如何。",
  params: z.object({
    includeArchived: z.boolean().default(false).describe("是否包含已归档空间"),
    limit: z.number().int().min(1).max(20).default(10).describe("返回条数上限"),
  }),
  async execute(ctx, p) {
    const { includeArchived, limit } = p as { includeArchived: boolean; limit: number };
    const { rows: spaces } = await pool.query(
      `select s.id, s.name, s.description, s.icon, s.status, s.started_at, s.target_date,
              (select count(*)::int from todos t where t.space_id = s.id and t.status = 'pending') as open_todos,
              (select count(*)::int from todos t where t.space_id = s.id and t.status = 'done') as done_todos,
              (select count(*)::int from space_reflections r where r.space_id = s.id) as reflections
       from goal_spaces s
       where s.user_id = $1 and ($2 or s.status = 'active')
       order by s.sort, s.created_at limit $3`,
      [ctx.userId, includeArchived, limit],
    );
    return { items: spaces };
  },
};

const queryDebtReserve: ChatTool = {
  name: "query_debt_reserve",
  description:
    "查询每月备付计划（与 trade 每月备付追踪逐行同源）：当月各银行需还金额/已备付/差额。适用：这个月备付够不够、每家银行要还多少。",
  params: z.object({
    ym: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("月份 YYYY-MM，默认当月（北京时间）"),
  }),
  async execute(ctx, p) {
    if (!(await moduleAllowed(ctx, "debt"))) return MODULE_OFF("负债");
    const { ym } = p as { ym?: string };
    const month = ym ?? bjToday().slice(0, 7);
    const { rows } = await pool.query(
      `select bank, pay_days, pay_cents::bigint as pay_cents, extra_cents::bigint as extra_cents,
              need_cents::bigint as need_cents, saved_cents::bigint as saved_cents
       from trade_reserve_banks
       where user_id = $1 and date_trunc('month', ym) = date_trunc('month', $2::date)
       order by seq`,
      [ctx.userId, `${month}-01`],
    );
    return {
      month,
      items: rows,
      totals: {
        needCents: rows.reduce((a: number, r: { need_cents: string | number }) => a + Number(r.need_cents), 0),
        savedCents: rows.reduce(
          (a: number, r: { saved_cents: string | number | null }) => a + (r.saved_cents == null ? 0 : Number(r.saved_cents)),
          0,
        ),
      },
      note: "saved 为空 = 该行尚未登记备付；金额口径与负债页备付区块一致",
      centsUnit: "分（1元=100分）",
    };
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

const queryDebts: ChatTool = {
  name: "query_debts",
  description:
    "查询负债档案：各负债（信用卡/房贷/车贷/消费贷/亲友借款）当前余额、月供、利率、还款日，负债总余额与月供合计，及近 30 天还款合计。适用：我还欠多少、每月要还多少、哪笔先还。",
  params: z.object({}),
  async execute(ctx) {
    if (!(await moduleAllowed(ctx, "debt"))) return MODULE_OFF("负债");
    const { rows: items } = await pool.query(
      `select name, type, balance_cents::bigint as balance_cents, principal_cents::bigint as principal_cents,
              rate_pct::float8 as rate_pct, monthly_cents::bigint as monthly_cents, pay_day, due_date, priority
       from liabilities
       where user_id = $1 and status = 'active'
       order by priority desc, balance_cents desc`,
      [ctx.userId],
    );
    const { rows: paid } = await pool.query(
      `select coalesce(sum(amount_cents), 0)::bigint as cents, count(*)::int as n
       from liability_payments
       where user_id = $1 and paid_at >= (((now() at time zone 'Asia/Shanghai')::date - 30)::timestamp) at time zone 'Asia/Shanghai'`,
      [ctx.userId],
    );
    return {
      enabled: true,
      items,
      totals: {
        balanceCents: items.reduce((a: number, r: { balance_cents: string | number }) => a + Number(r.balance_cents), 0),
        monthlyCents: items.reduce(
          (a: number, r: { monthly_cents: string | number | null }) => a + (r.monthly_cents == null ? 0 : Number(r.monthly_cents)),
          0,
        ),
      },
      paidLast30Days: paid[0],
      centsUnit: "分（1元=100分）",
    };
  },
};

const queryTrading: ChatTool = {
  name: "query_trading",
  description:
    "查询 MT5 投资交易（平仓记录）：按日期区间的盈亏汇总（净利/笔数/胜率/最佳最差）、按品种分布、最近交易明细。适用：这个月交易赚了还是亏了、哪个品种做得好。",
  params: z.object({
    from: bjDate.optional().describe("开始日期（含，按平仓时间北京时间），默认近 30 天"),
    to: bjDate.optional().describe("结束日期（含），默认今天"),
  }),
  async execute(ctx, p) {
    if (!(await moduleAllowed(ctx, "trading"))) return MODULE_OFF("投资交易");
    const { from, to } = p as { from?: string; to?: string };
    const todayBj = bjToday();
    const [start, end] = rangeOf(from ?? bjAddDays(todayBj, -29), to ?? todayBj);
    const { rows: summary } = await pool.query(
      `select count(*)::int as trades,
              count(*) filter (where net_profit > 0)::int as wins,
              count(*) filter (where net_profit < 0)::int as losses,
              coalesce(sum(net_profit), 0)::float8 as net,
              coalesce(max(net_profit), 0)::float8 as best,
              coalesce(min(net_profit), 0)::float8 as worst
       from trades
       where user_id = $1 and close_time >= $2 and close_time < $3`,
      [ctx.userId, start, end],
    );
    const { rows: bySymbol } = await pool.query(
      `select symbol, count(*)::int as n, coalesce(sum(net_profit), 0)::float8 as net
       from trades
       where user_id = $1 and close_time >= $2 and close_time < $3
       group by symbol order by net desc`,
      [ctx.userId, start, end],
    );
    const { rows: detail } = await pool.query(
      `select t.symbol, t.direction, t.lots::float8 as lots, t.net_profit::float8 as net,
              a.currency, ${bjTs("t.close_time")} as closed_bj
       from trades t join trade_accounts a on a.id = t.account_id
       where t.user_id = $1 and t.close_time >= $2 and t.close_time < $3
       order by t.close_time desc limit 8`,
      [ctx.userId, start, end],
    );
    return {
      enabled: true,
      range: { from, to },
      summary: summary[0],
      bySymbol,
      detail,
      // 交易盈亏是账户币种金额（通常 USD），不是分——模型表述时带币种
      profitUnit: "账户币种（见 detail.currency，通常 USD），非分",
    };
  },
};

// ---- 健身工具（REQ-016）：5 只读 + 1 提案（A.5 确认卡首发） ----

const queryFitnessPlans: ChatTool = {
  name: "query_fitness_plans",
  description:
    "查询健身每日计划（跑步/力量）：按北京日期区间返回逐日计划（课型或动作明细、组次重量、状态、来源）与区间统计（训练次数/状态分布）。适用：今天/明天练什么、这周训练安排、计划完成情况。单位：距离米、配速秒每公里、重量克。",
  params: z.object({
    from: bjDate.optional().describe("开始日期（含），默认近 7 天"),
    to: bjDate.optional().describe("结束日期（含），默认明天"),
  }),
  async execute(ctx, p) {
    const { from, to } = p as { from?: string; to?: string };
    const todayBj = bjToday();
    const fromBj = from ?? bjAddDays(todayBj, -6);
    const toBj = to ?? bjAddDays(todayBj, 1);
    const [start, end] = rangeOf(fromBj, toBj);
    const { rows } = await pool.query(
      `select p.plan_date, p.module_code, m.name as module, p.source, p.status, p.content, p.rationale
       from fitness_daily_plans p join fitness_modules m on m.code = p.module_code
       where p.user_id = $1 and p.plan_date >= $2::date and p.plan_date < $3::date
       order by p.plan_date desc, m.sort`,
      [ctx.userId, start.slice(0, 10), end.slice(0, 10)],
    );
    const { rows: stats } = await pool.query(
      `select status, count(*)::int as n from fitness_daily_plans
       where user_id = $1 and plan_date >= $2::date and plan_date < $3::date
       group by status`,
      [ctx.userId, start.slice(0, 10), end.slice(0, 10)],
    );
    return { range: { from: fromBj, to: toBj }, items: rows, stats, unitHint: "距离米、配速秒每公里、重量克（模型表述换算 km/分钟/配速/kg）" };
  },
};

const queryFitnessLogs: ChatTool = {
  name: "query_fitness_logs",
  description:
    "查询健身执行记录（打卡的实际完成）：逐日实际距离/时长/配速/心率、力量实际组次、疲劳/酸痛，并附每日睡眠序列（sleep：时长/主观感受/手环App睡眠得分——调整协议「睡眠<6h 降级」看这里）。适用：点评昨天训练、最近执行得怎么样、身体状态信号、排课前看恢复情况。单位同计划工具。",
  params: z.object({
    from: bjDate.optional().describe("开始日期（含），默认近 14 天"),
    to: bjDate.optional().describe("结束日期（含），默认今天"),
  }),
  async execute(ctx, p) {
    const { from, to } = p as { from?: string; to?: string };
    const todayBj = bjToday();
    const fromBj = from ?? bjAddDays(todayBj, -13);
    const toBj = to ?? todayBj;
    const [start, end] = rangeOf(fromBj, toBj);
    const [{ rows }, sleep] = await Promise.all([
      pool.query(
        `select l.log_date, l.module_code, m.name as module, l.actual, l.fatigue, l.sleep_h_x10, l.soreness, l.note
         from fitness_session_logs l join fitness_modules m on l.module_code = m.code
         where l.user_id = $1 and l.log_date >= $2::date and l.log_date < $3::date
         order by l.log_date desc`,
        [ctx.userId, start.slice(0, 10), end.slice(0, 10)],
      ),
      pool
        .query(
          `select log_date, sleep_h_x10, feeling, score from fitness_sleep_logs
           where user_id = $1 and log_date >= $2::date and log_date < $3::date order by log_date desc`,
          [ctx.userId, start.slice(0, 10), end.slice(0, 10)],
        )
        .then((r: { rows: { log_date: string; sleep_h_x10: number; feeling: string | null; score: number | null }[] }) =>
          (r.rows ?? []).map((row) => ({
            log_date: row.log_date,
            hours: row.sleep_h_x10 / 10,
            feeling: row.feeling ?? undefined,
            score: row.score ?? undefined,
          })),
        )
        .catch(() => [] as { log_date: string; hours: number }[]),
    ]);
    return {
      range: { from: fromBj, to: toBj },
      items: rows,
      sleep,
      unitHint:
        "距离米、配速秒每公里；睡眠为独立每日记录（sleep[].hours 小时、feeling 主观感受 good/ok/bad、score 为手环/运动 App 的睡眠得分 0-100）——排课前结合时长+感受+得分判断恢复状态",
    };
  },
};

const queryFitnessBodyMetrics: ChatTool = {
  name: "query_fitness_body_metrics",
  description:
    "查询身体指标序列（体重/腰围/体脂/静息心率，通常每周一晨起空腹）与相邻记录的变化，返回换算后的 kg/cm/%。适用：体重降得快不快、腰围变化、是否该按 ±150kcal 规则调整热量。",
  params: z.object({
    from: bjDate.optional().describe("开始日期（含），默认近 90 天"),
    to: bjDate.optional().describe("结束日期（含），默认今天"),
  }),
  async execute(ctx, p) {
    const { from, to } = p as { from?: string; to?: string };
    const todayBj = bjToday();
    const fromBj = from ?? bjAddDays(todayBj, -89);
    const toBj = to ?? todayBj;
    const [start, end] = rangeOf(fromBj, toBj);
    const { rows } = await pool.query(
      `select measured_on,
              round(weight_g / 1000.0, 1)::float8 as weight_kg,
              round(waist_mm / 10.0, 1)::float8 as waist_cm,
              round(body_fat_pct_x10 / 10.0, 1)::float8 as body_fat_pct,
              resting_hr
       from fitness_body_metrics
       where user_id = $1 and measured_on >= $2::date and measured_on < $3::date
       order by measured_on`,
      [ctx.userId, start.slice(0, 10), end.slice(0, 10)],
    );
    // 周均变化率（首末差 / 周数）：供模型按目标节奏判断 ±150kcal 调整
    let weeklyChangeKg: number | null = null;
    const withWeight = rows.filter((r: { weight_kg: number | null }) => r.weight_kg != null);
    if (withWeight.length >= 2) {
      const first = withWeight[0];
      const last = withWeight[withWeight.length - 1];
      const days = (new Date(`${last.measured_on}T00:00:00+08:00`).getTime() - new Date(`${first.measured_on}T00:00:00+08:00`).getTime()) / 86_400_000;
      if (days >= 7) weeklyChangeKg = Math.round(((last.weight_kg - first.weight_kg) / (days / 7)) * 100) / 100;
    }
    return { range: { from: fromBj, to: toBj }, items: rows, weeklyChangeKg };
  },
};

const getFitnessGoals: ChatTool = {
  name: "get_fitness_goals",
  description:
    "查询健身目标档案与基本情况：每个训练模块的活跃目标（目标日/量化目标/基线）与策略档案 strategy（阶段划分/每周课模板/训练原则/动态调整协议/饮食目标与调整规则）+ 用户基本情况（身高/经验/器械/每周安排/约束）。适用：安排训练前先读它——跨模块编排（如跑步质量课当天力量怎么排）必须依据 strategy.adjustProtocol。",
  params: z.object({}),
  async execute(ctx) {
    const { rows: goals } = await pool.query(
      `select g.module_code, m.name as module, g.title, g.target_date, g.targets, g.baseline, g.strategy
       from fitness_goals g join fitness_modules m on m.code = g.module_code
       where g.user_id = $1 and g.status = 'active'`,
      [ctx.userId],
    );
    const { rows: profiles } = await pool.query(
      `select height_cm, baseline, experience, equipment, weekly_days, "constraints" from fitness_profiles where user_id = $1`,
      [ctx.userId],
    );
    return { goals, profile: profiles[0] ?? null };
  },
};

const getFitnessExercises: ChatTool = {
  name: "get_fitness_exercises",
  description:
    "查询健身动作库：按模块（run/strength）或名称/肌群关键词过滤，返回动作的主/副肌群与收益（练什么、对哪里有好处）、器械、难度、默认组次。适用：推荐动作时查它的训练收益并展示给用户。",
  params: z.object({
    module: z.enum(["run", "strength"]).optional().describe("按模块过滤"),
    keyword: z.string().max(20).optional().describe("名称或肌群关键词（如 背/肩/深蹲）"),
  }),
  async execute(ctx, p) {
    const { module: mod, keyword } = p as { module?: "run" | "strength"; keyword?: string };
    const { rows } = await pool.query(
      `select id, module_code, name, muscle_primary, muscle_secondary, equipment, level, benefit, default_template
       from fitness_exercises
       where ($1::text is null or module_code = $1)
         and ($2::text is null or name ilike '%' || $2 || '%' or muscle_primary::text ilike '%' || $2 || '%' or muscle_secondary::text ilike '%' || $2 || '%')
       order by sort limit 40`,
      [mod ?? null, keyword ? escapeLike(keyword) : null],
    );
    return { count: rows.length, items: rows };
  },
};

/** 训记（SynFit）App 当日实练查询（REQ-017）：官方规则——仅用户问及训记/当日实练时调用。
 * 返回当日各动作打勾组的实练重量×次数（计划组未打勾不计），供点评与「同步完成」引导。 */
const queryXunjiTrains: ChatTool = {
  name: "query_xunji_trains",
  description:
    "查询训记 App 某日的实际训练记录（用户在训记 App 打勾的组：实练重量×次数、RPE）。适用：用户问「昨天/今天在训记里练了什么」「实际举了多少」、或计划已同步训记想看完成情况。注意：仅用户明确提到训记或当日实练时才调用；拾光自己的计划/日志请用 query_fitness_plans / query_fitness_logs。",
  params: z.object({
    date: bjDate.optional().describe("北京日期（默认昨天）"),
  }),
  async execute(ctx, p) {
    // 训记读的是部署级唯一 XUNJI_API_KEY（运营者账号）的数据，与请求用户无关：
    // 仅管理员可用，普通注册用户问「昨天练了什么」不得读到他人训练数据（跨用户泄露面）
    const { rows: roleRows } = await pool.query(`select role from profiles where id = $1`, [ctx.userId]);
    if (roleRows[0]?.role !== "admin") return { enabled: false, hint: "训记查询未绑定当前账号，仅管理员账号可用" };
    const { date } = p as { date?: string };
    if (!loadConfig().xunjiApiKey) return { enabled: false, hint: "未配置 XUNJI_API_KEY，训记查询不可用" };
    const target = date ?? bjAddDays(bjToday(), -1);
    const trains = await readTrains(target, true);
    const localName = makeLocalResolver();
    const items = trains.flatMap((t: { title?: string; movements?: unknown[] }) =>
      (t.movements ?? []).map((m) => {
        const mv = m as { name?: string; cardio?: boolean; sets?: { done?: boolean; weight?: string; reps?: string; time?: string | number; rpe?: string }[]; metrics?: Record<string, unknown> };
        if (mv.cardio) {
          return { name: "跑步（有氧日）", type: "cardio", metrics: mv.metrics ?? {} };
        }
        const sets = mv.sets ?? [];
        const done = sets.filter((s) => s.done);
        const first = sets[0];
        const target = first
          ? `${first.weight && first.weight !== "0" ? `${first.weight}kg` : ""}×${first.time ? `${first.time}s` : first.reps ?? "?"}`
          : null;
        return {
          name: localName(mv.name ?? "?"),
          type: "strength",
          doneSets: done.length,
          totalSets: sets.length,
          target,
          detail: done.map((s) => `${s.weight ?? "-"}kg × ${s.time ? s.time + "s" : s.reps ?? "-"}${s.rpe ? ` @RPE${s.rpe}` : ""}`),
        };
      }),
    );
    return { date: target, count: items.length, items, unitHint: "重量 kg、次数为每组实练值" };
  },
};

/** 注册表全集（23 个只读工具，覆盖全模块数据面；写操作走 A.5「操作意图卡」，见 CHAT_PROPOSAL_TOOLS） */
export const CHAT_TOOLS: ChatTool[] = [
  queryTimeBlocks,
  queryTransactions,
  queryTodos,
  queryContacts,
  queryInteractions,
  queryMood,
  getReview,
  getUserProfile,
  queryDebts,
  queryTrading,
  queryEntries,
  queryDiet,
  queryAccounts,
  queryBudgets,
  queryGoals,
  queryDebtReserve,
  getTodoDetail,
  queryFitnessPlans,
  queryFitnessLogs,
  queryFitnessBodyMetrics,
  getFitnessGoals,
  getFitnessExercises,
  queryXunjiTrains,
];

// ---- A.5 操作意图确认卡（REQ-016 首发落地：助手只提案，用户点卡片确认后前端调业务域 API） ----

/** propose 入参别名归一：glm-4-flash 常回 reps/weight/pace 等简写，映射到规范字段后再严格校验 */
function normalizePlanDraft(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  const src = v as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  const take = (...keys: string[]) => {
    for (const k of keys) if (out[k] !== undefined) return out[k];
    return undefined;
  };
  if (out.repsText === undefined) {
    const r = take("reps", "reps_text", "repsText");
    if (r !== undefined) out.repsText = r;
  }
  if (out.weightKg === undefined) {
    const w = take("weight", "weight_kg", "weightKg");
    if (w !== undefined) out.weightKg = w;
  }
  if (out.paceText === undefined) {
    const p = take("pace", "paceText");
    if (p !== undefined) out.paceText = p;
  }
  if (out.totalDistanceKm === undefined) {
    const t = take("totalKm", "totalDistance", "totalDistanceKm");
    if (t !== undefined) out.totalDistanceKm = t;
  }
  if (Array.isArray(out.exercises)) out.exercises = out.exercises.map(normalizePlanDraft);
  if (Array.isArray(out.segments)) out.segments = out.segments.map(normalizePlanDraft);
  return out;
}

const proposeFitnessPlan: ChatTool = {
  name: "propose_fitness_plan",
  description:
    "为用户生成健身日计划提案（今天或明天）：生成结构化训练计划并登记为确认卡，等用户在卡片上点「保存」才会真正入库——本工具不直接写计划。调用前必须先查 get_fitness_goals（策略与调整协议）、query_fitness_plans（当日已有计划，避免冲突）、必要时 query_fitness_logs（近期负荷）与 get_fitness_exercises（动作收益）。力量计划动作尽量引用动作库动作名。plan_date 只能是北京今天或明天。",
  // 参数层刻意扁平+放宽（passthrough）：AI SDK 会在 execute 之前按 parameters 校验工具实参，
  // 嵌套/条件必填结构 glm-4-flash 极易写错且字段不匹配直接抛 InvalidToolArgumentsError 打穿循环
  // 变 500——扁平数组 + 严格校验挪进 execute，错误才能包装成 {error} 回传模型自纠
  params: z.object({
    plan_date: z.string().describe("计划日期（北京时间，只能是今天或明天）"),
    module_code: z.string().describe("训练模块：run 或 strength"),
    title: z.string().max(40).nullish().describe("课表名（如 课A·胸肩三头 / 节奏跑）"),
    exercises: z
      .array(z.object({}).passthrough())
      .max(15)
      .nullish()
      .describe("力量动作明细（module_code=strength 时必填）：[{name 动作名, sets 组数, repsText 次数如 '8-12', weightKg 重量, rir 次数储备}]"),
    segments: z
      .array(z.object({}).passthrough())
      .max(12)
      .nullish()
      .describe("跑步分段（module_code=run 时必填）：[{label 如 热身/主课, distanceKm, paceText 配速如 5'50}]"),
    workout_type: z.string().nullish().describe("跑步课型：interval(间歇)/tempo(节奏)/long(长距离)/easy(轻松)/recovery(恢复)"),
    note: z.string().max(200).nullish().describe("备注"),
    rationale: z.string().max(800).nullish().describe("生成依据（引用调整协议与当日已有安排，一两句话）"),
  }),
  async execute(ctx, p) {
    const { plan_date, module_code, title, exercises, segments, workout_type, note, rationale } = p as {
      plan_date: string;
      module_code: string;
      title?: string | null;
      exercises?: Array<Record<string, unknown>>;
      segments?: Array<Record<string, unknown>>;
      workout_type?: string | null;
      note?: string | null;
      rationale?: string | null;
    };
    // 日期守卫：仅限今天/明天（过期的提案没有意义）
    const todayBj = bjToday();
    const tomorrowBj = bjAddDays(todayBj, 1);
    if (plan_date !== todayBj && plan_date !== tomorrowBj) {
      throw new Error(`plan_date 只能是今天(${todayBj})或明天(${tomorrowBj})`);
    }
    if (module_code !== "run" && module_code !== "strength") {
      throw new Error("module_code 只能是 run 或 strength");
    }
    // 条件必填在 execute 内拦（不能放 params 校验：AI SDK 参数校验失败抛
    // InvalidToolArgumentsError 会打穿整个循环变 500；此处 throw 经 chatAgent 包装成
    // {error} 回传模型，模型可带上完整明细重调——实测 glm-4-flash 会漏传明细/写简写字段）
    if (module_code === "strength" && !(exercises?.length)) {
      throw new Error(
        "调用被拒绝：module_code=strength 必须提供 exercises 动作明细。不要回复文字，立即带上 exercises=[{name, sets, repsText, weightKg, rir}] 重新调用 propose_fitness_plan",
      );
    }
    if (module_code === "run" && !(segments?.length)) {
      throw new Error(
        "调用被拒绝：module_code=run 必须提供 segments 分段明细。不要回复文字，立即带上 segments=[{label, distanceKm, paceText}] 与 workout_type 重新调用 propose_fitness_plan",
      );
    }
    // 扁平入参组装回 run/strength 结构，别名归一（reps→repsText 等）后严格校验；
    // 失败信息拼成一行中文提示供模型重调
    const WORKOUT_TYPE_ZH: Record<string, string> = {
      节奏: "tempo", 间歇: "interval", 长距离: "long", 轻松: "easy", 恢复: "recovery",
      tempo: "tempo", interval: "interval", long: "long", easy: "easy", recovery: "recovery",
    };
    const run =
      module_code === "run"
        ? normalizePlanDraft({
            title: title ?? "跑步训练",
            workoutType: WORKOUT_TYPE_ZH[(workout_type ?? "").trim()] ?? "easy",
            segments: (segments ?? []).map(normalizePlanDraft),
            note: note ?? null,
          })
        : null;
    const strength =
      module_code === "strength"
        ? normalizePlanDraft({ title: title ?? "力量训练", exercises: (exercises ?? []).map(normalizePlanDraft), note: note ?? null })
        : null;
    const parsed = FitnessPlanDraftV2.safeParse({
      module: module_code,
      run,
      strength,
      confidence: 0.9,
    });
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".") || "(根)"}: ${i.message}`)
        .join("；");
      throw new Error(`计划明细校验未通过——${issues}。请修正字段（力量动作字段为 name/sets/repsText/weightKg/rir）后重新调用 propose_fitness_plan`);
    }
    // 模型友好单位 → 整数口径（复用 fitness 域映射；越界抛错回传模型）
    const canonical = draftToCanonicalPlan(parsed.data);
    // 幂等守卫：packages/ai 的 chatAgent 对 rate/server/network 失败会整轮重试、重跑全部工具调用，
    // 而本工具是直接 INSERT chat_proposals 的非幂等写（迁移 054 无唯一约束）——重复执行会产生
    // 多张同日确认卡。同会话同 kind 同 plan_date 已有 pending 卡时直接复用已有卡，不再新插。
    // 复查+落库包在 per-user advisory lock 事务内：check-then-insert 无锁时重试与并发消息
    // 两个请求可同时通过预检各插一张（PG13 无 nulls not distinct，唯一索引口径会误伤跨会话合法共存）
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`chat-proposal:${ctx.userId}`]);
      const { rows: existingCards } = await client.query(
        `select id from chat_proposals
         where user_id = $1 and kind = 'fitness_plan' and status = 'pending'
           and ($2::uuid is null or conversation_id = $2::uuid)
           and payload->>'planDate' = $3
         order by created_at desc limit 1`,
        [ctx.userId, ctx.conversationId ?? null, plan_date],
      );
      if (existingCards.length) {
        await client.query("commit");
        return {
          proposalId: existingCards[0].id,
          saved: false,
          duplicated: true,
          hint: "该日期已有一张待确认的计划卡（本工具不重复生成），请向用户展示既有卡片要点并说明不要声称已保存",
        };
      }
      const { rows } = await client.query(
        `insert into chat_proposals (user_id, conversation_id, kind, payload)
         values ($1, $2, 'fitness_plan', $3::jsonb) returning id`,
        [
          ctx.userId,
          ctx.conversationId ?? null,
          JSON.stringify({ planDate: plan_date, moduleCode: module_code, content: canonical.content, rationale: rationale || "" }),
        ],
      );
      await client.query("commit");
      return {
        proposalId: rows[0].id,
        saved: false,
        hint: "已生成计划确认卡，等用户点「保存」才会入库（卡片可勾选同时写入训记 App，训练时在训记里打勾记录实练）；请向用户展示计划要点并说明依据，不要声称已保存",
      };
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  },
};

/** 提案工具注册表（独立于只读注册表：只允许写 chat_proposals 登记簿，永不直接写业务表） */
export const CHAT_PROPOSAL_TOOLS: ChatTool[] = [proposeFitnessPlan];

// ---- 分域助手（REQ-019 FR-C）：工具按域归属；scope 过滤在 toAgentTools ----

/** 会话域（chat_conversations.scope）；global=全局拾光助手（全量工具） */
export type ChatScope = "global" | "goal" | "time" | "people" | "finance" | "fitness";

export const CHAT_SCOPES: readonly ChatScope[] = ["global", "goal", "time", "people", "finance", "fitness"];

/** 工具名 → 域归属（域助手只带本域工具 + get_user_profile 通用画像）；
 * 未标注的工具视为 'ai'（仅全局可见），防御后续新增工具漏标时域助手越权拿到 */
const TOOL_DOMAIN: Record<string, Exclude<ChatScope, "global">> = {
  // time/日程
  query_time_blocks: "time",
  // goal/目标（todo+空间）
  query_todos: "goal",
  get_todo_detail: "goal",
  query_goals: "goal",
  // finance/财务
  query_transactions: "finance",
  query_accounts: "finance",
  query_budgets: "finance",
  query_debts: "finance",
  query_trading: "finance",
  query_debt_reserve: "finance",
  // people/人际
  query_contacts: "people",
  query_interactions: "people",
  // timeline/动态识别产物（心情/记录/饮食）
  query_mood: "time",
  query_entries: "time",
  query_diet: "time",
  // insight/复盘
  get_review: "time",
  // fitness/运动
  query_fitness_plans: "fitness",
  query_fitness_logs: "fitness",
  query_fitness_body_metrics: "fitness",
  get_fitness_goals: "fitness",
  get_fitness_exercises: "fitness",
  query_xunji_trains: "fitness",
  propose_fitness_plan: "fitness",
};

/** 按会话域过滤工具集（REQ-019 FR-C2）：global 全量；域 scope=本域 + 通用画像 */
export function toolsForScope(scope: ChatScope): ChatTool[] {
  const all = [...CHAT_TOOLS, ...CHAT_PROPOSAL_TOOLS];
  if (scope === "global") return all;
  return all.filter((t) => t.name === "get_user_profile" || TOOL_DOMAIN[t.name] === scope);
}

/** 转成 packages/ai chatAgent 需要的 AgentToolSpec（绑定会话属主；按 scope 过滤） */
export function toAgentTools(ctx: ChatToolCtx, scope: ChatScope = "global"): AgentToolSpec[] {
  return toolsForScope(scope).map((t) => ({
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
  query_debts: "负债",
  query_trading: "投资交易",
  query_entries: "动态记录",
  query_diet: "饮食",
  query_accounts: "资产账户",
  query_budgets: "预算",
  query_goals: "目标空间",
  query_debt_reserve: "每月备付",
  get_todo_detail: "待办详情",
  query_fitness_plans: "健身计划",
  query_xunji_trains: "训记实练记录",
  query_fitness_logs: "训练记录",
  query_fitness_body_metrics: "身体指标",
  get_fitness_goals: "健身目标档案",
  get_fitness_exercises: "动作库",
  propose_fitness_plan: "生成计划卡片",
};
