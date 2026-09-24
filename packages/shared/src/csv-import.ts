/**
 * 支付宝 / 微信账单 CSV 导入 —— 解析与自动分类（纯函数，可单测）
 *
 * 平台账单格式（官方导出）：
 * - 支付宝（GBK 编码）：头部若干说明行后是表头
 *   交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收付款方式,交易状态,交易订单号,商家订单号,备注
 * - 微信（UTF-8）：头部若干说明行后是表头
 *   交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
 *
 * 约定：
 * - 时间按北京时间（+08:00）解释，存 UTC ISO
 * - 金额一律转「分」（整数）
 * - 「不计收支」与退款行跳过（退款不单独计账，避免重复）
 */

export type Platform = "alipay" | "wechat";

export interface ImportRow {
  direction: "out" | "in";
  amountCents: number;
  category: string;
  counterparty: string | null;
  note: string | null;
  occurredAt: string; // ISO UTC
  externalNo: string | null;
  rawTime: string;
}

export interface SkipInfo {
  line: number; // CSV 中的行号（含表头偏移，1 起）
  reason: string;
}

export interface ParseResult {
  platform: Platform;
  rows: ImportRow[];
  skips: SkipInfo[];
}

/** 平台特征词：微信账单头部含「微信支付账单明细」，支付宝含「支付宝交易记录明细」或「支付宝（中国）」 */
export function detectPlatform(text: string): Platform | null {
  const head = text.slice(0, 4000);
  if (head.includes("微信支付账单") || head.includes("微信支付交易明细")) return "wechat";
  if (head.includes("支付宝") || head.includes("交易订单号")) return "alipay";
  return null;
}

/** 容错 CSV 行解析：支持引号内的逗号与换行 */
export function splitCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** "1,280.00" / "¥25.00" / "1280" → 分 */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[¥,\s]/g, "").trim();
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** "2026-09-17 12:30:45"（北京时间）→ UTC ISO；非法返回 null */
export function parseCstTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}+08:00`;
  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

const COL = (header: string[]) => {
  const find = (...names: string[]) => {
    for (const name of names) {
      const idx = header.findIndex((h) => h.trim() === name);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    time: find("交易时间"),
    type: find("交易分类", "交易类型"), // 支付宝=交易分类 / 微信=交易类型
    counterparty: find("交易对方"),
    goods: find("商品说明", "商品"),
    direction: find("收/支"),
    amount: find("金额", "金额(元)"),
    status: find("交易状态", "当前状态"),
    externalNo: find("交易订单号", "交易单号", "交易号"),
    note: find("备注"),
  };
};

/** 我们的 9 分类 → 支付宝「交易分类」列映射表（其余走商家关键词/兜底其他） */
const ALIPAY_TYPE_MAP: Record<string, string> = {
  餐饮美食: "餐饮",
  交通出行: "交通",
  服饰装扮: "购物",
  人情往来: "人情往来",
  文化休闲: "娱乐",
  教育学习: "学习",
  医疗健康: "医疗",
  日用百货: "购物",
  充值缴费: "居住",
  美容美发: "购物",
  物业费: "居住",
  水电煤气: "居住",
};

/** 商家/商品关键词 → 分类（微信无分类列，主要靠它；关键词覆盖常见场景） */
const KEYWORD_RULES: [RegExp, string][] = [
  [/红包|转账|随礼|礼金|份子/, "人情往来"],
  [/外卖|饿了么|美团|肯德基|麦当劳|必胜客|星巴克|瑞幸|餐厅|饭|面馆|小吃|烧烤|火锅|奶茶|咖啡/, "餐饮"],
  [/滴滴|滴滴出行|地铁|公交|出租|网约车|12306|铁路|航空|机票|火车|加油|中国石化|中国石油|停车|共享单车|骑行/, "交通"],
  [/淘宝|天猫|京东|拼多多|苏宁|唯品会|闲鱼|百货|超市/, "购物"],
  [/电影|影院|游戏|Steam|腾讯视频|爱奇艺|优酷|音乐|网易云|KTV|游乐/, "娱乐"],
  [/医院|药店|药房|诊所|体检|口腔|牙科|挂号/, "医疗"],
  [/物业|房租|水费|电费|燃气|宽带|话费|充值|房租水电/, "居住"],
  [/书店|图书|课程|网校|知识|培训|学费|得到|知乎/, "学习"],
];

/** 由平台交易分类 + 商家/商品关键词推断我们的分类 */
export function classify(platformType: string, counterparty: string, goods: string): string {
  const hayAll = `${platformType} ${counterparty} ${goods}`;
  // 还款类优先于平台分类映射（支付宝的信用卡还款挂在「充值缴费」下，微信靠交易类型关键词）
  if (/还款|花呗|白条/.test(hayAll)) return "还款";
  if (platformType && ALIPAY_TYPE_MAP[platformType]) return ALIPAY_TYPE_MAP[platformType];
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(hayAll)) return cat;
  }
  return "其他";
}

const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/**
 * 解析账单文本 → 可导入行
 * @throws Error 无法识别平台 / 找不到表头时抛出中文错误
 */
export function parseBill(text: string, platform?: Platform): ParseResult {
  const clean = text.replace(/^\uFEFF/, ""); // 去 BOM
  const detected = detectPlatform(clean);
  const p = platform ?? detected;
  if (!p) throw new Error("无法识别账单类型 —— 请上传支付宝或微信官方导出的 CSV");

  const all = splitCsvLines(clean);
  const headerIdx = all.findIndex((r) => r.some((c) => c.trim() === "交易时间"));
  if (headerIdx < 0) throw new Error("找不到表头行（交易时间）—— 请确认是官方导出的原始 CSV，勿手工改动列名");
  const col = COL(all[headerIdx]);
  if (col.time < 0 || col.amount < 0 || col.direction < 0) {
    throw new Error("账单缺少必要列（交易时间/金额/收-支）");
  }

  const rows: ImportRow[] = [];
  const skips: SkipInfo[] = [];
  for (let i = headerIdx + 1; i < all.length; i++) {
    const r = all[i];
    const lineNo = i + 1;
    const get = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : "");

    // 方向：既非收入也非支出（如「/」、不计收支）→ 跳过
    const directionRaw = get(col.direction);
    const direction = directionRaw.includes("收入")
      ? ("in" as const)
      : directionRaw.includes("支出")
        ? ("out" as const)
        : null;
    if (!direction) {
      skips.push({ line: lineNo, reason: `不计收支（${directionRaw || "空"}）` });
      continue;
    }
    const status = get(col.status);
    if (status.includes("退款")) {
      skips.push({ line: lineNo, reason: `退款行（${status}）` });
      continue;
    }
    const amountCents = parseAmount(get(col.amount));
    if (amountCents == null || amountCents <= 0) {
      skips.push({ line: lineNo, reason: "金额无法解析" });
      continue;
    }
    // 与 AI 契约/服务端上限一致（amount_cents int4）：超限行跳过计入 skips，避免整批导入事务回滚
    if (amountCents > 100_000_000) {
      skips.push({ line: lineNo, reason: "单笔金额超出上限（¥100 万）" });
      continue;
    }
    const occurredAt = parseCstTime(get(col.time));
    if (!occurredAt) {
      skips.push({ line: lineNo, reason: `时间无法解析（${get(col.time)}）` });
      continue;
    }

    const counterparty = get(col.counterparty) || null;
    const goods = get(col.goods);
    const platformType = get(col.type);
    rows.push({
      direction,
      amountCents,
      category: classify(platformType, counterparty ?? "", goods),
      counterparty,
      note: get(col.note) || goods || null,
      occurredAt,
      externalNo: get(col.externalNo) || null,
      rawTime: get(col.time),
    });
  }

  return { platform: p, rows, skips };
}

/** 去重键：外部单号优先，无单号用 时间+金额+对方 指纹 */
export function dedupeKey(row: ImportRow): string {
  if (row.externalNo) return `no:${row.externalNo}`;
  return `fp:${row.occurredAt}|${row.amountCents}|${row.counterparty ?? ""}|${row.direction}`;
}

/** 预览统计（导入确认前的摘要文案） */
export function summarize(rows: ImportRow[], skippedDup: number): string {
  const outCents = rows.filter((r) => r.direction === "out").reduce((s, r) => s + r.amountCents, 0);
  const inCents = rows.filter((r) => r.direction === "in").reduce((s, r) => s + r.amountCents, 0);
  const parts = [`共 ${rows.length} 笔可导入（支出 ${yuan(outCents)} / 收入 ${yuan(inCents)}）`];
  if (skippedDup > 0) parts.push(`跳过重复 ${skippedDup} 笔`);
  return parts.join(" · ");
}
