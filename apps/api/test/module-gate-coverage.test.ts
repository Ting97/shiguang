/**
 * 模块门禁覆盖断言（REQ-028 FR-A7 回归防线）：注册表 apiPrefixes 声明的受控前缀下，
 * 每个 route.ts 必须带对应 withModule* 门禁——纯静态文件扫描（无需服务/DB），防后续
 * 新增路由漏包门禁（「注册表声明了前缀但路由裸奔」）。
 * 前缀匹配取最长命中（/api/fitness/sleep 优先于 /api/fitness），与门禁叠加语义一致；
 * debt/trade_review/trading 三模块沿用 031/037 既有 withModule 路由，同样纳入断言。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MODULE_REGISTRY } from "@shiguangri/shared/modules";

const API_ROOT = join(__dirname, "..", "src", "app", "api");

/** 递归收集全部 route.ts 绝对路径 */
function collectRoutes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collectRoutes(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** 路由文件对应的 URL 路径前缀（/api/... 形态；[id] 等动态段参与字符串匹配即断为前缀内） */
function urlPathOf(abs: string): string {
  return "/" + relative(join(__dirname, "..", "src", "app"), abs).replaceAll("\\", "/").replace(/\/route\.ts$/, "");
}

/** 模块对某前缀的断言（最长前缀优先）：返回该路由应携带的模块 key */
function gateKeyFor(url: string): string | null {
  const hits = MODULE_REGISTRY
    .flatMap((m) => (m.apiPrefixes ?? []).map((p) => ({ key: m.key, p })))
    .filter((x) => url === x.p || url.startsWith(x.p + "/"))
    .sort((a, b) => b.p.length - a.p.length);
  return hits[0]?.key ?? null;
}

test("注册表 apiPrefixes 前缀下的路由必带对应 withModule 门禁", () => {
  const routes = collectRoutes(API_ROOT);
  assert.ok(routes.length > 30, "路由文件收集异常");
  const offenders: string[] = [];
  for (const abs of routes) {
    const url = urlPathOf(abs);
    const key = gateKeyFor(url);
    if (!key) continue; // 非受控前缀（auth/admin/today/feed/export 等）不在此断言范围
    const src = readFileSync(abs, "utf8");
    const gated = new RegExp(`withModule(?:Params|Schema)?\\("${key}"`).test(src);
    if (!gated) offenders.push(`${url} 应带 withModule("${key}")`);
  }
  assert.deepEqual(offenders, [], `以下受控路由缺门禁：\n${offenders.join("\n")}`);
});

test("注册表结构完整性：key 唯一、子模块父键存在、core 仅 timeline", () => {
  const keys = MODULE_REGISTRY.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length, "模块 key 重复");
  for (const m of MODULE_REGISTRY) {
    if (m.parent) assert.ok(keys.includes(m.parent), `${m.key} 的父模块 ${m.parent} 不在注册表`);
    if (m.level === "submodule") assert.ok(m.parent, `${m.key} 子模块缺 parent`);
    else assert.ok(!m.parent, `${m.key} 域级不应带 parent`);
  }
  const cores = MODULE_REGISTRY.filter((m) => m.core).map((m) => m.key);
  assert.deepEqual(cores, ["timeline"], "core 模块清单变化需同步评审（nav 恒显/不可关语义）");
});
