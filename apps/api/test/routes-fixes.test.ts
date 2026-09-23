/**
 * 本批路由层 / platform 层修复的回归测试（routes-fixes）：
 *   纯函数段（恒跑）：overlapError 冲突文案北京时间（UTC 宿主 +8h getter）、ApiError.upstream 收敛、基座新封装导出
 *   service 段（需测试库）：time 域重叠冲突真实链路北京时间、people 域 catch 收敛后语义回归
 *   HTTP 段（需本地服务 SHIGUANGRI_SMOKE_BASE，约定同 routes-smoke）：
 *     transactions PATCH 分类白名单、spaces/:id/reflections limit/offset 非数字兜底、
 *     billing/plan months 校验、admin|auth invites days 校验、admin/prompts 非 admin 403
 *     （withAdminParams 行为等价：403 + forbidden + 仅管理员）、admin/grants granted_by 审计落库
 * 测试用户统一 22280000- 前缀，与并发 agent 的 1111/2222 前缀隔离；结束清理自建数据。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const TCA = "22280000-2222-4222-8222-222800000001"; // 管理员（HTTP 段管理操作）
const TCB = "22280000-2222-4222-8222-222800000002"; // 普通用户（403 层 / 授权对象）
const TCC = "22280000-2222-4222-8222-222800000003"; // service 段用户

let pool: any;
let loaded = false;
let dbReady = false;

/** env 先于 db 模块求值（同 services-smoke 约定）；未指定测试库不动真实库，service/HTTP 段整组 skip */
async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!process.env.SHIGUANGRI_TEST_DB) return;
  process.env.DATABASE_URL = process.env.SHIGUANGRI_TEST_DB;
  ({ pool } = await import("../src/server/platform/db"));
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

/* ---------- 纯函数段：overlapError 北京时间展示（无需测试库） ---------- */

test("overlapError：UTC 宿主下按北京时间展示（+8h 后 getUTC*，修复 getHours 差 8 小时）", async () => {
  await ensureLoaded();
  const { overlapError } = await import("../src/server/platform/db");

  // 15:30Z = 北京 23:30；16:30Z = 次日 00:30 → 跨日带日期
  const cross = overlapError({
    title: "睡眠",
    start_at: "2026-09-23T15:30:00.000Z",
    end_at: "2026-09-23T16:30:00.000Z",
  });
  assert.match(cross, /睡眠/);
  assert.match(cross, /9月23日 23:30 – 9月24日 00:30/);
  assert.doesNotMatch(cross, /15:30/, "旧 bug（UTC 宿主本地 getter）哨兵：不应出现 UTC 时刻");

  // 北京同日但跨 UTC 日界（00:30–02:00 都在 9-24）→ 同日不带日期
  const same = overlapError({
    title: "凌晨块",
    start_at: "2026-09-23T16:30:00.000Z",
    end_at: "2026-09-23T18:00:00.000Z",
  });
  assert.match(same, /00:30–02:00/);
  assert.doesNotMatch(same, /月/, "北京同日不应误判跨日（旧实现对 UTC 日期比较）");

  // proposed（识别出的拟登记时段）同样按北京时间展示；proposed 09:00–10:00 同日 → 不带日期
  const both = overlapError(
    { title: "已有", start_at: "2026-09-23T15:30:00.000Z", end_at: "2026-09-23T16:30:00.000Z" },
    { title: "新日程", start: "2026-09-23T01:00:00.000Z", end: "2026-09-23T02:00:00.000Z" },
  );
  assert.match(both, /「新日程」（09:00–10:00）/);
  assert.match(both, /「已有」（9月23日 23:30 – 9月24日 00:30）/);
});

test("基座：withAdminParams / withModuleParams 已导出且签名可用", async () => {
  await ensureLoaded();
  const base = await import("../src/server/platform/http/route");
  assert.equal(typeof base.withAdminParams, "function", "withAdminParams 应存在");
  assert.equal(typeof base.withModuleParams, "function", "withModuleParams 应存在");
  const wrapped = base.withAdminParams(async () => new Response("ok"));
  assert.equal(typeof wrapped, "function");
  const wrappedM = base.withModuleParams("debt", async () => new Response("ok"));
  assert.equal(typeof wrappedM, "function");
});

test("errors：upstream 收敛后 detail 不进 message（响应体只透出通用文案）", async () => {
  await ensureLoaded();
  const { ApiError, toApiError } = await import("../src/server/platform/http/errors");
  const raw = "error: relation \"xxx\" does not exist  at pg …";
  const e = ApiError.upstream("服务器内部错误", raw);
  assert.equal(e.status, 500);
  assert.equal(e.code, "upstream");
  assert.equal(e.message, "服务器内部错误");
  assert.doesNotMatch(e.message, /relation/, "SQL 原始错误串不得进入对外 message");
  assert.equal(e.detail, raw, "detail 仅保留给日志");
  assert.equal(toApiError(e), e, "ApiError 原样透传");
});

/* ---------- service 段：真实 SQL 落测试库 ---------- */

test("time service：createBlock 重叠冲突文案为北京时间（真实 Date 链路）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(TCC, "fixes测试C", "user");
  const actId = "svcfix-sleep";
  await pool.query(
    `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
     values ($1,$2,'睡眠','🌙','#6366f1',480,0,true) on conflict (id, user_id) do nothing`,
    [actId, TCC],
  );
  const { createBlock, overlapPayload } = await import("../src/server/time");
  const first = await createBlock(TCC, {
    title: "svc修复夜班块",
    startAt: "2026-09-23T15:30:00.000Z",
    endAt: "2026-09-23T16:30:00.000Z",
    activityId: actId,
  });
  assert.ok("block" in first, "首块应创建成功");
  const second = await createBlock(TCC, {
    title: "svc修复冲突块",
    startAt: "2026-09-23T15:40:00.000Z",
    endAt: "2026-09-23T16:20:00.000Z",
    activityId: actId,
  });
  assert.ok("conflict" in second, "重叠应返回 conflict 而非直接落库");
  const payload = overlapPayload((second as { conflict: any }).conflict);
  assert.match(payload.error, /9月23日 23:30 – 9月24日 00:30/, "冲突文案应为北京时间跨日展示");
  assert.match(payload.error, /一个时刻只能做一件事/);
  await pool.query(`delete from time_blocks where user_id = $1`, [TCC]);
  await pool.query(`delete from activities where user_id = $1`, [TCC]);
});

test("people service：重复联系人 400 与不存在 404 语义保留（catch 块收敛后回归）", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  await upsertUser(TCC, "fixes测试C", "user");
  const { createContact, updateContact, deleteContact } = await import("../src/server/people/service");
  const r1 = await createContact(TCC, { name: "svc修复联系人" });
  assert.ok((r1 as any).contact?.id, "建档应成功");
  await assert.rejects(() => createContact(TCC, { name: "svc修复联系人" }), /已有联系人/, "重复建档应 400");
  await assert.rejects(
    () => updateContact(TCC, crypto.randomUUID(), { name: "x" }),
    (e: any) => e?.status === 404 && /联系人不存在/.test(e.message),
    "改不存在联系人应 404（ApiError 重抛路径）",
  );
  await deleteContact(TCC, (r1 as any).contact.id);
});

/* ---------- HTTP 段：打真实本地服务（约定同 routes-smoke） ---------- */

const BASE = process.env.SHIGUANGRI_SMOKE_BASE ?? "";
let tokA = "";
let tokB = "";

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const token = opts.user === TCA ? tokA : opts.user === TCB ? tokB : "";
  const headers: Record<string, string> = { origin: BASE, "sec-fetch-site": "same-origin" };
  if (token) headers.cookie = `shiguang_session=${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test("HTTP setup: 测试用户与会话", async (t) => {
  await ensureLoaded();
  if (!dbReady || !process.env.SHIGUANGRI_SMOKE_BASE) {
    t.skip("测试库或本地服务不可达（SHIGUANGRI_SMOKE_BASE）");
    return;
  }
  const { generateSessionToken, hashToken } = await import("../src/server/identity/auth-crypto");
  await upsertUser(TCA, "fixes测试A", "admin");
  await upsertUser(TCB, "fixes测试B", "user");
  const mk = async (uid: string) => {
    const token = generateSessionToken();
    await pool.query(
      `insert into sessions (user_id, token_hash, expires_at) values ($1,$2, now() + interval '1 hour')`,
      [uid, hashToken(token)],
    );
    return token as string;
  };
  tokA = await mk(TCA);
  tokB = await mk(TCB);
  assert.ok(tokA && tokB);
});

test("HTTP transactions：PATCH 分类白名单（任意分类 → 400，合法分类 → 200）", async (t) => {
  if (!tokA) return t.skip("HTTP 段未就绪");
  const created = await call("POST", "/api/transactions", {
    user: TCA,
    body: { direction: "out", amountCents: 1234, category: "餐饮" },
  });
  assert.equal(created.status, 200, `POST 应成功：${JSON.stringify(created.json)}`);
  const txId = created.json.transaction.id as string;

  const bad = await call("PATCH", `/api/transactions/${txId}`, { user: TCA, body: { category: " 自定义污染分类 " } });
  assert.equal(bad.status, 400, "白名单外分类应 400");
  assert.match(String(bad.json.error), /无效分类/);

  const ok = await call("PATCH", `/api/transactions/${txId}`, { user: TCA, body: { category: "购物" } });
  assert.equal(ok.status, 200, "白名单内分类应 200");
  assert.equal(ok.json.transaction?.category, "购物");

  const del = await call("DELETE", `/api/transactions/${txId}`, { user: TCA });
  assert.equal(del.status, 200);
});

test("HTTP spaces/:id/reflections：limit/offset 非数字回退默认（修复前 NaN → 500）", async (t) => {
  if (!tokA) return t.skip("HTTP 段未就绪");
  const sp = await call("POST", "/api/spaces", { user: TCA, body: { name: "svc修复空间" } });
  assert.equal(sp.status, 200, `建空间应成功：${JSON.stringify(sp.json)}`);
  const spaceId = sp.json.space.id as string;
  for (const q of ["limit=abc", "offset=xyz", "limit=999&offset=-3", "limit=abc&offset=abc"]) {
    const r = await call("GET", `/api/spaces/${spaceId}/reflections?${q}`, { user: TCA });
    assert.equal(r.status, 200, `?${q} 应 200（兜底默认值）`);
    assert.ok(Array.isArray(r.json.items), "应返回 items 列表");
  }
  await call("DELETE", `/api/spaces/${spaceId}`, { user: TCA });
});

test("HTTP billing/plan：months 越界/非整数 → 400（修复前 NaN → Invalid Date → 500）", async (t) => {
  if (!tokA) return t.skip("HTTP 段未就绪");
  for (const months of ["abc", 0, 25, 1.5]) {
    const r = await call("POST", "/api/billing/plan", { user: TCA, body: { plan: "pro", months } });
    assert.equal(r.status, 400, `months=${String(months)} 应 400`);
    assert.match(String(r.json.error), /months/);
  }
  const ok = await call("POST", "/api/billing/plan", { user: TCA, body: { plan: "pro", months: 24 } });
  assert.equal(ok.status, 200, "months=24 应成功");
  assert.ok(ok.json.profile?.plan_expires_at, "pro 应设置到期时间");
  await call("POST", "/api/billing/plan", { user: TCA, body: { plan: "free" } }); // 复位
});

test("HTTP invites：days 非法 → 400（1e9 不再 500、负数不再静默永久码）", async (t) => {
  if (!tokA) return t.skip("HTTP 段未就绪");
  for (const path of ["/api/admin/invites", "/api/auth/invites"]) {
    for (const days of [1e9, -5, 0, 366, 1.5, "abc"]) {
      const r = await call("POST", path, { user: TCA, body: { days } });
      assert.equal(r.status, 400, `${path} days=${String(days)} 应 400`);
      assert.match(String(r.json.error), /days/);
    }
    const ok = await call("POST", path, { user: TCA, body: {} });
    assert.equal(ok.status, 200, `${path} 缺省 days 应成功`);
    assert.ok(ok.json.invite?.expires_at, "缺省 7 天应有到期时间");
  }
});

test("HTTP admin/prompts：非管理员 403 语义不变（withAdminParams 行为等价）", async (t) => {
  if (!tokB) return t.skip("HTTP 段未就绪");
  const cases: Array<[string, string, unknown]> = [
    ["PUT", "/api/admin/prompts/extract_full", { content: "x" }],
    ["GET", "/api/admin/prompts/extract_full", undefined],
    ["DELETE", "/api/admin/prompts/extract_full", undefined],
    ["POST", "/api/admin/prompts/extract_full/optimize", {}],
    ["POST", "/api/admin/prompts/extract_full/preview", {}],
    ["POST", "/api/admin/prompts/extract_full/restore", { versionId: 1 }],
  ];
  for (const [method, path, body] of cases) {
    const r = await call(method, path, { user: TCB, body });
    assert.equal(r.status, 403, `${method} ${path} 非 admin 应 403`);
    assert.equal(r.json.code, "forbidden", "错误码应保持 forbidden");
    assert.match(String(r.json.error), /仅管理员/, "文案应保持「仅管理员」");
  }
  if (tokA) {
    const okGet = await call("GET", "/api/admin/prompts/extract_full", { user: TCA });
    assert.equal(okGet.status, 200, "admin GET 版本历史应 200");
    const notFound = await call("GET", "/api/admin/prompts/not_a_key", { user: TCA });
    assert.equal(notFound.status, 404, "未知 key 应 404（门禁后校验仍在）");
  }
});

test("HTTP admin/grants：granted_by 记录操作管理员（审计可追溯）", async (t) => {
  if (!tokA) return t.skip("HTTP 段未就绪");
  const grant = await call("POST", "/api/admin/grants", { user: TCA, body: { userId: TCB, module: "debt" } });
  assert.equal(grant.status, 200, `授权应成功：${JSON.stringify(grant.json)}`);
  const { rows } = await pool.query(
    `select granted_by from user_module_grants where user_id = $1 and module = 'debt'`,
    [TCB],
  );
  assert.equal(rows[0]?.granted_by ?? null, TCA, "granted_by 应为操作管理员 id");
  await call("DELETE", `/api/admin/grants?userId=${TCB}&module=debt`, { user: TCA });
});

test("HTTP teardown: 清理 22280000 前缀测试数据", async (t) => {
  await ensureLoaded();
  if (!dbReady) return t.skip("测试库不可达");
  const ids = [TCA, TCB, TCC];
  await pool.query(`delete from invite_codes where created_by = any($1)`, [ids]);
  await pool.query(`delete from transactions where user_id = any($1)`, [ids]);
  await pool.query(`delete from goal_spaces where user_id = any($1)`, [ids]);
  await pool.query(`delete from user_module_grants where user_id = any($1) or granted_by = any($1)`, [ids]);
  await pool.query(`delete from sessions where user_id = any($1)`, [ids]);
  await pool.query(`delete from profiles where id = any($1)`, [ids]); // 级联清 blocks/activities/contacts
  assert.ok(true);
});
