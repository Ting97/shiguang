/** /admin · AI 管理模块共享类型（admin-ai-panel.tsx 与 admin-ai-panel/ 子组件共用） */

interface InjectSpec { key: string; label: string; desc: string; source: string; required?: boolean; default: boolean }
interface CapSpec { key: string; label: string; min: number; max: number; default: number }
interface RegistrySpec {
  userTemplate: string;
  placeholders: string[];
  injects: InjectSpec[];
  caps: CapSpec[];
}
/** 个性化注入条目（REQ-005 FR-5.6）：dataset 必填；days/limit 缺省 = 不限时间窗 / 服务端默认 10 条 */
interface UserDataEntry { dataset: string; days?: number; limit?: number }
interface CtxConfig { inject?: Record<string, boolean>; caps?: Record<string, number>; userData?: UserDataEntry[] }

export type { CapSpec, CtxConfig, InjectSpec, RegistrySpec, UserDataEntry };

export interface PromptItem {
  key: string;
  title: string;
  category: "识别" | "复盘" | "目标" | "系统";
  enabled: boolean;
  overridden: boolean;
  dbContent: string | null;
  remark: string | null;
  updatedAt: string | null;
  defaultContent: string;
  userTemplate: string | null;
  userTemplateDefault: string;
  contextConfig: CtxConfig | null;
  effectiveConfig: { inject: Record<string, boolean>; caps: Record<string, number>; userData?: UserDataEntry[] };
  registry: RegistrySpec;
}

export interface Version {
  id: number;
  content: string;
  payload: { system?: string; userTemplate?: string | null; contextConfig?: CtxConfig | null } | null;
  restored_from: number | null;
  created_at: string;
  created_by_name: string | null;
  size: number;
}

/** 调用引擎模式（REQ-003 3-C 管理台开关）：off=全 GLM / shadow=影子对照 / on=实时接管（3-D 已上线） */
export type EngineMode = "off" | "shadow" | "on";
