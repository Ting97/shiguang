import type { EngineMode } from "./types";

/** /admin · AI 管理模块小工具与展示用常量 */

export const zhTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 占位符完整性校验（与服务端同规则）：缺失与未知清单 */
export function validateTpl(tpl: string, placeholders: string[]): { missing: string[]; unknown: string[] } {
  const found = new Set<string>();
  const re = /\{([a-zA-Z_]\w*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) found.add(m[1]);
  const known = new Set(placeholders);
  return { missing: placeholders.filter((p) => !found.has(p)), unknown: [...found].filter((p) => !known.has(p)) };
}

export const MODE_META: Record<EngineMode, { label: string; desc: string }> = {
  off: { label: "关闭", desc: "全部走 GLM，Jev 不参与" },
  shadow: { label: "影子对照", desc: "GLM 行为不变；每次识别后台同题调 Jev，只写一致率审计" },
  on: { label: "实时接管", desc: "闭集判断与空间归属切 Jev，开放词汇由 GLM 瘦身提取；Jev 失败自动回落全量 GLM" },
};
