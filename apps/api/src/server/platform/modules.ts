/**
 * 模块开关（REQ-028，迁移 063）：三层有效态计算 + 进程缓存 + 门禁入口。
 * 注册表单一事实源在 @shiguangri/shared/modules（代码约束 key 合法性）；
 * 三层状态分表写（写主体不同）：module_states 全局（管理员）→
 * user_module_controls 按用户强制/可见性（管理员）→ user_module_prefs 用户自选。
 * user_module_grants（031/037）保留停写：063 已把存量授权搬为「按用户强制开」。
 *
 * 有效态自上而下短路：core 恒开 → 显式全局关（module_states.enabled=false）→ 祖先链关（级联）→
 * 强制关 → 强制开 → 用户自选/注册表默认（defaultOn 仅第 6 步兜底，可被按用户强制开覆盖）。
 * 开关可见性独立计算（【我的】功能管理区用）。
 * admin 直通=全部模块 on（后台自身不被关掉）。
 */
import { pool } from "@/server/platform/db";
import { getCurrentUser, type SessionUser } from "@/server/identity/auth";
import { MODULE_REGISTRY, getModule, type ModuleDef } from "@shiguangri/shared/modules";

/** 全量模块 key（旧消费方 grants 校验/文案用；权威清单在 shared 注册表） */
export const MODULES: readonly string[] = MODULE_REGISTRY.map((m) => m.key);
export type ModuleKey = string;

/** 【我的】功能管理区/前端过滤消费的模块明细 */
export interface ModulePrefView {
  key: string;
  name: string;
  level: "domain" | "submodule";
  parent: string | null;
  /** 有效开启态 */
  effective: boolean;
  /** 开关可见且可拨（core/全局关/被强制/不可自开关 → false） */
  controllable: boolean;
  /** 用户自选值；null=未写过，跟随默认 */
  value: boolean | null;
}

export interface ResolvedModules {
  /** 有效开启的 key 全量 */
  modules: string[];
  prefs: ModulePrefView[];
}

/** 三态：user=已开通（或 admin 直通）；"unauthenticated"=未登录（401）；null=已登录未开通（403）。
 *  单次会话查询同时区分 401/403——调用方不再需要二次 getCurrentUser（双查且结果可能不一致） */
export type ModuleUserResult = SessionUser | "unauthenticated" | null;

// ---- 进程缓存（单实例 systemd 部署成立；TTL 60s，写路径主动失效） ----

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: ResolvedModules }>();

/** 失效缓存：带 userId 失效单人（prefs/controls 变更）；不带全清（module_states 变更） */
export function invalidateModuleCache(userId?: string): void {
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
}

// ---- 三层原始状态读取 ----

interface ModuleRawState {
  /** module_states 全局层（行缺失=未配置，注册表默认兜底） */
  states: Map<string, { enabled: boolean; userToggleable: boolean }>;
  /** 按用户层（行缺失/列空=跟随上层） */
  controls: Map<string, { force: "on" | "off" | null; visible: boolean | null }>;
  /** 用户自选层（行缺失=未写过） */
  prefs: Map<string, boolean>;
}

async function loadRawState(userId: string): Promise<ModuleRawState> {
  const [statesR, controlsR, prefsR] = await Promise.all([
    pool.query(`select module, enabled, user_toggleable from module_states`),
    pool.query(
      `select module, force_state, switch_visible from user_module_controls where user_id = $1`,
      [userId],
    ),
    pool.query(`select module, enabled from user_module_prefs where user_id = $1`, [userId]),
  ]);
  return {
    states: new Map(
      statesR.rows.map((r: { module: string; enabled: boolean; user_toggleable: boolean }) => [
        r.module,
        { enabled: r.enabled, userToggleable: r.user_toggleable },
      ]),
    ),
    controls: new Map(
      controlsR.rows.map(
        (r: { module: string; force_state: "on" | "off" | null; switch_visible: boolean | null }) => [
          r.module,
          { force: r.force_state, visible: r.switch_visible },
        ],
      ),
    ),
    prefs: new Map(prefsR.rows.map((r: { module: string; enabled: boolean }) => [r.module, r.enabled])),
  };
}

// ---- 有效态计算（纯函数，注册表拓扑序依赖声明顺序：域级在前子级在后） ----

function resolveFromRaw(raw: ModuleRawState): ResolvedModules {
  const effMemo = new Map<string, boolean>();
  const effOf = (key: string): boolean => {
    const memo = effMemo.get(key);
    if (memo !== undefined) return memo;
    const def = getModule(key);
    if (!def) return false; // 注册表外 key 一律关（数据残留防御）
    let on: boolean;
    if (def.core) {
      on = true; // 1. core 恒开
    } else {
      const st = raw.states.get(key);
      if (st && !st.enabled) {
        on = false; // 2. 显式全局关（管理员下线）。无行=未配置不在此短路——
        // 否则 defaultOn=false 被当作全局关，按用户强制开永远压不过默认关（031 搬迁语义回归，v1.1 修复）
      } else if (def.parent && !effOf(def.parent)) {
        on = false; // 3. 祖先链关（级联，不写子状态）
      } else {
        const ctl = raw.controls.get(key);
        if (ctl?.force === "off") {
          on = false; // 4. 强制关
        } else if (ctl?.force === "on") {
          on = true; // 5. 强制开（不看自选）
        } else {
          on = raw.prefs.get(key) ?? def.defaultOn; // 6. 用户自选/注册表默认兜底
        }
      }
    }
    effMemo.set(key, on);
    return on;
  };

  const prefs: ModulePrefView[] = MODULE_REGISTRY.map((def) => ({
    key: def.key,
    name: def.name,
    level: def.level,
    parent: def.parent ?? null,
    effective: effOf(def.key),
    value: raw.prefs.has(def.key) ? raw.prefs.get(def.key)! : null,
    controllable: switchVisible(def, raw),
  }));

  return { modules: prefs.filter((p) => p.effective).map((p) => p.key), prefs };
}

/** 开关可见性（独立于当前有效态）：非 core && 全局开 && 未被强制 && 可见性三态兜底 */
function switchVisible(def: ModuleDef, raw: ModuleRawState): boolean {
  if (def.core) return false;
  const st = raw.states.get(def.key);
  if (st ? !st.enabled : !def.defaultOn) return false; // 全局关：不展示拨动入口
  const ctl = raw.controls.get(def.key);
  if (ctl?.force) return false; // 管理员接管：用户不可拨
  return ctl?.visible ?? st?.userToggleable ?? def.userToggleableDefault;
}

/** 解析用户有效模块（admin 直通=全部 on；结果按 userId 缓存 TTL 60s，写路径失效） */
export async function resolveUserModules(user: { id: string; role: string }): Promise<ResolvedModules> {
  if (user.role === "admin") {
    return {
      modules: [...MODULES],
      prefs: MODULE_REGISTRY.map((def) => ({
        key: def.key,
        name: def.name,
        level: def.level,
        parent: def.parent ?? null,
        effective: true,
        controllable: false, // admin 全量直通，无需自选
        value: null,
      })),
    };
  }
  const hit = cache.get(user.id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = resolveFromRaw(await loadRawState(user.id));
  cache.set(user.id, { at: Date.now(), data });
  return data;
}

/** 模块门禁三态查询（withModule/withModuleParams 消费；内部走三层有效态） */
export async function getModuleUser(module: ModuleKey): Promise<ModuleUserResult> {
  const user = await getCurrentUser();
  if (!user) return "unauthenticated";
  if (user.role === "admin") return user;
  const { modules } = await resolveUserModules(user);
  return modules.includes(module) ? user : null;
}

/** 用户的已开通模块列表（me() 消费；admin 全量；登录门禁由调用方负责） */
export async function listUserModules(userId: string, role: string): Promise<string[]> {
  return (await resolveUserModules({ id: userId, role })).modules;
}
