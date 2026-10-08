#!/usr/bin/env node
/**
 * trade → shiguang 负债余额 + 每月备付镜像定时同步（REQ-009 滚动，2026-10-04/06）。
 *
 * 源：trade.ting97.cn 资产模块（本机 /opt/aitrade + dashboard :3030 /api/asset/store；
 *     用户在 trade 页面逐笔录入/修订）。
 * 目标：shiguang 账户 15091587905（USER_PHONE）。
 * 语义：
 *  1) 负债余额：asset_snapshots_v1 → liabilities.balance_cents（映射内逐笔，映射外自动建档）。
 *  2) 备付镜像：读 /opt/aitrade/资产/{data.js,备付核心.js} 复刻 trade 的「需还矩阵」
 *     （静态 RULES + asset_loans_config_v1 用户覆盖/自定义负债），按银行合并出每月
 *     月供/到期本金/当月需还，连同 asset_repay_reserve_v1 的账户剩余逐月写入
 *     trade_reserve_banks——备付页与 trade 逐行同源。
 *  3) 储蓄账户：reserve 键 - 还款银行名（非 0）→ debt_reserve_sources。
 *  4) 备付计划金额：reserve 银行行 → debt_reserve_checks.planned_cents（历史口径，保留）。
 *
 * 用法（服务器）：node sync-debt-from-trade.mjs [--dry]
 * cron 示例：10 6 * * *  （每日 06:10，见 scripts/ops/README.md）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const dry = process.argv.includes("--dry");

// ---- 配置 ----
const USER_PHONE = "15091587905";
const TRADE_HOME = process.env.TRADE_HOME ?? "/opt/aitrade"; // trade 部署目录（需还矩阵源文件）
const STORE_URL =
  process.env.TRADE_STORE_URL ??
  "http://127.0.0.1:3030/api/asset/store?keys=asset_snapshots_v1,asset_repay_reserve_v1,asset_loans_config_v1";
// 映射外置：/opt/shiguangri_repo/scripts/trade-debt-mapping.json（code → 负债 uuid）
// 自动建档的新条目会自动写回此文件；NAME_OVERRIDES：建档时的中文名（缺省 "trade <code>"，改名不影响绑定）
const MAPPING_FILE = join(here, "trade-debt-mapping.json");
const NAME_OVERRIDES = { B3: "华夏银行B3" };
let MAPPING = {};
try {
  MAPPING = JSON.parse(readFileSync(MAPPING_FILE, "utf8"));
} catch {
  MAPPING = { B1: "bc62b1a6-3fb1-4fb1-9b27-608ce22aaea6", B3: "56b6fd96-56fd-4b41-929b-8b6b667ecc9c", A1: "3bb54eda-a05a-4241-b87b-741618276a1b", A2: "37b20084-d39c-4a0f-b086-ef5e45ee2217", A3: "94157ec9-28af-4aae-835e-94f9d0f6de19", A4: "8afc4d8c-dbe2-432a-87da-f2521152d07c", B2: "b3e55026-7023-4187-9048-eb27546c6e52", C1: "a4f56fc9-f5d4-4ffa-b72f-b280dd5af2c7", C2: "ff0b097c-409a-45d6-bcc1-05dcae304fc0", C3: "6ea22097-99e0-4996-b542-147cf724e74b", C4: "f7f94de6-842d-4354-a636-ec702fd6dd1e", D1: "1c5d9edf-439a-4d43-86c1-6291ba29f420", D2: "bed993d9-9364-45d4-be67-a06996ce4bbe", D3: "0b03d54a-0013-45fa-abc1-03189344ccb6", E1: "6273a557-b1a4-495a-8f75-2669e33e7765" };
}
const saveMapping = () => writeFileSync(MAPPING_FILE, JSON.stringify(MAPPING, null, 2));
// trade data.js 贷款清单：编码 → 银行名（备付表按银行名记账）
const BANK_OF = { A1: "徽商银行", A2: "宁波银行", A3: "交通银行", A4: "中信银行", B1: "华夏银行", B2: "江苏银行", C1: "招商银行", C2: "工商银行", C3: "农业银行", C4: "工商银行", D1: "农业银行信用卡", D2: "建设银行", D3: "徽商银行", E1: "家人" };

// ---- 拉取最新快照 ----
const res = await fetch(STORE_URL);
if (!res.ok) {
  console.error(`[sync-debt] 拉取失败：HTTP ${res.status}`);
  process.exit(1);
}
const { items } = await res.json();
const storeGet = (key, fallback) => {
  const raw = items.find((i) => i.key === key)?.v;
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};
const snapshots = storeGet("asset_snapshots_v1", []);
const reserve = storeGet("asset_repay_reserve_v1", {});
const loanCfg = storeGet("asset_loans_config_v1", { overrides: {}, custom: [] });
if (!snapshots.length) {
  console.error("[sync-debt] 快照为空，结束");
  process.exit(1);
}
const latest = snapshots.reduce((a, b) => (a.date > b.date ? a : b));
console.log(`[sync-debt] 最新快照 ${latest.date}（${Object.keys(latest.loans).length} 笔贷款）note=${latest.note || "-"}`);

// ---- 数据库连接（读 shiguangri/.env 的 DATABASE_URL）----
// .env 优先取环境变量；默认为生产应用目录（repo 目录无 .env）
const envPath = process.env.SHIGUANGRI_ENV ?? "/opt/shiguangri/.env";
const env = readFileSync(envPath, "utf8");
const databaseUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!databaseUrl) {
  console.error("[sync-debt] .env 缺 DATABASE_URL");
  process.exit(1);
}
const client = new Client({ connectionString: databaseUrl });
await client.connect();

const { rows: userRows } = await client.query(`select id from profiles where phone = $1`, [USER_PHONE]);
const userId = userRows[0]?.id;
if (!userId) {
  console.error(`[sync-debt] 找不到账户 ${USER_PHONE}`);
  process.exit(1);
}

// ---- 逐编码更新余额 ----
const updates = [];
const created = [];
for (const [code, wan] of Object.entries(latest.loans)) {
  let liabilityId = MAPPING[code];
  const balanceCents = Math.round(Number(wan) * 1_000_000);
  if (!liabilityId && code !== "B1") {
    // 自动建档（REQ-009 滚动）：名称 = NAME_OVERRIDES 或 "trade <code>"，note 打同步标记；
    // 建档后写回映射文件（自学习），余额/月供随每日同步更新
    const name = NAME_OVERRIDES[code] ?? `trade ${code}`;
    if (dry) {
      console.log(`[sync-debt][dry] 将建档 ${code}「${name}」余额 ${balanceCents / 100} 元`);
      liabilityId = "(dry)";
    } else {
      const r = await client.query(
        `insert into liabilities (user_id, name, type, principal_cents, balance_cents, note)
         values ($1, $2, 'consumer_loan', $3, $3, $4) returning id`,
        [userId, name, balanceCents, `trade:${code} 同步托管（trade 为准，勿手改余额）`],
      );
      liabilityId = r.rows[0].id;
      MAPPING[code] = liabilityId;
      saveMapping();
      console.log(`[sync-debt] 已建档 ${code}「${name}」${balanceCents / 100} 元 ✓`);
      created.push(code);
    }
  }
  if (liabilityId) updates.push({ code, liabilityId, balanceCents });
}

let changed = 0;
for (const { code, liabilityId, balanceCents } of updates) {
  const { rows } = await client.query(
    `select balance_cents, name from liabilities where id = $1 and user_id = $2`,
    [liabilityId, userId],
  );
  if (!rows[0]) {
    console.warn(`[sync-debt] ${code}: 负债 ${liabilityId} 不存在，跳过`);
    continue;
  }
  const before = rows[0].balance_cents;
  if (before === balanceCents) {
    console.log(`[sync-debt] ${code} ${rows[0].name}: ${balanceCents / 100} 元（无变化）`);
    continue;
  }
  if (dry) {
    console.log(`[sync-debt][dry] ${code} ${rows[0].name}: ${before / 100} → ${balanceCents / 100} 元`);
  } else {
    await client.query(`update liabilities set balance_cents = $1, updated_at = now() where id = $2`, [
      balanceCents,
      liabilityId,
    ]);
    console.log(`[sync-debt] ${code} ${rows[0].name}: ${before / 100} → ${balanceCents / 100} 元 ✓`);
  }
  changed += 1;
}

// ---- 每月备付镜像（trade_reserve_banks）：复刻 trade 备付核心.js 的需还矩阵，与该页逐行同源 ----
// trade 三层口径：静态 RULES（备付核心.js）→ 用户月供覆盖（asset_loans_config_v1.overrides）
// → 自定义负债（asset_loans_config_v1.custom，group 非 family 全部计入）。
const RANGE_START = "2026-09"; // 与 trade FLOOR 对齐（cur 下限）
const RANGE_END = "2033-09"; // 与 trade CAP 对齐
const toCents = (v) => Math.round(Number(v) * 100);
const nextYm = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

function loadTradeMatrix() {
  // data.js：纯数据 IIFE，挂 window.DB（沙箱执行，selfCheck 只用 console.assert）
  const dataSrc = readFileSync(join(TRADE_HOME, "资产", "data.js"), "utf8");
  const sandbox = {};
  new Function("window", dataSrc)(sandbox);
  const loans = (sandbox.DB?.loans ?? []).map((l) => ({
    priority: l.priority,
    bank: String(l.bank ?? ""),
    payDay: l.payDay,
    group: l.group,
  }));
  if (!loans.some((l) => l.priority === "A1")) throw new Error("data.js 解析异常（无 A1）");

  // 备付核心.js：DOM 重度耦合，只提取 RULES 字面量求值（以「// 用户覆盖」注释为右边界）
  const coreSrc = readFileSync(join(TRADE_HOME, "资产", "备付核心.js"), "utf8");
  const m = coreSrc.match(/const RULES = (\{[\s\S]*?\n {2}\});/);
  if (!m) throw new Error("备付核心.js 未找到 RULES 矩阵");
  const rules = new Function(`return (${m[1]})`)();
  if (!rules.A1 || !rules.D2) throw new Error("RULES 解析异常（缺 A1/D2）");

  // 用户覆盖：月供覆盖按平值（删 steps），与备付核心.js 同逻辑
  for (const [p, ov] of Object.entries(loanCfg.overrides ?? {})) {
    if (rules[p] && ov?.monthly !== undefined && ov.monthly !== null && ov.monthly !== "") {
      rules[p].monthly = Number(ov.monthly);
      delete rules[p].steps;
    }
  }
  // 自定义负债 → 追加贷款 + 规则
  for (const l of loanCfg.custom ?? []) {
    if (!l?.p) continue;
    loans.push({ priority: l.p, bank: String(l.bank ?? ""), payDay: l.payDay, group: undefined });
    rules[l.p] = { monthly: Number(l.monthlyVal) || 0, until: l.clearDate || "2033-08" };
  }
  return { loans, rules };
}

// —— 与 trade 备付核心.js 逐行同口径的矩阵计算（勿改语义）——
const CAP_YM = "2033-09";
function monthlyOf(rules, p, ym) {
  const r = rules[p];
  if (!r || ym > r.until || ym > CAP_YM) return { pay: 0, extra: 0 };
  if (r.from && ym < r.from) return { pay: 0, extra: 0 };
  let pay = r.monthly;
  if (r.steps) {
    pay = 0;
    for (const [from, v] of r.steps) if (ym >= from) pay = v;
  }
  const extra = r.extras && r.extras[ym] ? r.extras[ym] : 0;
  return { pay, extra };
}
const bankKey = (b) => (b === "农业银行信用卡" ? "农业银行" : b); // trade 同款合并（农行 C3+信用卡 D1 一行）
function monthGroups(loans, rules, ym) {
  const plan = loans
    .filter((l) => l.group !== "family")
    .map((l) => {
      const { pay, extra } = monthlyOf(rules, l.priority, ym);
      return { p: l.priority, bank: l.bank, payDay: l.payDay, pay, extra, need: pay + extra };
    })
    .filter((r) => r.need > 0);
  const P2BANK = {};
  loans.forEach((l) => {
    P2BANK[l.priority] = bankKey(l.bank);
  });
  const order = [];
  const map = {};
  for (const r of plan) {
    const k = P2BANK[r.p];
    if (!map[k]) {
      map[k] = { bank: k, parts: [], payDays: [] };
      order.push(k);
    }
    map[k].parts.push(r);
    if (r.payDay != null && !map[k].payDays.includes(String(r.payDay))) map[k].payDays.push(String(r.payDay));
  }
  return order.map((k) => {
    const g = map[k];
    g.pay = g.parts.reduce((s, r) => s + r.pay, 0);
    g.extra = g.parts.reduce((s, r) => s + r.extra, 0);
    g.need = g.pay + g.extra;
    g.prios = g.parts.map((r) => r.p).join("＋");
    return g;
  });
}

try {
  const { loans, rules } = loadTradeMatrix();
  const allGroups = new Map(); // ym → groups（sources 归类复用）
  const mirrorRows = []; // 与 trade 表同序（seq = 组序）
  for (let ym = RANGE_START; ym <= RANGE_END; ym = nextYm(ym)) {
    const groups = monthGroups(loans, rules, ym);
    allGroups.set(ym, groups);
    const monthData = reserve[ym] ?? {};
    groups.forEach((g, seq) => {
      const savedRaw = monthData[g.bank];
      mirrorRows.push({
        ym,
        seq,
        bank: g.bank,
        prios: g.prios,
        parts: g.parts.map((r) => ({ p: r.p, payCents: toCents(r.pay), extraCents: toCents(r.extra), payDay: String(r.payDay ?? "") })),
        payDays: g.payDays.join("/"),
        payCents: toCents(g.pay),
        extraCents: toCents(g.extra),
        needCents: toCents(g.need),
        savedCents: savedRaw === undefined || savedRaw === null || savedRaw === "" ? null : toCents(savedRaw),
        members: [...new Set(g.parts.map((r) => MAPPING[r.p]).filter((x) => x && x !== "(dry)"))],
      });
    });
  }
  if (dry) {
    const oct = allGroups.get("2026-10") ?? [];
    console.log(
      `[sync-debt][dry] 镜像 ${mirrorRows.length} 行；2026-10: ` +
        oct.map((g) => `${g.bank} ${toCents(g.need) / 100}`).join("、"),
    );
  } else {
    await client.query("begin");
    await client.query(`delete from trade_reserve_banks where user_id = $1`, [userId]);
    try {
      const CHUNK = 40;
      for (let i = 0; i < mirrorRows.length; i += CHUNK) {
        const slice = mirrorRows.slice(i, i + CHUNK);
        const vals = [];
        const params = [userId];
        slice.forEach((r, j) => {
          const b = j * 11;
          vals.push(
            `($1,$${b + 2}::date,$${b + 3},$${b + 4},$${b + 5},$${b + 6}::jsonb,$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11}::bigint,$${b + 12}::uuid[])`,
          );
          params.push(`${r.ym}-01`, r.seq, r.bank, r.prios, JSON.stringify(r.parts), r.payDays, r.payCents, r.extraCents, r.needCents, r.savedCents, r.members);
        });
        await client.query(
          `insert into trade_reserve_banks
           (user_id, ym, seq, bank, prios, parts, pay_days, pay_cents, extra_cents, need_cents, saved_cents, members)
           values ${vals.join(",")}
           on conflict (user_id, ym, bank) do update set
             seq = excluded.seq, prios = excluded.prios, parts = excluded.parts, pay_days = excluded.pay_days,
             pay_cents = excluded.pay_cents, extra_cents = excluded.extra_cents, need_cents = excluded.need_cents,
             saved_cents = excluded.saved_cents, members = excluded.members, synced_at = now()`,
          params,
        );
      }
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    }
    const oct10 = (allGroups.get("2026-10") ?? []).reduce((s, g) => s + toCents(g.need), 0);
    console.log(
      `[sync-debt] 备付镜像：${mirrorRows.length} 行（${RANGE_START}~${RANGE_END}）；2026-10 需还合计 ${oct10 / 100} 元`,
    );
  }

  // 储蓄账户（资金来源）：reserve 键 - 当月还款银行名（0 元占位行跳过）→ debt_reserve_sources
  if (!dry) {
    let srcN = 0;
    for (const [ym, kv] of Object.entries(reserve)) {
      const bankNames = new Set((allGroups.get(ym) ?? []).map((g) => g.bank));
      const keep = [];
      for (const [name, amount] of Object.entries(kv)) {
        const cents = toCents(amount);
        if (!Number.isFinite(cents)) continue;
        if (bankNames.has(name) || cents === 0) continue;
        await client.query(
          `insert into debt_reserve_sources (user_id, ym, name, planned_cents, source)
           values ($1, $2, $3, $4, 'trade')
           on conflict (user_id, ym, name) do update set planned_cents = $4, source = 'trade'`,
          [userId, `${ym}-01`, name, cents],
        );
        keep.push(name);
        srcN += 1;
      }
      // 该月已不在 reserve 里的存量来源行清掉（trade 侧删除/清空后不残留）
      await client.query(
        `delete from debt_reserve_sources where user_id = $1 and ym = $2 and source = 'trade' and name <> all($3::text[])`,
        [userId, `${ym}-01`, keep.length ? keep : ["__none__"]],
      );
    }
    console.log(`[sync-debt] 储蓄账户（资金来源）：${srcN} 条`);
  }

  // ---- 备付计划金额 → debt_reserve_checks.planned_cents（历史口径保留；展示以 trade_reserve_banks 为准）----
  let liabN = 0;
  const unmappedBanks = [];
  for (const [ym, banks] of Object.entries(reserve)) {
    const bankNames = new Set((allGroups.get(ym) ?? []).map((g) => g.bank));
    for (const [bank, amount] of Object.entries(banks)) {
      const cents = toCents(amount);
      if (!Number.isFinite(cents) || cents === 0 || !bankNames.has(bank)) continue; // 只处理还款银行行
      // 编码表精确匹配（含 R: 备付专用键与信用卡后缀兜底；华夏银行 vs 华夏银行信用卡 严禁吞行）
      let liabilityId = MAPPING[`R:${bank}`];
      let code = null;
      if (!liabilityId) {
        code = Object.keys(BANK_OF).find((c) => BANK_OF[c] === bank) ?? null;
        liabilityId = code ? MAPPING[code] : null;
      }
      if (!liabilityId || liabilityId === "(dry)") {
        const sameName = await client.query(
          `select id from liabilities where user_id = $1 and name = $2 and status = 'active' limit 1`,
          [userId, bank],
        );
        if (sameName.rows[0]) {
          liabilityId = sameName.rows[0].id;
        } else if (bank.endsWith("信用卡")) {
          const stem = bank.slice(0, -3);
          const stemCode = Object.keys(BANK_OF).find((c) => BANK_OF[c] === stem);
          liabilityId = stemCode ? MAPPING[stemCode] : null;
        }
      }
      if (!liabilityId || liabilityId === "(dry)") {
        if (code) {
          unmappedBanks.push(`${bank}(${code} 未绑定)`);
          continue;
        }
        if (dry) continue;
        const r = await client.query(
          `insert into liabilities (user_id, name, type, principal_cents, balance_cents, note)
           values ($1, $2, 'credit_card', 0, 0, $3) returning id`,
          [userId, bank, `trade:${bank} 备付同步托管（无余额，仅月度备付行）`],
        );
        liabilityId = r.rows[0].id;
        MAPPING[`R:${bank}`] = liabilityId;
        saveMapping();
        console.log(`[sync-debt] 备付建档「${bank}」（仅备付行，余额 0）`);
      }
      if (liabilityId === "(dry)") continue;
      // dry-run 契约：预览只计数不落库（旧版已映射行会照常 upsert，违背结尾「dry-run 未写库」承诺）
      if (!dry) {
        await client.query(
          `insert into debt_reserve_checks (user_id, ym, liability_id, planned_cents, source)
           values ($1, $2, $3, $4, 'trade')
           on conflict (user_id, ym, liability_id)
           do update set planned_cents = $4, source = 'trade'`,
          [userId, `${ym}-01`, liabilityId, cents],
        );
      }
      liabN += 1;
    }
  }
  console.log(`[sync-debt] 备付计划金额：负债行 ${liabN} 条`);
  if (unmappedBanks.length) console.warn(`[sync-debt] ⚠ 备付未匹配：${unmappedBanks.join("、")}`);
} catch (e) {
  console.warn(`[sync-debt] 备付镜像同步失败（不影响余额同步）：`, String(e).slice(0, 200));
}

if (created.length) {
  console.warn(`[sync-debt] ⚠ 新建档（请到界面改成真实名称）：${created.join("、")}`);
}
console.log(`[sync-debt] 完成：${changed} 笔需同步${dry ? "（dry-run 未写库）" : "，已写库"}`);
await client.end();
