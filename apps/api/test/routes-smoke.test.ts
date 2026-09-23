/**
 * 70 路由三层冒烟（REQ-004 FR-F1.1 / AC-5）：HTTP 集成测试——打真实本地服务（next dev），中间件/请求作用域/CSRF 全部在真实链路上。
 *   鉴权层：全部鉴权路由无凭证 → 401 {error,code}
 *   权限层：管理员路由/模块门禁用普通用户 → 403
 *   校验层：非法入参 → 400
 *   正常层：九域核心读接口 200 + 写链路 CRUD（自建自删，零残留）
 * 前置：SHIGUANGRI_TEST_DB（测试库连接串）+ SHIGUANGRI_SMOKE_BASE（服务地址，默认 127.0.0.1:3123）；
 * 不可达时整组 skip。日常用 `npm run test:routes` 一键起服/执行/清理。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** 用户 A：管理员（admin 直通模块门禁）；用户 B：普通用户（无模块授权） */
const UA = "11111111-1111-4111-8111-111111111111";
const UB = "22222222-2222-4222-8222-222222222222";

// 惰性加载（tsx CJS 输出无顶层 await）：env 先于 db 模块求值
let pool: any;
let generateSessionToken: any;
let hashToken: any;
let tokA = "";
let tokB = "";
let dbReady = false;
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  // 安全护栏：未显式指定测试库与服务地址时跳过（与真实服务联动的 E2E 套件，误跑会污染库）
  if (!process.env.SHIGUANGRI_TEST_DB || !process.env.SHIGUANGRI_SMOKE_BASE) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
  ({ generateSessionToken, hashToken } = await import("../src/server/identity/auth-crypto"));
  try {
    const { rows } = await pool.query("select to_regclass('public.profiles') as t");
    dbReady = rows[0].t !== null;
  } catch {
    dbReady = false;
  }
}

async function upsertUser(id: string, nickname: string, role: string) {
  await pool.query(
    `insert into profiles (id, nickname, role) values ($1,$2,$3)
     on conflict (id) do update set role = excluded.role`,
    [id, nickname, role],
  );
}

/** HTTP 调用；user 传 null 即匿名（401 层）。写请求自动带同源 Origin/Sec-Fetch-Site（CSRF 真实链路校验放行） */
const BASE = process.env.SHIGUANGRI_SMOKE_BASE ?? "http://127.0.0.1:3123";

async function call(
  method: string,
  path: string,
  opts: { user?: string | null; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const token = opts.user === UA ? tokA : opts.user === UB ? tokB : null;
  const headers: Record<string, string> = {
    origin: BASE,
    "sec-fetch-site": "same-origin",
  };
  if (token) headers.cookie = `shiguang_session=${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test("setup: 测试用户与会话", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达（SHIGUANGRI_TEST_DB）");
  await upsertUser(UA, "冒烟测试A", "admin");
  await upsertUser(UB, "冒烟测试B", "user");
  // createSession 内部调 cookies()（请求作用域），测试里用同构的纯函数直插会话行
  const mk = async (uid: string) => {
    const token = generateSessionToken();
    await pool.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1,$2, now() + interval '1 hour')`,
      [uid, hashToken(token)],
    );
    return token;
  };
  tokA = await mk(UA);
  tokB = await mk(UB);
  assert.ok(tokA && tokB);
});

/* ---------- 鉴权层：全部鉴权路由无凭证 → 401 ---------- */

const AUTHED_GETS: Array<[string, string]> = [
  ["feed", "/api/feed"],
  ["feed/[id]", "/api/feed/x"],
  ["today", "/api/today"],
  ["reminders", "/api/reminders"],
  ["export", "/api/export"],
  ["spaces", "/api/spaces"],
  ["spaces/[id]", "/api/spaces/x"],
  ["spaces/[id]/reflections", "/api/spaces/x/reflections"],
  ["spaces/[id]/reflections/[rid]", "/api/spaces/x/reflections/r"],
  ["todos", "/api/todos"],
  ["todos/[id]", "/api/todos/x"],
  ["blocks/range", "/api/blocks/range"],
  ["activities", "/api/activities"],
  ["activities/[id]", "/api/activities/x"],
  ["contacts", "/api/contacts"],
  ["contacts/[id]", "/api/contacts/x"],
  ["contacts/[id]/interactions", "/api/contacts/x/interactions"],
  ["contacts/[id]/ai-profile", "/api/contacts/x/ai-profile"],
  ["accounts", "/api/accounts"],
  ["accounts/[id]", "/api/accounts/x"],
  ["transactions", "/api/transactions?month=2026-09"],
  ["transactions/[id]", "/api/transactions/x"],
  ["budget", "/api/budget"],
  ["debts", "/api/debts"],
  ["debts/overview", "/api/debts/overview"],
  ["debts/reserve", "/api/debts/reserve?ym=2026-09"],
  ["debts/[id]", "/api/debts/x"],
  ["debts/[id]/payments", "/api/debts/x/payments"],
  ["finance/overview", "/api/finance/overview?month=2026-09"],
  ["finance/stats", "/api/finance/stats"],
  ["finance/review/week", "/api/finance/review/week"],
  ["review", "/api/review"],
  ["stats/range", "/api/stats/range"],
  ["tokens/usage", "/api/tokens/usage"],
  ["auth/me", "/api/auth/me"],
  ["billing/plan", "/api/billing/plan"],
  ["admin/prompts", "/api/admin/prompts"],
  ["admin/invites", "/api/admin/invites"],
  ["admin/grants", "/api/admin/grants"],
  ["admin/ai-mode", "/api/admin/ai-mode"],
  ["admin/prompts/[key]", "/api/admin/prompts/parse"],
  ["billing/users", "/api/billing/users"],
  ["admin/data/categories", "/api/admin/data/categories"],
  ["admin/data/catalog", "/api/admin/data/catalog"],
  ["admin/data/[dataset]", "/api/admin/data/entries?from=2026-09-01&to=2026-09-30"],
  ["files/[...key]", "/api/files/2026/01/x.jpg"],
  ["trading/accounts", "/api/trading/accounts"],
  ["trading/daily", "/api/trading/daily?accountId=x&from=2026-09-01&to=2026-09-30"],
  ["trading/equity", "/api/trading/equity?accountId=x"],
  ["trading/trades", "/api/trading/trades?accountId=x"],
  ["trading/digest", "/api/trading/digest?accountId=x"],
  ["trading/review", "/api/trading/review?accountId=x"],
];

test("鉴权层：无凭证 GET 全部 401", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  for (const [, path] of AUTHED_GETS) {
    const { status, json } = await call("GET", path);
    assert.equal(status, 401, `${path} 匿名 GET 应 401`);
    assert.ok(json.error, `${path} 应返回 error 字段`);
  }
});

test("鉴权层：无凭证写操作全部 401", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const writes: Array<[string, string, string]> = [
    ["POST", "parse", "/api/parse"],
    ["POST", "feed/[id]/dismiss-conflict", "/api/feed/x/dismiss-conflict"],
    ["PATCH", "feed/[id]", "/api/feed/x"],
    ["DELETE", "feed/[id]", "/api/feed/x"],
    ["POST", "entries/[id]/manual", "/api/entries/x/manual"],
    ["POST", "entries/[id]/confirm", "/api/entries/x/confirm"],
    ["POST", "spaces", "/api/spaces"],
    ["PATCH", "spaces/[id]", "/api/spaces/x"],
    ["DELETE", "spaces/[id]", "/api/spaces/x"],
    ["POST", "spaces/[id]/reflections", "/api/spaces/x/reflections"],
    ["POST", "todos", "/api/todos"],
    ["PATCH", "todos/[id]", "/api/todos/x"],
    ["DELETE", "todos/[id]", "/api/todos/x"],
    ["POST", "todos/[id]/decompose", "/api/todos/x/decompose"],
    ["POST", "blocks", "/api/blocks"],
    ["PATCH", "blocks/[id]", "/api/blocks/x"],
    ["DELETE", "blocks/[id]", "/api/blocks/x"],
    ["POST", "activities", "/api/activities"],
    ["PATCH", "activities/[id]", "/api/activities/x"],
    ["DELETE", "activities/[id]", "/api/activities/x"],
    ["POST", "contacts", "/api/contacts"],
    ["PATCH", "contacts/[id]", "/api/contacts/x"],
    ["DELETE", "contacts/[id]", "/api/contacts/x"],
    ["POST", "contacts/[id]/interactions", "/api/contacts/x/interactions"],
    ["POST", "accounts", "/api/accounts"],
    ["PATCH", "accounts/[id]", "/api/accounts/x"],
    ["DELETE", "accounts/[id]", "/api/accounts/x"],
    ["POST", "transactions", "/api/transactions"],
    ["PATCH", "transactions/[id]", "/api/transactions/x"],
    ["DELETE", "transactions/[id]", "/api/transactions/x"],
    ["POST", "transactions/import", "/api/transactions/import"],
    ["PUT", "budget", "/api/budget"],
    ["POST", "debts", "/api/debts"],
    ["POST", "debts/import", "/api/debts/import"],
    ["POST", "trading/import", "/api/trading/import"],
    ["POST", "trading/review", "/api/trading/review"],
    ["PUT", "debts/reserve", "/api/debts/reserve"],
    ["PATCH", "debts/[id]", "/api/debts/x"],
    ["DELETE", "debts/[id]", "/api/debts/x"],
    ["POST", "debts/simulate", "/api/debts/simulate"],
    ["POST", "asr", "/api/asr"],
    ["POST", "review/day", "/api/review/day"],
    ["POST", "finance/review/week", "/api/finance/review/week"],
    ["PATCH", "auth/profile", "/api/auth/profile"],
    ["POST", "auth/logout-all", "/api/auth/logout-all"],
    ["POST", "admin/prompts/[key]/preview", "/api/admin/prompts/parse/preview"],
    ["PUT", "admin/ai-mode", "/api/admin/ai-mode"],
  ];
  for (const [method, , path] of writes) {
    const { status } = await call(method, path);
    assert.equal(status, 401, `${path} 匿名 ${method} 应 401`);
  }
});

/* ---------- 权限层：普通用户 → 403 ---------- */

test("权限层：管理员路由普通用户 403", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const cases: Array<[string, string, string]> = [
    ["GET", "admin/prompts", "/api/admin/prompts"],
    ["GET", "admin/invites", "/api/admin/invites"],
    ["GET", "admin/grants", "/api/admin/grants"],
    ["GET", "admin/ai-mode", "/api/admin/ai-mode"],
    ["GET", "billing/users", "/api/billing/users"],
    ["GET", "admin/data/categories", "/api/admin/data/categories"],
    ["GET", "admin/data/catalog", "/api/admin/data/catalog"],
    ["GET", "admin/data/entries", "/api/admin/data/entries?from=2026-09-01&to=2026-09-30"],
  ];
  for (const [method, , path] of cases) {
    const { status } = await call(method, path, { user: UB });
    assert.equal(status, 403, `${path} 普通用户应 403`);
  }
});

test("权限层：trading 模块未授权用户 403（admin 直通 200）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const b = await call("GET", "/api/trading/accounts", { user: UB });
  assert.equal(b.status, 403, "未授权普通用户访问 trading 应 403");
  const a = await call("GET", "/api/trading/accounts", { user: UA });
  assert.equal(a.status, 200, "admin 访问 trading 应直通 200");
});

test("权限层：debt 模块未授权用户 403（admin 直通 200）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const b = await call("GET", "/api/debts", { user: UB });
  assert.equal(b.status, 403, "未授权普通用户访问 debts 应 403");
  const a = await call("GET", "/api/debts", { user: UA });
  assert.equal(a.status, 200, "admin 访问 debts 应直通 200");
});

/* ---------- 校验层：非法入参 → 400 ---------- */

test("校验层：非法入参 400（时段倒挂/语义日期/坏结构）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const bad = await call("POST", "/api/blocks", { user: UA,
    body: { title: "倒挂", startAt: "2026-09-22T18:00:00+08:00", endAt: "2026-09-22T17:00:00+08:00" },
  });
  assert.equal(bad.status, 400, "end<start 应 400");

  const badRange = await call("GET", "/api/blocks/range?from=bad&to=2026-09-22", { user: UA,
  });
  assert.equal(badRange.status, 400, "非法日期 range 应 400");

  const badDate = await call("POST", "/api/review/day", { user: UA,
    body: { date: "not-a-date" },
  });
  assert.equal(badDate.status, 400, "非法 date 应 400");

  const badEntry = await call("POST", "/api/entries/x/confirm", { user: UA,
    body: {},
  });
  assert.ok([400, 404].includes(badEntry.status), "不存在 entry 的 confirm 应 400/404");
});

/* ---------- 正常层：九域读接口 + 写链路 ---------- */

test("正常层：核心读接口 200", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const reads: Array<[string, string]> = [
    ["auth/me", "/api/auth/me"],
    ["feed", "/api/feed"],
    ["today", "/api/today"],
    ["reminders", "/api/reminders"],
    ["spaces", "/api/spaces"],
    ["todos", "/api/todos"],
    ["blocks/range", "/api/blocks/range?from=2026-09-01&to=2026-09-30"],
    ["activities", "/api/activities"],
    ["contacts", "/api/contacts"],
    ["accounts", "/api/accounts"],
    ["transactions", "/api/transactions?month=2026-09"],
    ["budget", "/api/budget"],
    ["debts", "/api/debts"],
    ["debts/overview", "/api/debts/overview"],
  ["debts/reserve", "/api/debts/reserve?ym=2026-09"],
    ["finance/overview", "/api/finance/overview?month=2026-09"],
    ["finance/stats", "/api/finance/stats?month=2026-09"],
    ["review", "/api/review?kind=week&period=2026-09"],
    ["stats/range", "/api/stats/range?from=2026-09-01&to=2026-09-30"],
    ["tokens/usage", "/api/tokens/usage"],
    ["admin/prompts", "/api/admin/prompts"],
    ["admin/ai-mode", "/api/admin/ai-mode"],
    ["admin/data/categories", "/api/admin/data/categories"],
    ["admin/data/catalog", "/api/admin/data/catalog"],
  ];
  for (const [, path] of reads) {
    const { status, json } = await call("GET", path, { user: UA });
    assert.equal(status, 200, `${path} 应 200（实为 ${status}: ${JSON.stringify(json).slice(0, 120)}）`);
  }
});

test("正常层：时间块创建→编辑→删除", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const day = new Date().toISOString().slice(0, 10);
  const acts = await call("GET", "/api/activities", { user: UA });
  let activityId = acts.json?.activities?.[0]?.id;
  if (!activityId) {
    const mk = await call("POST", "/api/activities", {
      user: UA,
      body: { name: "冒烟活动", icon: "S", color: "#64748b", defaultMin: 30 },
    });
    activityId = (mk.json.activity ?? mk.json)?.id;
  }
  assert.ok(activityId, "应有可用活动分类");
  const create = await call("POST", "/api/blocks", { user: UA,
    body: { title: "冒烟时间块", activityId, startAt: `${day}T06:00:00+08:00`, endAt: `${day}T07:00:00+08:00` },
  });
  assert.equal(create.status, 200, `创建应 200：${JSON.stringify(create.json).slice(0, 120)}`);
  const id = create.json.block.id;
  const patch = await call("PATCH", `/api/blocks/${id}`, { user: UA,
    body: { title: "冒烟时间块改" },
  });
  assert.equal(patch.status, 200, "编辑应 200");
  const del = await call("DELETE", `/api/blocks/${id}`, { user: UA });
  assert.equal(del.status, 200, "删除应 200");
});

test("正常层：待办创建→完成→删除", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const create = await call("POST", "/api/todos", { user: UA, body: { title: "冒烟待办" } });
  assert.equal(create.status, 200, `创建应 200：${JSON.stringify(create.json).slice(0, 120)}`);
  const id = (create.json.todo ?? create.json).id;
  const patch = await call("PATCH", `/api/todos/${id}`, { user: UA,
    body: { done: true },
  });
  assert.equal(patch.status, 200, "完成应 200");
  const del = await call("DELETE", `/api/todos/${id}`, { user: UA });
  assert.equal(del.status, 200, "删除应 200");
});

test("正常层：空间创建→感悟→删除空间", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const create = await call("POST", "/api/spaces", { user: UA, body: { name: "冒烟空间" } });
  assert.equal(create.status, 200, `创建应 200：${JSON.stringify(create.json).slice(0, 120)}`);
  const id = (create.json.space ?? create.json).id;
  const ref = await call("POST", `/api/spaces/${id}/reflections`, { user: UA,
    body: { content: "冒烟感悟：今天很充实" },
  });
  assert.equal(ref.status, 201, `感悟应 201：${JSON.stringify(ref.json).slice(0, 120)}`);
  const del = await call("DELETE", `/api/spaces/${id}`, { user: UA });
  assert.equal(del.status, 200, "删除空间应 200");
});

test("正常层：联系人创建→往来→删除", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const create = await call("POST", "/api/contacts", { user: UA,
    body: { name: "冒烟联系人" },
  });
  assert.equal(create.status, 200, `创建应 200：${JSON.stringify(create.json).slice(0, 120)}`);
  const id = (create.json.contact ?? create.json).id;
  const it = await call("POST", `/api/contacts/${id}/interactions`, { user: UA,
    body: { type: "见面", note: "冒烟往来" },
  });
  assert.ok([200, 201].includes(it.status), `往来应 2xx：${JSON.stringify(it.json).slice(0, 120)}`);
  const del = await call("DELETE", `/api/contacts/${id}`, { user: UA });
  assert.equal(del.status, 200, "删除应 200");
});

test("正常层：账户创建→记账→删账", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const acc = await call("POST", "/api/accounts", { user: UA, body: { name: "冒烟账户" } });
  assert.equal(acc.status, 200, `建账户应 200：${JSON.stringify(acc.json).slice(0, 120)}`);
  const accId = (acc.json.account ?? acc.json).id;
  const tx = await call("POST", "/api/transactions", { user: UA,
    body: {
      accountId: accId,
      direction: "out",
      amountCents: 4200,
      category: "餐饮",
      occurredAt: new Date().toISOString(),
      note: "冒烟流水",
    },
  });
  assert.ok([200, 201].includes(tx.status), `记账应 2xx：${JSON.stringify(tx.json).slice(0, 160)}`);
  const txId = (tx.json.transaction ?? tx.json)?.id;
  if (txId) {
    const delTx = await call("DELETE", `/api/transactions/${txId}`, { user: UA,
    });
    assert.equal(delTx.status, 200, "删流水应 200");
  }
  const delAcc = await call("DELETE", `/api/accounts/${accId}`, { user: UA,
  });
  assert.equal(delAcc.status, 200, "删账户应 200");
});

test("正常层：登录接口真实报错（DB 链路通 + 模糊文案）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const { status, json } = await call("POST", "/api/auth/login", { body: { phone: "13800009999", password: "wrong-password" },
  });
  assert.equal(status, 401, "错误密码应 401");
  assert.ok(json.error, "应有模糊错误文案");
  assert.ok(!JSON.stringify(json).includes("13800009999"), "不应回显账号");
});

test("teardown: 清理测试用户（级联清数据与会话）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await pool.query(`delete from invite_codes where created_by = any($1)`, [[UA, UB]]);
  await pool.query(`delete from profiles where id = any($1)`, [[UA, UB]]);
  const { rows } = await pool.query("select count(*)::int as n from profiles where id = any($1)", [[UA, UB]]);
  assert.equal(rows[0].n, 0);
});
