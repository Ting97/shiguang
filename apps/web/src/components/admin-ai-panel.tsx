"use client";

import { useCallback, useEffect, useState } from "react";
import { TagChip, FilterChip } from "./tag-chip";

/**
 * /admin · AI 管理模块（REQ-001 R4 + REQ-003 3-A 三段式详情）：
 * - 左列 prompt 清单（分类分组、覆盖态徽标、启用开关）；移动端横滑、PC 左栏
 * - 右侧三段：① System prompt（编辑/对比默认值/✨AI 优化）
 *              ② 输入装配（user 模板编辑 + 占位符校验/一键补齐 + 注入开关 + 参数 + 装配预览·零 token）
 *              ③ 版本历史（三件套快照，载入单件/整体回滚；启用开关关闭=整 key 回退代码默认）
 * - 保存一次提交三段（未改字段原样回传语义：改回默认值 = 清除该覆盖）
 */

interface InjectSpec { key: string; label: string; desc: string; source: string; required?: boolean; default: boolean }
interface CapSpec { key: string; label: string; min: number; max: number; default: number }
interface RegistrySpec {
  userTemplate: string;
  placeholders: string[];
  injects: InjectSpec[];
  caps: CapSpec[];
}
interface CtxConfig { inject?: Record<string, boolean>; caps?: Record<string, number> }

interface PromptItem {
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
  effectiveConfig: { inject: Record<string, boolean>; caps: Record<string, number> };
  registry: RegistrySpec;
}

interface Version {
  id: number;
  content: string;
  payload: { system?: string; userTemplate?: string | null; contextConfig?: CtxConfig | null } | null;
  restored_from: number | null;
  created_at: string;
  created_by_name: string | null;
  size: number;
}

const zhTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 占位符完整性校验（与服务端同规则）：缺失与未知清单 */
function validateTpl(tpl: string, placeholders: string[]): { missing: string[]; unknown: string[] } {
  const found = new Set<string>();
  const re = /\{([a-zA-Z_]\w*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) found.add(m[1]);
  const known = new Set(placeholders);
  return { missing: placeholders.filter((p) => !found.has(p)), unknown: [...found].filter((p) => !known.has(p)) };
}

type Section = "system" | "input" | "versions";

/** 调用引擎模式（REQ-003 3-C 管理台开关）：off=全 GLM / shadow=影子对照 / on=实时接管（3-D 已上线） */
type EngineMode = "off" | "shadow" | "on";
const MODE_META: Record<EngineMode, { label: string; desc: string }> = {
  off: { label: "关闭", desc: "全部走 GLM，Jev 不参与" },
  shadow: { label: "影子对照", desc: "GLM 行为不变；每次识别后台同题调 Jev，只写一致率审计" },
  on: { label: "实时接管", desc: "闭集判断与空间归属切 Jev，开放词汇由 GLM 瘦身提取；Jev 失败自动回落全量 GLM" },
};

export default function AdminAiPanel({ notify }: { notify: (text: string, ok?: boolean) => void }) {
  const [items, setItems] = useState<PromptItem[] | null>(null);
  const [sel, setSel] = useState<PromptItem | null>(null);
  const [draft, setDraft] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [optHint, setOptHint] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  // 引擎模式开关
  const [engineMode, setEngineMode] = useState<EngineMode>("off");
  const [engineEnvDefault, setEngineEnvDefault] = useState<EngineMode>("off");
  const [engineSaving, setEngineSaving] = useState(false);
  // 3-A 输入装配
  const [tplDraft, setTplDraft] = useState("");
  const [injectDraft, setInjectDraft] = useState<Record<string, boolean>>({});
  const [capsDraft, setCapsDraft] = useState<Record<string, number>>({});
  const [previewSample, setPreviewSample] = useState("");
  const [previewPeriod, setPreviewPeriod] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  // 版本历史
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/prompts");
    const j = await r.json();
    if (!r.ok) {
      notify(j.error ?? "加载失败", false);
      return;
    }
    setItems(j.items as PromptItem[]);
    return j.items as PromptItem[];
  }, [notify]);

  const loadVersions = useCallback(async (key: string) => {
    const r = await fetch(`/api/admin/prompts/${key}`);
    setVersions(r.ok ? (await r.json()).versions : null);
  }, []);

  useEffect(() => {
    load().then((list) => {
      if (list?.length) pick(list[0]);
    });
    fetch("/api/admin/ai-mode").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      setEngineMode(j.mode);
      setEngineEnvDefault(j.envDefault);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchEngineMode(mode: EngineMode) {
    if (engineSaving || mode === engineMode) return;
    setEngineSaving(true);
    try {
      const r = await fetch("/api/admin/ai-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "切换失败");
      setEngineMode(mode);
      notify(`调用引擎已切换为「${MODE_META[mode].label}」，立即生效`);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setEngineSaving(false);
    }
  }

  function pick(item: PromptItem) {
    setSel(item);
    setDraft(item.dbContent ?? item.defaultContent);
    setEnabled(item.enabled);
    setDirty(false);
    setSuggestion(null);
    setShowCompare(false);
    setTplDraft(item.userTemplate ?? item.userTemplateDefault);
    setInjectDraft({ ...item.effectiveConfig.inject });
    setCapsDraft({ ...item.effectiveConfig.caps });
    setPreviewText(null);
    setPreviewSample("");
    setPreviewPeriod("");
    void loadVersions(item.key);
  }

  const tplMissing = sel ? validateTpl(tplDraft, sel.registry.placeholders).missing : [];
  const tplUnknown = sel ? validateTpl(tplDraft, sel.registry.placeholders).unknown : [];
  const tplDirty = sel ? tplDraft !== sel.userTemplateDefault || !!sel.userTemplate : false;
  const cfgDirty = sel
    ? sel.registry.injects.some((i) => (injectDraft[i.key] ?? i.default) !== (sel.effectiveConfig.inject[i.key] ?? i.default)) ||
      sel.registry.caps.some((c) => (capsDraft[c.key] ?? c.default) !== (sel.effectiveConfig.caps[c.key] ?? c.default))
    : false;

  async function save() {
    if (!sel || !draft.trim() || saving) return;
    if (tplMissing.length || tplUnknown.length) {
      notify(`user 模板占位符未通过：${[...tplMissing.map((x) => `{${x}}缺失`), ...tplUnknown.map((x) => `{${x}}未知`)].join("、")}`, false);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/prompts/${sel.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft,
          enabled,
          // 改回默认值 = 清除覆盖（null）；有改动才提交覆盖
          userTemplate: tplDirty ? tplDraft : null,
          contextConfig: cfgDirty ? { inject: injectDraft, caps: capsDraft } : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "保存失败");
      notify(`「${sel.title}」已保存并即时生效`);
      const list = await load();
      const fresh = list?.find((x) => x.key === sel.key);
      if (fresh) pick(fresh);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setSaving(false);
    }
  }

  async function revertDefault() {
    if (!sel || !window.confirm(`恢复「${sel.title}」为代码默认值？（删除 DB 覆盖：system/user 模板/注入配置全部回退，立即生效）`)) return;
    const r = await fetch(`/api/admin/prompts/${sel.key}`, { method: "DELETE" });
    if (r.ok) {
      notify(`「${sel.title}」已恢复代码默认`);
      const list = await load();
      const fresh = list?.find((x) => x.key === sel.key);
      if (fresh) pick(fresh);
    } else notify("操作失败", false);
  }

  async function rollback(v: Version) {
    if (!sel || !window.confirm(`整体回滚到 ${zhTime(v.created_at)} 的版本？（system + user 模板 + 注入配置三件套，立即生效）`)) return;
    const r = await fetch(`/api/admin/prompts/${sel.key}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: v.id }),
    });
    const j = await r.json();
    if (!r.ok) {
      notify(j.error ?? "回滚失败", false);
      return;
    }
    notify(`已回滚到 ${zhTime(v.created_at)} 的版本`);
    const list = await load();
    const fresh = list?.find((x) => x.key === sel.key);
    if (fresh) pick(fresh);
  }

  async function optimize() {
    if (!sel || optimizing) return;
    setOptimizing(true);
    setSuggestion(null);
    try {
      const r = await fetch(`/api/admin/prompts/${sel.key}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hint: optHint }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "优化失败");
      setSuggestion(j.suggestion);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setOptimizing(false);
    }
  }

  async function runPreview() {
    if (!sel || previewing) return;
    setPreviewing(true);
    try {
      const r = await fetch(`/api/admin/prompts/${sel.key}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample: previewSample || undefined, period: previewPeriod || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "预览失败");
      setPreviewText(j.userPrompt);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setPreviewing(false);
    }
  }

  if (!items) return <p className="py-10 text-center text-xs text-ink-dim">加载中…</p>;

  const categories: PromptItem["category"][] = ["识别", "复盘", "目标", "系统"];
  const isReview = sel?.key.startsWith("review_") ?? false;
  const periodPlaceholder = sel?.key === "review_month" ? "期间 YYYY-MM（空=本月）" : sel?.key === "review_year" ? "期间 YYYY（空=今年）" : "期间 YYYY-MM-DD（空=今天）";

  return (
    <div>
      {/* 调用引擎模式开关（REQ-003 3-C 管理台开关） */}
      <div className="glass mb-4 rounded-2xl p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-ink">🧭 调用引擎模式</h3>
          <TagChip label="Jev 影子观察期" tone="amber" size="sm" />
          <span className="flex-1" />
          <span className="text-[10px] text-ink-faint">服务器 env 默认：{MODE_META[engineEnvDefault].label}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {(Object.keys(MODE_META) as EngineMode[]).map((m) => {
            const active = engineMode === m;
            return (
              <button
                key={m}
                onClick={() => void switchEngineMode(m)}
                disabled={engineSaving}
                title="点击切换，立即生效"
                className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed ${
                  active
                    ? "border-sky-500/60 bg-sky-500/10"
                    : "border-line-soft bg-bg/30 hover:border-sky-500/40"
                }`}
              >
                <span className={`flex items-center gap-1.5 text-xs font-medium ${active ? "text-accent" : "text-ink"}`}>
                  {MODE_META[m].label}
                  {active && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] text-accent">生效中</span>}
                  {engineSaving && <span className="text-[9px] text-ink-faint">切换中…</span>}
                </span>
                <span className="mt-1 block text-[10px] leading-relaxed text-ink-dim">{MODE_META[m].desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[230px_1fr] lg:gap-5">
      {/* prompt 清单：移动横滑 / PC 左栏 */}
      <div className="scrollbar-none -mx-5 mb-3 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:mb-0 lg:block lg:space-y-2.5 lg:overflow-visible lg:px-0">
        {categories.map((cat) => {
          const list = items.filter((x) => x.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat} className="flex gap-1.5 lg:block lg:space-y-1">
              <p className="hidden px-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint lg:block">{cat}</p>
              {list.map((it) => (
                <button
                  key={it.key}
                  onClick={() => pick(it)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs transition-all duration-200 lg:w-full ${
                    sel?.key === it.key
                      ? "bg-gradient-to-r from-sky-500 to-indigo-500 font-medium text-white shadow-md shadow-sky-500/25"
                      : "text-ink-mute hover:bg-wash hover:text-ink"
                  }`}
                >
                  {it.title}
                  {it.overridden && (
                    <span
                      title={it.enabled ? "DB 覆盖生效中" : "覆盖已停用（用代码默认）"}
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.enabled ? "bg-emerald-400" : "bg-amber-400"}`}
                    />
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* 三段式编辑器 */}
      {sel && (
        <div className="min-w-0">
          {/* 标题行 */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{sel.title}</h3>
            <TagChip label={sel.key} tone="slate" size="sm" />
            {sel.overridden ? (
              <TagChip icon="🟢" label="DB 覆盖" tone="emerald" size="sm" title={`更新于 ${zhTime(sel.updatedAt)}`} />
            ) : (
              <TagChip label="代码默认" tone="sky" size="sm" />
            )}
            {!sel.enabled && <TagChip icon="⏸" label="已停用·用默认" tone="amber" size="sm" />}
            <span className="flex-1" />
            {dirty && <TagChip label="未保存" tone="amber" size="sm" />}
            <button
              onClick={save}
              disabled={saving || !draft.trim()}
              className="btn-primary rounded-xl px-4 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存（立即生效）"}
            </button>
            {sel.overridden && (
              <button onClick={revertDefault} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5 text-xs text-ink-soft transition hover:border-rose-500/50 hover:text-danger">
                恢复代码默认
              </button>
            )}
          </div>

          {/* ===== 第一段：System prompt ===== */}
          <section className="glass mb-3 rounded-2xl p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <FilterChip label="① System prompt" active variant="pill" onClick={() => {}} />
              <span className="flex-1" />
              <button
                onClick={() => setShowCompare((v) => !v)}
                className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-sky-500/50"
              >
                {showCompare ? "收起对比" : "对比默认值"}
              </button>
            </div>

            {/* AI 优化入口 */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <input
                value={optHint}
                onChange={(e) => setOptHint(e.target.value)}
                placeholder="优化意图（可空，如：更严格约束日期）"
                maxLength={200}
                className="min-w-40 flex-1 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-violet-500"
              />
              <button
                onClick={optimize}
                disabled={optimizing}
                className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-ai transition hover:bg-purple-500/20 disabled:opacity-50"
              >
                {optimizing ? "优化中…" : "✨ AI 优化"}
              </button>
            </div>

            {/* AI 建议对比（并排） */}
            {suggestion !== null && (
              <div className="mb-3 rounded-xl border border-purple-500/30 bg-purple-500/[0.06] p-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-ai">
                  <TagChip icon="✨" label="AI 优化建议" tone="violet" size="sm" />
                  <span className="font-normal text-ink-dim">采纳后仅填入编辑器，检查无误再手动保存</span>
                  <span className="flex-1" />
                  <button
                    onClick={() => {
                      setDraft(suggestion);
                      setDirty(true);
                      setSuggestion(null);
                      notify("已采纳到编辑器（未保存）");
                    }}
                    className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
                  >
                    采纳
                  </button>
                  <button onClick={() => setSuggestion(null)} className="rounded-lg px-2.5 py-1 text-[11px] text-ink-mute hover:bg-soft">
                    放弃
                  </button>
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[10px] text-ink-faint">当前（编辑器）</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/60 p-2 text-[10px] leading-relaxed text-ink-soft">{draft}</pre>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] text-ink-faint">AI 建议</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/60 p-2 text-[10px] leading-relaxed text-ink">{suggestion}</pre>
                  </div>
                </div>
              </div>
            )}

            {/* 编辑器 + 对比默认值 */}
            <div className={showCompare ? "grid gap-2 md:grid-cols-2" : ""}>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.slice(0, 50000));
                  setDirty(true);
                }}
                rows={12}
                spellCheck={false}
                className="input-glow w-full resize-y rounded-xl border border-line-soft bg-bg/40 p-3 font-mono text-[11px] leading-relaxed text-ink outline-none"
              />
              {showCompare && (
                <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl border border-line-soft bg-bg/60 p-3 font-mono text-[11px] leading-relaxed text-ink-mute">
                  {sel.defaultContent}
                </pre>
              )}
            </div>
            <p className="mt-1.5 text-[10px] text-ink-faint">{draft.length}/50000 · 关闭下方「启用此覆盖」或点「恢复代码默认」= 整 key 回退代码默认</p>
          </section>

          {/* ===== 第二段：输入装配（3-A） ===== */}
          <section className="glass mb-3 rounded-2xl p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <FilterChip label="② 输入装配（user）" active variant="pill" onClick={() => {}} />
              {tplDirty && <TagChip label="模板已覆盖" tone="emerald" size="sm" />}
              {cfgDirty && <TagChip label="配置已调整" tone="emerald" size="sm" />}
            </div>

            {/* user 模板编辑 */}
            <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-dim">
              <span className="font-medium text-ink-soft">user 模板</span>
              <span>合法占位符：</span>
              {sel.registry.placeholders.map((p) => {
                const missing = tplMissing.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (!missing) return;
                      const fixed = tplDraft.replace(/\s*$/, "") + "\n" + sel.registry.placeholders.filter((x) => validateTpl(tplDraft, sel.registry.placeholders).missing.includes(x)).map((x) => `{${x}}`).join(" ");
                      setTplDraft(fixed);
                      notify("已补齐缺失占位符（追加在模板末尾，可自行调整位置）");
                    }}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                      missing ? "bg-rose-500/15 text-danger hover:bg-rose-500/25" : "bg-sky-500/10 text-accent hover:bg-sky-500/20"
                    }`}
                    title={missing ? "缺失中——点击追加到模板末尾" : "已包含"}
                  >
                    {`{${p}}`}
                  </button>
                );
              })}
              {tplDraft !== sel.userTemplateDefault && (
                <button
                  onClick={() => {
                    setTplDraft(sel.userTemplateDefault);
                    notify("user 模板已还原为代码默认（保存后清除覆盖）");
                  }}
                  className="rounded px-1.5 py-0.5 text-[10px] text-ink-mute hover:bg-soft hover:text-accent"
                >
                  还原默认
                </button>
              )}
            </p>
            <textarea
              value={tplDraft}
              onChange={(e) => {
                setTplDraft(e.target.value.slice(0, 50000));
                setDirty(true);
              }}
              rows={5}
              spellCheck={false}
              className="w-full resize-y rounded-xl border border-line-soft bg-bg/40 p-3 font-mono text-[11px] leading-relaxed text-ink outline-none focus:border-sky-500/60"
            />
            {(tplMissing.length > 0 || tplUnknown.length > 0) && (
              <p className="mt-1 text-[11px] text-danger">
                占位符校验：{tplMissing.length ? `缺失 ${tplMissing.map((x) => `{${x}}`).join("、")}（点上方红色占位符一键补齐）` : ""}
                {tplUnknown.length ? ` 未知 ${tplUnknown.map((x) => `{${x}}`).join("、")}` : ""}
              </p>
            )}

            {/* 注入开关 */}
            <p className="mb-1 mt-3 text-[11px] font-medium text-ink-soft">注入项</p>
            <ul className="space-y-1">
              {sel.registry.injects.map((i) => {
                const on = injectDraft[i.key] ?? i.default;
                const locked = !!i.required;
                return (
                  <li key={i.key} className="flex items-start gap-2.5 rounded-lg border border-line-soft bg-bg/30 px-2.5 py-1.5">
                    <input
                      type="checkbox"
                      checked={locked ? true : on}
                      disabled={locked}
                      onChange={(e) => {
                        setInjectDraft((d) => ({ ...d, [i.key]: e.target.checked }));
                        setDirty(true);
                      }}
                      title={locked ? "必需注入项，不可关闭" : on ? "点击关闭（线上装配即不含该块）" : "点击开启"}
                      className="mt-0.5 h-3.5 w-3.5 accent-sky-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`text-xs font-medium ${locked ? "text-ink-dim" : on ? "text-ink" : "text-ink-faint"}`}>
                        {i.label}
                        {locked && <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-warn">必需</span>}
                        {!on && !locked && <span className="ml-1.5 text-[9px] text-ink-faint">已关闭</span>}
                      </span>
                      <span className="block truncate text-[10px] text-ink-faint" title={i.desc}>{i.desc}</span>
                    </span>
                    <span className="shrink-0 text-[9px] text-ink-faint" title={i.source}>{i.source}</span>
                  </li>
                );
              })}
            </ul>

            {/* 参数 */}
            {sel.registry.caps.length > 0 && (
              <>
                <p className="mb-1 mt-3 text-[11px] font-medium text-ink-soft">参数（0 = 不设限；保存即在线上生效，明细类上限在 SQL 查询层生效）</p>
                <div className="flex flex-wrap gap-2">
                  {sel.registry.caps.map((c) => (
                    <label key={c.key} className="flex items-center gap-1.5 rounded-lg border border-line-soft bg-bg/30 px-2.5 py-1.5 text-[11px] text-ink-dim">
                      {c.label}
                      <input
                        type="number"
                        min={c.min}
                        max={c.max}
                        value={capsDraft[c.key] ?? c.default}
                        onChange={(e) => {
                          const v = e.target.value === "" ? "" : Math.max(c.min, Math.min(c.max, Math.round(Number(e.target.value))));
                          setCapsDraft((d) => ({ ...d, [c.key]: v as number }));
                          setDirty(true);
                        }}
                        className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-right tabular-nums text-ink outline-none focus:border-sky-500"
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* 装配预览 */}
            <p className="mb-1 mt-3 text-[11px] font-medium text-ink-soft">装配预览（不调 LLM、零 token；按上方当前配置与你的真实数据装配）</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={previewSample}
                onChange={(e) => setPreviewSample(e.target.value)}
                placeholder="样例话术（可空=取你最近一条真实数据）"
                maxLength={500}
                className="min-w-40 flex-1 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500"
              />
              {isReview && (
                <input
                  value={previewPeriod}
                  onChange={(e) => setPreviewPeriod(e.target.value)}
                  placeholder={periodPlaceholder}
                  maxLength={10}
                  className="w-44 rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-sky-500"
                />
              )}
              <button
                onClick={runPreview}
                disabled={previewing}
                className="whitespace-nowrap rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-sky-500/20 disabled:opacity-50"
              >
                {previewing ? "装配中…" : "🔍 装配预览"}
              </button>
            </div>
            {previewText !== null && (
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-3 font-mono text-[10px] leading-relaxed text-ink">
                {previewText}
              </pre>
            )}
          </section>

          {/* ===== 第三段：版本历史 ===== */}
          <section className="glass mb-3 rounded-2xl p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <FilterChip label="③ 版本历史" active variant="pill" onClick={() => {}} />
              <span className="flex-1" />
              <button
                onClick={() => setShowVersions((v) => !v)}
                className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1 text-[11px] text-ink-soft transition hover:border-sky-500/50"
              >
                {showVersions ? "收起" : "展开"} {versions?.length ? `(${versions.length})` : ""}
              </button>
            </div>
            {showVersions && (
              <>
                {!versions ? (
                  <p className="text-[11px] text-ink-faint">加载中…</p>
                ) : versions.length === 0 ? (
                  <p className="text-[11px] text-ink-faint">还没有保存记录 —— 每次保存会自动留三件套快照</p>
                ) : (
                  <ul className="space-y-1">
                    {versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
                        <span className="tabular-nums">{zhTime(v.created_at)}</span>
                        <span className="tabular-nums">{v.size} 字</span>
                        {v.payload ? <TagChip label="三件套" tone="sky" size="sm" title="含 system + user 模板 + 注入配置" /> : <TagChip label="仅 system" tone="slate" size="sm" />}
                        {v.restored_from && <TagChip label="回滚" tone="amber" size="sm" title={`来自版本 #${v.restored_from}`} />}
                        <span className="truncate text-ink-faint">{v.created_by_name ?? "—"}</span>
                        <span className="flex-1" />
                        <button
                          onClick={() => {
                            setDraft(v.payload?.system ?? v.content);
                            setDirty(true);
                            notify("已载入该版本 system 到编辑器（未保存）");
                          }}
                          className="rounded px-2 py-0.5 text-ink-soft hover:bg-soft hover:text-accent"
                        >
                          载入 system
                        </button>
                        <button
                          onClick={() => void rollback(v)}
                          className="rounded px-2 py-0.5 text-ink-soft hover:bg-soft hover:text-warn"
                          title="整体恢复该版本的三件套并立即生效"
                        >
                          回滚
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p className="mt-2 text-[10px] text-ink-faint">保存即生效（≤60s 缓存、主动失效）；启用开关关闭 = 整 key 回退代码默认</p>
            <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-xs text-ink-mute" title="关闭后此 key 使用代码默认值">
              <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); }} className="h-3.5 w-3.5 accent-sky-500" />
              启用此覆盖
            </label>
          </section>
        </div>
      )}
      </div>
    </div>
  );
}
