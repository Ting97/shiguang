#!/usr/bin/env node
/**
 * trade → shiguang 负债余额定时同步（REQ-009 滚动，2026-10-04）。
 *
 * 源：trade.ting97.cn 资产模块「资产负债记账」快照（asset_snapshots_v1，万元，
 *     经 dashboard :3030 /api/asset/store 暴露；用户在 trade 页面逐笔录入/修订）。
 * 目标：shiguang liabilities——账户 15091587905（USER_PHONE）名下、在 MAPPING 中登记的负债。
 * 语义：**只更新余额**（balance_cents = 快照万 × 1e6），不新增/删除/改月供利率——
 *      shiguang 侧该批负债视为 trade 只读镜像；映射外的编码每次运行时报告。
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
const STORE_URL =
  process.env.TRADE_STORE_URL ?? "http://127.0.0.1:3030/api/asset/store?keys=asset_snapshots_v1";
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
const BANK_OF = { A1: "徽商银行", A2: "宁波银行", A3: "交通银行", A4: "中信银行", B1: "信用卡", B2: "江苏银行", C1: "招商银行", C2: "工商银行", C3: "农业银行", C4: "工商银行", D1: "农业银行信用卡", D2: "建设银行", D3: "徽商银行", E1: "家人" };

// ---- 拉取最新快照 ----
const res = await fetch(STORE_URL);
if (!res.ok) {
  console.error(`[sync-debt] 拉取失败：HTTP ${res.status}`);
  process.exit(1);
}
const { items } = await res.json();
const snapshots = JSON.parse(items.find((i) => i.key === "asset_snapshots_v1")?.v ?? "[]");
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

// ---- 每月备付计划金额同步（asset_repay_reserve_v1 → debt_reserve_checks.planned_cents，trade 为准）----
try {
  const res2 = await fetch("http://127.0.0.1:3030/api/asset/store?keys=asset_repay_reserve_v1");
  if (res2.ok) {
    const j2 = await res2.json();
    const reserve = JSON.parse(j2.items.find((i) => i.key === "asset_repay_reserve_v1")?.v ?? "{}");
    let reserveN = 0;
    for (const [ym, banks] of Object.entries(reserve)) {
      for (const [bank, amount] of Object.entries(banks)) {
        const code = Object.keys(BANK_OF).find((c) => BANK_OF[c] === bank || bank.startsWith(BANK_OF[c]));
        const liabilityId = code ? MAPPING[code] : null;
        if (!liabilityId || liabilityId === "(dry)" || !Number.isFinite(Number(amount))) continue;
        await client.query(
          `insert into debt_reserve_checks (user_id, ym, liability_id, planned_cents, source)
           values ($1, $2, $3, $4, 'trade')
           on conflict (user_id, ym, liability_id)
           do update set planned_cents = $4, source = 'trade'`,
          [userId, `${ym}-01`, liabilityId, Math.round(Number(amount) * 100)],
        );
        reserveN += 1;
      }
    }
    console.log(`[sync-debt] 备付计划金额同步 ${reserveN} 条`);
  }
} catch (e) {
  console.warn(`[sync-debt] 备付同步失败（不影响余额同步）：`, String(e).slice(0, 120));
}

if (created.length) {
  console.warn(`[sync-debt] ⚠ 新建档（请到界面改成真实名称）：${created.join("、")}`);
}
console.log(`[sync-debt] 完成：${changed} 笔需同步${dry ? "（dry-run 未写库）" : "，已写库"}`);
await client.end();
