/**
 * 模块注册表（REQ-028 单一事实源）：全站功能插件化的纯数据清单，三端构建期共用。
 * 模块 key 合法性由代码约束（替代 031 的 DB CHECK）；新增模块零迁移——
 * 注册表加一行 +（可选）apiPrefixes 声明受控路由前缀供 smoke 断言。
 * 层级：domain 域级（可带 nav 顶部导航）/ submodule 子模块（parent 必填，父关则子关）。
 */
export interface ModuleDef {
  key: string;
  level: "domain" | "submodule";
  /** 子模块必填；级联：祖先链任一关则本模块关 */
  parent?: string;
  /** 展示名（后台矩阵/功能管理区共用） */
  name: string;
  icon?: string;
  /** core=任何层不可关（当前仅 timeline 首页本体） */
  core?: boolean;
  /** 无任何状态时的默认有效态 */
  defaultOn: boolean;
  /** 「允许用户自开关」的全局默认（管理员可在 module_states 覆盖） */
  userToggleableDefault: boolean;
  /** 顶部导航项（域级才有；ai 走悬浮球+/assistant 无导航项） */
  nav?: { href: string; label: string };
  /** 受控路由前缀（门禁清单与 smoke 断言依据；前缀匹配 path） */
  apiPrefixes?: string[];
  /** 关联助手 scope（联动过滤；值为 chat 域 ChatScope 字符串） */
  assistantScopes?: string[];
}

export const MODULE_REGISTRY: ModuleDef[] = [
  {
    key: "timeline",
    level: "domain",
    name: "动态",
    icon: "📝",
    core: true,
    defaultOn: true,
    userToggleableDefault: false,
    nav: { href: "/", label: "动态" },
  },
  {
    key: "goal",
    level: "domain",
    name: "目标",
    icon: "🎯",
    defaultOn: true,
    userToggleableDefault: true,
    nav: { href: "/spaces", label: "目标" },
    apiPrefixes: ["/api/spaces"],
    assistantScopes: ["goal"],
  },
  {
    key: "time",
    level: "domain",
    name: "日程",
    icon: "📅",
    defaultOn: true,
    userToggleableDefault: true,
    nav: { href: "/schedule", label: "日程" },
    apiPrefixes: ["/api/blocks", "/api/activities", "/api/stats"],
    assistantScopes: ["time"],
  },
  {
    key: "people",
    level: "domain",
    name: "人际",
    icon: "👥",
    defaultOn: true,
    userToggleableDefault: true,
    nav: { href: "/contacts", label: "人际" },
    apiPrefixes: ["/api/contacts", "/api/interactions", "/api/reminders"],
    assistantScopes: ["people"],
  },
  {
    key: "finance",
    level: "domain",
    name: "财务",
    icon: "💰",
    defaultOn: true,
    userToggleableDefault: true,
    nav: { href: "/finance", label: "财务" },
    apiPrefixes: ["/api/transactions", "/api/accounts", "/api/budget"],
    assistantScopes: ["finance"],
  },
  {
    key: "ai",
    level: "domain",
    name: "拾光助手",
    icon: "✨",
    defaultOn: true,
    userToggleableDefault: true,
    apiPrefixes: ["/api/chat"],
  },
  {
    key: "fitness",
    level: "submodule",
    parent: "goal",
    name: "健身",
    icon: "💪",
    defaultOn: true,
    userToggleableDefault: true,
    apiPrefixes: ["/api/fitness"],
    assistantScopes: ["fitness"],
  },
  {
    key: "sleep",
    level: "submodule",
    parent: "fitness",
    name: "睡眠",
    icon: "😴",
    defaultOn: true,
    userToggleableDefault: true,
    apiPrefixes: ["/api/fitness/sleep"],
  },
  {
    key: "debt",
    level: "submodule",
    parent: "finance",
    name: "负债",
    icon: "📉",
    defaultOn: false,
    userToggleableDefault: false,
    apiPrefixes: ["/api/debts"],
  },
  {
    key: "trade_review",
    level: "submodule",
    parent: "finance",
    name: "收支复盘",
    icon: "🧾",
    defaultOn: false,
    userToggleableDefault: false,
    apiPrefixes: ["/api/finance/stats", "/api/finance/review"],
  },
  {
    key: "trading",
    level: "submodule",
    parent: "finance",
    name: "MT5 交易",
    icon: "📈",
    defaultOn: false,
    userToggleableDefault: false,
    apiPrefixes: ["/api/trading"],
  },
  {
    key: "insight",
    level: "submodule",
    parent: "ai",
    name: "AI 复盘",
    icon: "🪄",
    defaultOn: true,
    userToggleableDefault: true,
    apiPrefixes: ["/api/review"],
  },
];

export type ModuleKey = string;

export const getModule = (key: string): ModuleDef | undefined =>
  MODULE_REGISTRY.find((m) => m.key === key);

export const childModules = (key: string): ModuleDef[] =>
  MODULE_REGISTRY.filter((m) => m.parent === key);

/** key 合法性校验（写入路径 zod refine 用） */
export const isKnownModule = (key: string): boolean =>
  MODULE_REGISTRY.some((m) => m.key === key);
