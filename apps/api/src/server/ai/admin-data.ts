/**
 * R5 后台数据面（REQ-005 FR-5.x，ai 域）：数据集注册表 + 白名单参数化查询 + 个性化注入块。
 * 安全：列/数据集双白名单 + 强制时间窗（≤92 天）+ limit 上限；全部只读。
 * promptRefs 为静态映射（与 ai-inputs 注入项人工同步，catalog._meta 注明约定）。
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { TX_CATEGORIES } from "@shiguangri/shared/finance";
import { CONTACT_GROUPS } from "@shiguangri/shared/social";
import { bjToday, bjAddDays } from "@shiguangri/shared/date";

export interface DatasetSpec {
  key: string;
  name: string;
  desc: string;
  partition: "category" | "behavior" | "derived";
  table: string; // 白名单表（无用户注入）
  timeCol: string | null; // 白名单时间列
  categoryCol?: string; // 类别维度列
  columns: string[]; // 返回字段白名单
  pkCol?: string; // 主键列（缺省 id；user_ai_profiles 以 user_id 为主键）
}

export const USER_DATA_CAP_DEFAULT = 8000; // 个性化注入总字符硬顶（FR-5.6 护栏）
export const USER_DATA_DAYS_DEFAULT = 30; // 个性化注入缺省时间窗（天）：days 留空时的装配窗口
export const USER_DATA_EST_CHARS_PER_ROW = 120; // 行宽估算系数（与前端 use-admin-user-data.ts 对齐）

const DATASETS: DatasetSpec[] = [
  // ---- 行为数据型 ----
  { key: "entries", name: "动态（时光流）", desc: "用户发布的原始动态，含 AI 标注心情", partition: "behavior", table: "entries", timeCol: "created_at", categoryCol: "mood", columns: ["id", "raw_text", "mood", "mood_score", "source", "created_at"] },
  { key: "time_blocks", name: "时间块", desc: "日程块（活动分类、起止、时长）", partition: "behavior", table: "time_blocks", timeCol: "start_at", categoryCol: "activity_id", columns: ["id", "title", "activity_id", "start_at", "end_at", "duration_min"] },
  { key: "todos", name: "待办", desc: "TODO 与行动（状态/重要/到期）", partition: "behavior", table: "todos", timeCol: "created_at", columns: ["id", "title", "kind", "status", "is_important", "due_at", "done_at", "created_at"] },
  { key: "transactions", name: "流水", desc: "收支流水（分类/对方/金额/草稿态）", partition: "behavior", table: "transactions", timeCol: "occurred_at", categoryCol: "category", columns: ["id", "direction", "amount_cents", "category", "counterparty", "note", "occurred_at", "is_draft"] },
  { key: "diet_records", name: "饮食记录", desc: "AI 识别的每日饮食摄入", partition: "behavior", table: "diet_records", timeCol: "created_at", categoryCol: "meal", columns: ["id", "meal", "items", "total_kcal", "created_at"] },
  { key: "interactions", name: "人际往来", desc: "联系人往来记录（见面/通话/帮忙等）", partition: "behavior", table: "interactions", timeCol: "occurred_at", categoryCol: "type", columns: ["id", "contact_id", "type", "summary", "occurred_at"] },
  { key: "trades", name: "投资交易逐笔", desc: "MT5 导入的逐笔交易（净盈亏/手数/方向）", partition: "behavior", table: "trades", timeCol: "close_time", categoryCol: "direction", columns: ["id", "ticket", "symbol", "direction", "lots", "open_price", "close_price", "net_profit", "close_time"] },
  { key: "liability_payments", name: "负债还款记录", desc: "各笔负债的还款流水", partition: "behavior", table: "liability_payments", timeCol: "paid_at", columns: ["id", "liability_id", "amount_cents", "paid_at", "note"] },
  // ---- 类别型 ----
  { key: "activities", name: "活动分类", desc: "日程活动分类（预设 + 自定义）", partition: "category", table: "activities", timeCol: null, columns: ["id", "name", "icon", "color", "default_min", "is_preset"] },
  { key: "contacts", name: "联系人", desc: "联系人档案（分组/生日/重要性）", partition: "category", table: "contacts", timeCol: null, categoryCol: "group_tag", columns: ["id", "name", "group_tag", "importance", "birthday"] },
  { key: "goal_spaces", name: "目标空间", desc: "用户定义的长期目标容器", partition: "category", table: "goal_spaces", timeCol: "created_at", columns: ["id", "name", "description", "status", "created_at"] },
  { key: "accounts", name: "资产账户", desc: "资产账户与期初余额", partition: "category", table: "accounts", timeCol: null, columns: ["id", "name", "icon", "opening_balance_cents", "reserve_tracked"] },
  { key: "liabilities", name: "负债档案", desc: "负债（类型/余额/利率/还款日）", partition: "category", table: "liabilities", timeCol: "created_at", categoryCol: "type", columns: ["id", "name", "type", "principal_cents", "balance_cents", "rate_pct", "monthly_cents", "pay_day", "due_date", "status"] },
  // ---- AI 衍生型 ----
  { key: "user_ai_profiles", name: "AI 用户画像", desc: "画像维护器产出的长期画像", partition: "derived", table: "user_ai_profiles", timeCol: "updated_at", pkCol: "user_id", columns: ["profile", "updated_at"] },
  { key: "review_caches", name: "复盘缓存", desc: "各级复盘生成结果（含 kind）", partition: "derived", table: "review_caches", timeCol: "updated_at", categoryCol: "kind", columns: ["id", "kind", "period_key", "review", "updated_at"] },
  { key: "entry_recognitions", name: "五域识别结果", desc: "每条动态的五域识别登记（applied/pending）", partition: "derived", table: "entry_recognitions", timeCol: "created_at", categoryCol: "domain", columns: ["id", "entry_id", "domain", "status", "confidence", "engine", "created_at"] },
  { key: "audit_logs", name: "AI 调用审计", desc: "stage/model/token/耗时/成败（AI 用量视角）", partition: "derived", table: "audit_logs", timeCol: "created_at", categoryCol: "stage", columns: ["id", "stage", "model", "prompt_tokens", "completion_tokens", "latency_ms", "ok", "created_at"] },
];

const DATASET_MAP = new Map(DATASETS.map((d) => [d.key, d]));

/** promptRefs 静态映射（与 ai-inputs 注入项人工同步；改 ai-inputs 时同步此处——见 02 §10 风险表） */
const PROMPT_DATA_REFS: Record<string, string[]> = {
  entries: ["extract_full", "review_day", "review_week", "review_month", "review_year"],
  time_blocks: ["review_day", "review_week", "review_month", "review_year"],
  todos: ["review_day", "review_week", "review_month", "review_year", "todo_decompose", "action_decompose"],
  transactions: ["trade_review_week"],
  interactions: ["review_week", "review_month"],
  diet_records: ["review_day"],
  trades: ["trading_review"],
  user_ai_profiles: ["review_month", "review_year", "profile_merge", "trade_review_week"],
  review_caches: ["review_month", "review_year", "profile_merge"],
};

export function catalogPayload() {
  return {
    datasets: DATASETS.map((d) => ({ ...d, promptRefs: PROMPT_DATA_REFS[d.key] ?? [] })),
    _meta: { note: "promptRefs 与 ai-inputs 注册表人工同步（改注入项时同步 PROMPT_DATA_REFS）" },
  };
}

export interface UserDataEntry {
  dataset: string;
  days?: number;
  limit?: number;
}

/** FR-5.6 保存校验：数据集存在、days ≤92、limit ≤50、条目 ≤5、估算字符 ≤8000 硬顶 */
export function validateUserDataConfig(cfg: unknown): UserDataEntry[] {
  if (cfg == null) return [];
  if (!Array.isArray(cfg)) throw ApiError.badRequest("context_config.userData 需为数组");
  if (cfg.length > 5) throw ApiError.badRequest("个性化注入最多 5 个数据集");
  const entries = cfg.map((e: any) => {
    const dataset = String(e?.dataset ?? "");
    if (!DATASET_MAP.has(dataset)) throw ApiError.badRequest(`个性化注入：未知数据集 ${dataset}`);
    const days = e?.days != null ? Number(e.days) : undefined;
    if (days != null && (!Number.isInteger(days) || days < 1 || days > 92)) throw ApiError.badRequest(`数据集 ${dataset} 的时间窗需为 1~92 天`);
    const limit = e?.limit != null ? Number(e.limit) : undefined;
    if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) throw ApiError.badRequest(`数据集 ${dataset} 的条数上限需为 1~50`);
    return { dataset, days, limit };
  });
  // 服务端同口径硬顶（Σ 条数上限×120 字符）：前端仅禁存拦截，直连 PUT 也必须拒绝
  const est = entries.reduce((n, e) => n + (e.limit ?? 10) * USER_DATA_EST_CHARS_PER_ROW, 0);
  if (est > USER_DATA_CAP_DEFAULT) {
    throw ApiError.badRequest(`个性化注入估算字符约 ${est}，超出上限 ${USER_DATA_CAP_DEFAULT}（请下调条数或移除数据集）`);
  }
  return entries;
}

/** 装配注入块：逐数据集查询 → 文本块；总字符硬顶截断（FR-5.6 护栏） */
export async function buildUserDataBlock(userId: string, cfg: UserDataEntry[]): Promise<string> {
  if (!cfg.length) return "";
  const blocks: string[] = [];
  let total = 0;
  const cap = USER_DATA_CAP_DEFAULT;
  for (const entry of cfg) {
    const spec = DATASET_MAP.get(entry.dataset);
    if (!spec) continue;
    const days = entry.days ?? USER_DATA_DAYS_DEFAULT; // days 留空 → 缺省 30 天窗口（不能静默不注入）
    const to = bjToday();
    const from = bjAddDays(to, -(days - 1));
    let r: { total: number; items: any[] };
    try {
      r = await queryDataset(userId, entry.dataset, {
        from,
        to,
        limit: Math.min(entry.limit ?? 10, 50),
      });
    } catch (e) {
      // 单数据集失败不阻断装配（降级语义保留），但非预期错误必须可观测
      console.warn(`[admin-data] 个性化注入查询失败，跳过数据集 ${entry.dataset}:`, e);
      continue;
    }
    const lines = r.items.map((it) =>
      spec.columns
        .filter((c) => c !== (spec.pkCol ?? "id"))
        .map((c) => {
          const v = it[c];
          // pg 对 jsonb 返回已解析对象：先 stringify 再截断，避免渲染成 "[object Object]"；
          // Date 走北京口径（toISOString 是 UTC，注入给 AI 的时刻会早 8 小时，模型按时段推理会错位）
          const text =
            v == null
              ? ""
              : v instanceof Date
                ? new Date(v.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ")
                : typeof v === "object"
                  ? JSON.stringify(v)
                  : String(v);
          return text.slice(0, 80);
        })
        .filter(Boolean)
        .join(" | "),
    );
    if (lines.length === 0) continue; // 空数据集不产出空块（prompt 零噪音）
    const head = `## ${spec.name}（近 ${days} 天）（${r.total} 条，展示 ${lines.length}）`;
    const block = [head, ...lines].join("\n").slice(0, Math.max(0, cap - total));
    blocks.push(block);
    total += block.length + 1;
    if (total >= cap) break;
  }
  return blocks.join("\n\n").slice(0, cap);
}

/** YYYY-MM-DD 往返校验：正则只保证形状，此处挡住 2026-13-45 之类落库才炸的非法日期 */
function isYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 白名单参数化查询（FR-5.2）：强制时间窗 ≤92 天 + limit 上限 + total */
export async function queryDataset(
  userId: string,
  key: string,
  opts: { from?: string; to?: string; category?: string; limit?: number; offset?: number; days?: number },
) {
  const spec = DATASET_MAP.get(key);
  if (!spec) throw ApiError.notFound("未知数据集");

  // 类别型数据集：无时间列，仅支持用户域过滤 + 可选类别
  const where: string[] = ["user_id = $1"];
  const vals: unknown[] = [userId];
  const from = opts.from;
  const to = opts.to;
  if (spec.timeCol) {
    if (!from || !isYmd(from)) throw ApiError.badRequest("from 需为 YYYY-MM-DD");
    if (!to || !isYmd(to)) throw ApiError.badRequest("to 需为 YYYY-MM-DD");
    // 首尾均含：天数 = 差值 + 1（如 6-23 ~ 9-23 为 93 天，应拒绝）
    if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > 92) throw ApiError.badRequest("时间范围上限 92 天");
    // 北京时间口径显式 +08：裸 YYYY-MM-DD 会被按 DB 会话 TimeZone 解释（UTC 库会少采当天 0-8 点）
    vals.push(`${from} 00:00:00+08`, `${to} 23:59:59+08`);
    where.push(`${spec.timeCol} between $${vals.length - 1}::timestamptz and $${vals.length}::timestamptz`);
  }
  if (opts.category && spec.categoryCol) {
    vals.push(opts.category);
    where.push(`${spec.categoryCol} = $${vals.length}`);
  }
  const rawLimit = Number(opts.limit ?? 200);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 200, 1), 1000); // 非法回落默认 200
  const rawOffset = Number(opts.offset ?? 0);
  const offset = Math.min(Math.max(Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0, 0), 10_000); // 钳制防深翻页
  const pk = spec.pkCol ?? "id";
  const W = `where ${where.join(" and ")}`;
  const total = Number((await pool.query(`select count(*)::int as n from ${spec.table} ${W}`, vals)).rows[0].n);
  const cols = [pk, ...spec.columns.filter((c) => c !== pk)].join(", ");
  const { rows } = await pool.query(
    `select ${cols} from ${spec.table} ${W} ${spec.timeCol ? `order by ${spec.timeCol} desc` : ""} limit ${limit} offset ${offset}`,
    vals,
  );
  return { total, items: rows };
}

/** FR-5.1 类别清单：按域分组（activities/spaces 为 DB 实时） */
export async function categoriesPayload(userId: string) {
  const acts = await pool.query(
    `select name, icon, is_preset from activities where user_id = $1 order by sort_order`,
    [userId],
  );
  const spaces = await pool.query(
    `select name from goal_spaces where user_id = $1 and status = 'active' order by created_at`,
    [userId],
  );
  return {
    groups: [
      { domain: "time", name: "时间", items: { source: "activities（DB 实时）", values: acts.rows.map((r) => `${r.icon} ${r.name}${r.is_preset ? "（预设）" : ""}`) } },
      { domain: "finance", name: "财务", items: { source: "TX_CATEGORIES（packages/shared/finance.ts）", values: TX_CATEGORIES } },
      { domain: "people", name: "人际", items: { source: "CONTACT_GROUPS（packages/shared/social.ts）", values: CONTACT_GROUPS } },
      { domain: "goal", name: "目标", items: { source: "goal_spaces（DB 实时）", values: spaces.rows.map((r) => r.name) } },
      { domain: "finance-debt", name: "负债类型", items: { source: "liabilities type 枚举（validateDebtBody）", values: ["credit_card", "mortgage", "car_loan", "consumer_loan", "bnpl", "family"] } },
      { domain: "diary", name: "心情档位", items: { source: "mood-rules（packages/ai）", values: ["开心", "平静", "疲惫", "焦虑", "低落", "烦躁", "满足", "期待"] } },
      { domain: "timeline", name: "时段枚举", items: { source: "trading 归类（server/finance/trading）", values: ["morning", "afternoon", "evening", "lateNight"] } },
    ],
  };
}
