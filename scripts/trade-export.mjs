#!/usr/bin/env node
/**
 * R2 导出脚本（REQ-005 FR-2.1）：在 trade 服务器上读取 data.js（IIFE 挂 window.DB），
 * 生成拾光标准导入格式 shiguang-import.json（liabilities[] + accounts[]）。
 *
 * 用法（服务器）：
 *   node trade-export.mjs /opt/aitrade/资产/data.js > shiguang-import.json
 * 字段映射见 docs/requirements/005 02 §4.1（bank→name、principalWan→principal_cents、
 * group/method→type、payDay 取首个数字、balloon/clearDate 取最早到期月首日、note 剥 HTML）。
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const file = process.argv[2] ?? "/opt/aitrade/资产/data.js";
const source = readFileSync(file, "utf8");

// IIFE 挂 window.DB / global.DB —— 沙箱给两者同一个对象
const sandboxWindow = {};
vm.runInNewContext(source, { window: sandboxWindow, global: sandboxWindow });
const DB = sandboxWindow.DB ?? sandboxWindow.global?.DB;
if (!DB?.loans) {
  console.error("data.js 解析失败：未找到 window.DB.loans");
  process.exit(1);
}

const wanToCents = (wan) => Math.round(Number(wan || 0) * 10_000 * 100);
const stripHtml = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const firstNum = (s) => {
  const m = String(s ?? "").match(/\d+/);
  return m ? Number(m[0]) : null;
};
/** 优先 balloon（先息后本到期），否则 clearDate；取第一个「年+月」→ 月首日（仅年份区间如 2032/2033 取首个年份的 1 月） */
function toDueDate(l) {
  const raw = String(l.balloon || l.clearDate || "");
  const m = raw.match(/(\d{4})[-/年]\s*(\d{1,2})(?!\d)/) ?? raw.match(/(\d{4})(?!\d)/);
  if (!m) return null;
  const y = m[1];
  const mo = m[2] != null ? Number(m[2]) : 1;
  if (mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-01`;
}
function toType(l) {
  if (l.group === "family") return "family";
  if (l.group === "card" || /信用卡分期/.test(l.method ?? "")) return "credit_card";
  if (l.group === "balloon") return "mortgage";
  return "consumer_loan";
}
const PRIORITY_LETTER = { A: 1, B: 2, C: 3, D: 4, E: 5 };
function toPriority(p) {
  const letter = String(p ?? "").charAt(0).toUpperCase();
  return PRIORITY_LETTER[letter] ?? null;
}

const liabilities = DB.loans.map((l) => ({
  name: String(l.bank ?? "").trim(),
  type: toType(l),
  principalCents: wanToCents(l.principalWan),
  balanceCents: wanToCents(l.principalWan), // 首次导入余额=本金（预览中可调整）
  ratePct: l.ratePct != null ? Number(l.ratePct) : null,
  monthlyCents: Number(l.monthlyVal) > 0 ? Math.round(Number(l.monthlyVal) * 100) : null,
  payDay: firstNum(l.payDay),
  dueDate: toDueDate(l),
  priority: toPriority(l.priority),
  note: [l.priority ? `[原优先级 ${l.priority}]` : "", stripHtml(l.note)].filter(Boolean).join(" "),
}));

const a = DB.assets ?? {};
const accounts = [];
if (a.bankWan > 0) accounts.push({ name: "银行账户（迁移）", icon: "🏦", openingBalanceCents: wanToCents(a.bankWan) });
if (a.securitiesWan > 0) accounts.push({ name: "证券（迁移）", icon: "📈", openingBalanceCents: wanToCents(a.securitiesWan) });

const out = {
  exportedAt: new Date().toISOString(),
  source: file,
  liabilities,
  accounts,
  reconcile: {
    loansCount: DB.loans.length,
    principalTotalCents: liabilities.reduce((s, l) => s + l.principalCents, 0),
    balanceTotalCents: liabilities.reduce((s, l) => s + (l.balanceCents ?? 0), 0),
    docTotal: DB.totals?.principalRemainWan ?? null,
  },
};
console.log(JSON.stringify(out, null, 2));
