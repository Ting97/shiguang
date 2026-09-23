/**
 * 核心四模块 service 层集成测试（REQ-004 FR-F1.2 / AC-5 覆盖率门槛载体）：
 * 进程内直调 service（除 identity/auth.ts 外均不依赖 Next 请求作用域），真实 SQL 落测试库。
 * AI 相关路径在无 KEY 环境走规则兜底/降级分支——确定性、零网络。
 * 与 routes-smoke 共用测试库约定（SHIGUANGRI_TEST_DB / .env 派生），不可达整组 skip。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const UA = "11111111-1111-4111-8111-111111111111";

let pool: any;
let loaded = false;
let dbReady = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  // 安全护栏：未显式指定测试库时不动真实数据库（整组 skip）
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  delete process.env.ZHIPUAI_API_KEY; // 强制走规则兜底分支（确定性、零网络）
  delete process.env.TYPESAFE_API_KEY;
  ({ pool } = await import("../src/server/platform/db"));
  try {
    const { rows } = await pool.query("select to_regclass('public.profiles') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

async function upsertUser(id: string, nickname: string, role = "user") {
  await pool.query(
    `insert into profiles (id, nickname, role) values ($1,$2,$3)
     on conflict (id) do update set role = excluded.role`,
    [id, nickname, role],
  );
}

/* ---------- timeline：采集→识别→确认→流→编辑→删除 ---------- */

test("timeline：ingest 规则兜底落库 → listFeed 可检索", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(UA, "svc测试A", "admin");
  const { PRESET_ACTIVITIES } = await import("../src/server/time/seed");
  for (const a of PRESET_ACTIVITIES) {
    await pool.query(
      `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
       values ($1,$2,$3,$4,$5,$6,$7,true) on conflict (id, user_id) do nothing`,
      [a.id, UA, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
    );
  }
  const { ingest, listFeed } = await import("../src/server/timeline");
  const { entry } = await ingest(UA, "昨天下午和小陈吃饭花了260，吃得挺开心");
  assert.ok(entry?.id, "ingest 应返回 entry");

  // 后台识别为 fire-and-forget：轮询至 analyzed_at 落库（规则引擎应当秒级）
  let analyzed = false;
  for (let i = 0; i < 20 && !analyzed; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const { rows } = await pool.query("select analyzed_at from entries where id = $1", [entry.id]);
    analyzed = Boolean(rows[0]?.analyzed_at);
  }
  assert.ok(analyzed, "规则兜底识别应落 analyzed_at");

  const feed = await listFeed(UA, { limit: 10, offset: 0, q: "小陈", spaceId: "all" } as any);
  const items = (feed as any).moments ?? [];
  assert.ok(Array.isArray(items), "listFeed 应返回 moments 列表");
  assert.ok(items.some((e: any) => e.id === entry.id), "feed 应含刚发布的动态（搜索命中）");
});

test("timeline：confirmPending 待确认域应用/忽略语义", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { confirmPending } = await import("../src/server/timeline");
  await assert.rejects(
    () => confirmPending(UA, crypto.randomUUID(), undefined),
    /domain 必填/,
    "缺 domain 应 400",
  );
  await assert.rejects(
    () => confirmPending(UA, crypto.randomUUID(), "schedule"),
    /没有待确认/,
    "不存在 entry 应 404 语义",
  );
});

test("timeline：patchFeed 空间归属校验/正文重识别，deleteFeed 级联清理", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { ingest, patchFeed, deleteFeed } = await import("../src/server/timeline");
  const { entry } = await ingest(UA, "冒烟编辑重识别测试句");

  await assert.rejects(
    () => patchFeed(UA, entry.id, { spaceId: crypto.randomUUID() } as any),
    /空间不存在/,
    "他人空间归属应 400",
  );

  const patched = await patchFeed(UA, entry.id, { raw_text: "改成中午吃火锅花了88" } as any);
  assert.ok((patched as any).ok, "正文编辑应成功");

  const del = await deleteFeed(UA, entry.id);
  assert.ok(del, "删除应成功");
  const { rows } = await pool.query("select 1 from entries where id = $1", [entry.id]);
  assert.equal(rows.length, 0, "entry 应物理删除");
});

/* ---------- finance：负债域 ---------- */

test("finance：validateDebtBody 全字段校验 + 模拟策略", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { validateDebtBody, simulateStrategy } = await import("../src/server/finance");
  const expectMsg = (body: Record<string, unknown>, partial: boolean, re: RegExp) => {
    try {
      validateDebtBody(body, partial);
    } catch (e: any) {
      assert.match(String(e?.message ?? e), re);
      return;
    }
    assert.fail(`应当抛出 ${re}`);
  };
  expectMsg({ name: "" }, false, /名称/);
  expectMsg({ name: "x", type: "bad" }, false, /类型/);
  expectMsg({ name: "x", type: "credit_card", principalCents: -1 }, false, /本金/);
  expectMsg({ name: "x", type: "credit_card", principalCents: 1, ratePct: 99 }, false, /年化/);
  expectMsg({ name: "x", type: "credit_card", principalCents: 1, dueDate: "bad" }, false, /到期日/);
  const ok = validateDebtBody(
    { name: "信用卡", type: "credit_card", principalCents: 500000, balanceCents: 100000, ratePct: 18.5, payDay: 10 },
    false,
  );
  assert.equal(ok.rate_pct, 18.5, "rate 应保留两位");

  const sim = simulateStrategy(
    [{ id: "d1", name: "冒烟信用卡", balanceCents: 600000, ratePct: 15, monthlyCents: 50000 }],
    20000,
    "avalanche",
    "2026-09",
  );
  assert.ok(sim, "模拟应产出计划");
});

test("ai：配额三态（pro 无限/免费窗口/admin）与审计写入", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { checkAiQuota, isProValid } = await import("../src/server/ai");
  const q = await checkAiQuota(UA);
  assert.ok(typeof q.used === "number" && (q.limit === null || typeof q.limit === "number"), "配额应返回数值口径");
  assert.equal(typeof q.allowed, "boolean");
  assert.ok(!isProValid("", null), "非 pro 套餐");

  const { writeAuditRecord, auditHealth } = await import("../src/server/ai");
  await writeAuditRecord({
    userId: UA,
    stage: "parse",
    model: "test-model",
    ok: true,
    latencyMs: 12,
    promptTokens: 0,
    completionTokens: 0,
  });
  const health = await auditHealth?.();
  assert.ok(health !== undefined, "auditHealth 应可读");
});

test("ai：提示词读取/失效缓存/装配（DB 版本链路）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { getPrompt, getPromptBundle, assembleUserPrompt, invalidatePrompts } = await import("../src/server/ai");
  const key = "extract_open_vocab";
  const sys = await getPrompt(key as any);
  assert.ok(sys && sys.length > 20, "应取到生效中的 system 提示词");
  const bundle = await getPromptBundle(key as any);
  assert.ok(bundle.system && "userTemplate" in bundle, "三件套应齐");
  invalidatePrompts?.();
  const assembled = assembleUserPrompt(key as any, bundle, { now: "2026-09-23 12:00" });
  assert.ok(typeof assembled === "string", "装配应产出用户提示词字符串");
});

test("ai：Jev 模式开关（DB 覆盖 + 失效缓存）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { getJevMode, setJevMode, invalidateAiMode } = await import("../src/server/ai");
  await setJevMode("off", UA);
  invalidateAiMode?.();
  assert.equal(await getJevMode(), "off");
  await setJevMode("shadow", UA);
  invalidateAiMode?.();
  assert.equal(await getJevMode(), "shadow");
});

/* ---------- identity：注册校验/资料/会话语义（cookie-free 部分） ---------- */

test("identity：validateRegisterIdentity 与 setup 令牌门禁", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { validateRegisterIdentity, assertSetupToken } = await import("../src/server/identity");
  assert.throws(() => validateRegisterIdentity({ phone: "123" }), /手机号/);
  assert.throws(() => validateRegisterIdentity({ email: "bad" }), /邮箱/);
  assert.equal(validateRegisterIdentity({ phone: "13800001234" }), false, "手机号通道");
  assert.equal(validateRegisterIdentity({ email: "a@b.co" }), true, "邮箱通道");
  // 未配置 SETUP_TOKEN：门禁直通；配置后错误令牌被拒（FR-C2.3 语义）
  delete process.env.SETUP_TOKEN;
  await assertSetupToken(null); // 未配置 → 直通不抛
  process.env.SETUP_TOKEN = "smoke-token";
  await assert.rejects(() => assertSetupToken("wrong"), /令牌/);
  delete process.env.SETUP_TOKEN;
});

test("identity：me 模块授权聚合与 updateProfile 改密链路", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { me, updateProfile } = await import("../src/server/identity");
  const info = await me({ id: UA, nickname: "svc测试A", phone: null, role: "admin" });
  assert.ok(info.id === UA && Array.isArray(info.modules), "me 应聚合模块授权");

  await updateProfile(UA, { nickname: "svc测试A改" });
  // 改密：先直接落一个已知密码哈希
  const crypto = await import("node:crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync("old-password-8", Buffer.from(salt, "hex"), 64, { N: 16384 }).toString("hex");
  await pool.query(`update profiles set password_hash = $1 where id = $2`, [`scrypt$16384$${salt}$${derived}`, UA]);
  await assert.rejects(
    () => updateProfile(UA, { currentPassword: "wrong-password-1", newPassword: "new-password-8" }),
    /密码/,
    "当前密码错误应拒绝",
  );
  await updateProfile(UA, { currentPassword: "old-password-8", newPassword: "new-password-8" });
  const { rows } = await pool.query("select password_hash from profiles where id = $1", [UA]);
  const [, n, s, h] = rows[0].password_hash.split("$");
  assert.ok(crypto.scryptSync("new-password-8", Buffer.from(s, "hex"), 64, { N: Number(n) }).toString("hex") === h, "新密码应可验证");
});

test("identity：register 邀请码链路（无效/有效→建号→重复拒绝）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { register } = await import("../src/server/identity");
  // 无 KEY 环境：验证码通道未开通 → smsCode 可空（凭邀请码注册）。
  // 注意：register 成功路径内部 createSession 依赖 Next 请求作用域（cookies()），进程内只能测前置校验；
  // 成功建号链路由 test:routes 的 E2E 冒烟覆盖。
  await assert.rejects(() => register({ nickname: "", phone: "13800001234", password: "password-8", inviteCode: "X" } as any), /昵称/);
  await assert.rejects(() => register({ nickname: "svc", phone: "13800001234", password: "short", inviteCode: "X" } as any), /密码/);
  await assert.rejects(() => register({ nickname: "svc", phone: "13800001234", password: "password-8", inviteCode: "" } as any), /邀请码/);
  await assert.rejects(() => register({ nickname: "svc", phone: "13800001234", password: "password-8", inviteCode: "BADCODE" } as any), /邀请码/);
});

test("timeline：appendManual 手动补录域与非法域", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { ingest, appendManual, deleteFeed } = await import("../src/server/timeline");
  const { entry } = await ingest(UA, "冒烟手动补录底稿");
  await assert.rejects(
    () => appendManual(UA, entry.id, { domain: "bad", payload: {} }),
    /domain 需为/,
    "非法 domain 应 400",
  );
  const ok = await appendManual(UA, entry.id, {
    domain: "todo",
    payload: { title: "冒烟补录待办" },
  });
  assert.ok(ok, "手动补录 todo 应成功");
  await deleteFeed(UA, entry.id);
});

test("identity：验证码通道未配置时的错误语义", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { sendSms, sendEmail } = await import("../src/server/identity");
  await assert.rejects(() => sendSms({ phone: "13800001234" }), /发送失败|通道|未配置/);
  await assert.rejects(() => sendEmail({ email: "a@b.co" }), /发送失败|通道|未配置/);
});

test("finance：负债导入判重/幂等（R2）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  // 幂等清理：上次运行残留
  await pool.query(`delete from liabilities where user_id = $1 and name like 'svc%'`, [UA]);
  await pool.query(`delete from accounts where user_id = $1 and name like 'svc%'`, [UA]);
  const { importDebtsPreview, importDebtsCommit } = await import("../src/server/finance");
  const data = {
    liabilities: [
      { name: "svc导入银行", type: "mortgage", principalCents: 50000000, balanceCents: 50000000, ratePct: 3, monthlyCents: 50000, payDay: 9, dueDate: "2028-05-01", priority: 2, note: "svc" },
      { name: "svc家人", type: "family", principalCents: 10000000, ratePct: 0, monthlyCents: null, payDay: null, dueDate: null, priority: 5, note: null },
    ],
    accounts: [{ name: "svc迁移账户", openingBalanceCents: 5660000 }],
  };
  const p1 = await importDebtsPreview(UA, data);
  assert.equal(p1.rows.filter((r) => r.action === "create").length, 2, "首跑两行均为 create");
  const c1 = await importDebtsCommit(UA, data);
  assert.equal(c1.created, 2, "提交创建 2 笔");
  assert.equal(c1.accountsCreated, 1, "创建 1 个账户");
  const c2 = await importDebtsCommit(UA, data);
  assert.equal(c2.created, 0, "重复提交零新建");
  assert.equal(c2.skipped, 2, "重复提交全部 skip（幂等）");
  const p2 = await importDebtsPreview(UA, data);
  assert.ok(p2.rows.every((r) => r.action === "skip"), "二跑预览全 skip");
});

test("finance：备付清单计算/勾选/还款联动（R3）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`delete from liabilities where user_id = $1 and name like 'svc%'`, [UA]);
  await pool.query(`delete from debt_reserve_checks where user_id = $1`, [UA]);
  const { reserveOverview, setReserveCheck, autoCheckAfterPayment, currentMonthFirst } = await import("../src/server/finance");
  const ym = currentMonthFirst().slice(0, 7);
  // 建两笔：一笔月供+当月到期；一笔无月供无到期（家人）
  const ins = await pool.query(
    `insert into liabilities (user_id, name, type, principal_cents, balance_cents, rate_pct, monthly_cents, pay_day, due_date, priority, status)
     values
       ($1,'svc备付银行','mortgage',50000000,30000000,3,50000,9,$2,2,'active'),
       ($1,'svc家人','family',10000000,10000000,0,null,null,null,5,'active')
     returning id, name`,
    [UA, `${ym}-28`],
  );
  const bankId = ins.rows.find((r: any) => r.name === "svc备付银行").id;
  const famId = ins.rows.find((r: any) => r.name === "svc家人").id;

  const ov = await reserveOverview(UA, ym);
  const bank = ov.items.find((r) => r.name === "svc备付银行");
  assert.ok(bank, "银行行应存在");
  // 月供 50000 + 当月到期本金 30000000（due 2026-09-28 落 2026-09）
  const ymMonth = `${ym}-28`;
  const inMonth = ymMonth.slice(0, 7) === `${ym}`;
  assert.equal(bank.extra, inMonth ? 30000000 : 0, "到期本金仅当月计入");
  assert.equal(bank.pay, 50000);
  assert.equal(bank.checked, false, "初始未勾选");
  assert.ok(ov.items.some((r) => r.name === "svc家人"), "家人行应合并出现");

  // 勾选单项
  await setReserveCheck(UA, { ym, liabilityId: bankId, checked: true });
  const ov2 = await reserveOverview(UA, ym);
  assert.equal(ov2.items.find((r) => r.name === "svc备付银行")?.checked, true, "单项勾选生效");

  // 一键清空
  await setReserveCheck(UA, { ym, all: false, checked: false });
  const ov3 = await reserveOverview(UA, ym);
  assert.ok(ov3.items.every((r) => !r.checked), "一键清空生效");

  // 还款联动：还款 ≥ need（50000+30000000）→ 自动勾选
  await autoCheckAfterPayment(UA, bankId, 30050000);
  const ov4 = await reserveOverview(UA, ym);
  assert.equal(ov4.items.find((r) => r.name === "svc备付银行")?.checked, true, "还款联动自动勾选");

  // 清理
  await pool.query(`delete from liabilities where id in ($1,$2)`, [bankId, famId]);
});

test("trading：导入去重/日聚合/权益曲线/明细/摘要（R1）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  delete process.env.ZHIPUAI_API_KEY; // review 503 分支需要
  // 幂等清理：上次运行残留
  await pool.query(`delete from trade_accounts where user_id = $1`, [UA]);
  const f = await import("../src/server/finance");
  const rows: any[] = [
    { ticket: 1001, direction: "buy", openTime: "2026-09-20T03:00:00Z", closeTime: "2026-09-21T04:30:00Z", lots: 0.5, profit: 120, commission: -2, swap: 0 },
    { ticket: 1002, direction: "sell", openTime: "2026-09-21T08:00:00Z", closeTime: "2026-09-21T10:00:00Z", lots: 1, profit: -80, commission: -2, swap: -1 },
    { ticket: 1003, direction: "buy", openTime: "2026-09-22T02:00:00Z", closeTime: "2026-09-22T05:00:00Z", lots: 0.5, profit: 60, commission: -2, swap: 0 },
  ];
  const dry = await f.importTrades(UA, { dryRun: true, login: "90099", fileName: "t.xlsx", source: "mt5_xlsx", rows });
  assert.equal(dry.rowsNew, 3, "首跑 dryRun 全新");
  const c = await f.importTrades(UA, { dryRun: false, login: "90099", nickname: "svc账号", fileName: "t.xlsx", source: "mt5_xlsx", rows });
  assert.equal(c.rowsNew, 3);
  const dry2 = await f.importTrades(UA, { dryRun: true, login: "90099", fileName: "t.xlsx", source: "mt5_xlsx", rows });
  assert.equal(dry2.rowsDup, 3, "重复导入全命中去重");

  const accounts = await f.listAccounts(UA);
  const acc = accounts.accounts.find((a: any) => a.login === "90099");
  assert.ok(acc && acc.trades === 3 && acc.winRate === 67, `账号汇总：${JSON.stringify(acc)}`);

  // 北京时区日切：2026-09-21T04:30Z = 北京 12:30（9-21）；08:00Z = 16:00（9-21）
  const daily = await f.dailyPnl(UA, acc.id, "2026-09-01", "2026-09-30");
  const d21 = daily.days.find((d: any) => d.ymd === "2026-09-21");
  assert.ok(d21, "9-21 应有平仓（北京切日）");
  assert.equal(d21.count, 2, "9-21 两笔");
  assert.equal(Number(d21.net.toFixed(2)), 35, "9-21 净额 = 118 + (-83) = 35（含佣金/库存费）");

  const eq = await f.equityCurve(UA, acc.id);
  assert.equal(eq.points.length >= 2, true, "权益曲线至少两天");
  assert.equal(eq.totalNet, 93, "总净盈亏 118-83+58=93");
  assert.ok(eq.phases, "两阶段统计存在");

  const list = await f.listTrades(UA, { accountId: acc.id, dir: "sell" });
  assert.equal(list.total, 1, "sell 筛选 1 笔");
  const big = await f.listTrades(UA, { accountId: acc.id, pnlBand: "bigWin" });
  assert.equal(big.total, 1, "大赢单 1001");

  const digest = await f.buildDigest(UA, acc.id);
  assert.ok(digest.facts.includes("累计净盈亏"), "digest 含素材文案");
  assert.ok(digest.notable.length >= 3, "典型逐笔存在");

  // review：无 KEY → 503 ApiError（E2E 生成链路在预发用真 KEY 验证）
  await assert.rejects(
    () => f.generateTradingReview(UA, acc.id, "admin", false),
    (e: any) => e?.status === 503 || e?.status === 402,
  );
  // 清理
  await pool.query(`delete from trade_accounts where user_id = $1`, [UA]);
});

test("teardown: 清理 svc 测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`delete from invite_codes where created_by = any($1)`, [[UA]]);
  await pool.query(`delete from entries where user_id = any($1)`, [[UA]]);
  await pool.query(`delete from audit_logs where user_id = any($1)`, [[UA]]);
  await pool.query(`delete from app_config where true`, []);
  await pool.query(`update profiles set nickname='svc测试A', password_hash=null where id=$1`, [UA]);
  assert.ok(true);
});
