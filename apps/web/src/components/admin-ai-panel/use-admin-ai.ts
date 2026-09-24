"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/shared/api";
import { MODE_META, validateTpl, zhTime } from "./kit";
import type { EngineMode, PromptItem, Version } from "./types";
import { useAdminUserData } from "./use-admin-user-data";

/**
 * AI 管理面板取数与提交逻辑（自 admin-ai-panel.tsx 原样迁出）：
 * prompt 清单加载 / 三段式草稿状态 / 保存·恢复默认·回滚 / AI 优化 / 装配预览 / 引擎模式开关。
 * 个性化注入（REQ-005 FR-5.6）的 userData 草稿与 catalog 懒加载在 ./use-admin-user-data。
 */
export function useAdminAi(notify: (text: string, ok?: boolean) => void) {
  const [items, setItems] = useState<PromptItem[] | null>(null);
  // 清单加载失败态：失败要落明确错误（否则 items 永远 null，面板停在永久「加载中」）
  const [loadErr, setLoadErr] = useState<string | null>(null);
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
  // 个性化注入（REQ-005 FR-5.6）：userData 草稿 + catalog 懒加载 + 超顶估算
  const ud = useAdminUserData(notify, sel);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const j = await api<any>("/api/admin/prompts");
      setItems(j.items as PromptItem[]);
      return j.items as PromptItem[];
    } catch (e) {
      // 失败置错误终态（面板据此展示重试按钮），不再只 notify 后停在永久「加载中」
      setLoadErr(e instanceof Error ? e.message : "加载失败");
      notify(e instanceof Error ? e.message : "加载失败", false);
    }
  }, [notify]);

  // 版本列表请求序号守卫：快速切换 prompt 时慢回包不再覆盖新选中的版本列表
  const verSeq = useRef(0);
  // 危险操作（恢复默认/回滚版本）两步确认：armed key + 3 秒超时复位
  const [armKey, setArmKey] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function armTimer(ms: number) {
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setArmKey(null), ms);
  }
  const loadVersions = useCallback(async (key: string) => {
    const seq = ++verSeq.current;
    try {
      const j = await api<any>(`/api/admin/prompts/${key}`);
      if (seq === verSeq.current) setVersions(j.versions);
    } catch {
      if (seq === verSeq.current) setVersions(null);
    }
  }, []);

  useEffect(() => {
    load().then((list) => {
      if (list?.length) pick(list[0]);
    });
    api("/api/admin/ai-mode")
      .then((j) => {
        setEngineMode(j.mode);
        setEngineEnvDefault(j.envDefault);
      })
      .catch(() => {});
    // （原文件的 react-hooks/exhaustive-deps disable 注释不迁移：该规则在本仓库 eslint 配置中已全局关闭）
  }, []);

  /** 首次加载失败后的重试：与 useEffect 首载同语义（重拉清单并选中第一项） */
  function retryLoad() {
    void load().then((list) => {
      if (list?.length) pick(list[0]);
    });
  }

  async function switchEngineMode(mode: EngineMode) {
    if (engineSaving || mode === engineMode) return;
    setEngineSaving(true);
    try {
      await api("/api/admin/ai-mode", "PUT", { mode });
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
    ud.resetUserData(item);
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
  // contextConfig 提交口径：inject/caps 有改动，或 userData 有改动，或该 key 配置过 userData
  //（第三条保证已配置个性化注入的 key 在无关保存（如只改 system）时原样回传，不被 contextConfig:null 清空）
  const sendCfg =
    !!sel && (cfgDirty || ud.userDataDirty || (sel.effectiveConfig.userData?.length ?? 0) > 0);

  async function save() {
    if (!sel || !draft.trim() || saving) return;
    if (tplMissing.length || tplUnknown.length) {
      notify(`user 模板占位符未通过：${[...tplMissing.map((x) => `{${x}}缺失`), ...tplUnknown.map((x) => `{${x}}未知`)].join("、")}`, false);
      return;
    }
    setSaving(true);
    try {
      await api(`/api/admin/prompts/${sel.key}`, "PUT", {
        content: draft,
        enabled,
        // 改回默认值 = 清除覆盖（null）；有改动才提交覆盖
        userTemplate: tplDirty ? tplDraft : null,
        contextConfig: sendCfg ? { inject: injectDraft, caps: capsDraft, userData: ud.userDataDraft } : null,
      });
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
    if (!sel) return;
    // 两步确认（全站规范）：首点进入待确认态，3 秒内再点执行
    if (armKey !== `revert:${sel.key}`) { setArmKey(`revert:${sel.key}`); armTimer(3000); return; }
    setArmKey(null);
    try {
      await api(`/api/admin/prompts/${sel.key}`, "DELETE");
      notify(`「${sel.title}」已恢复代码默认`);
      const list = await load();
      const fresh = list?.find((x) => x.key === sel.key);
      if (fresh) pick(fresh);
    } catch {
      notify("操作失败", false);
    }
  }

  async function rollback(v: Version) {
    if (!sel) return;
    const key = `rollback:${v.id}`;
    // 两步确认（全站规范）：首点进入待确认态，3 秒内再点执行
    if (armKey !== key) { setArmKey(key); armTimer(3000); return; }
    setArmKey(null);
    try {
      await api(`/api/admin/prompts/${sel.key}/restore`, "POST", { versionId: v.id });
      notify(`已回滚到 ${zhTime(v.created_at)} 的版本`);
      const list = await load();
      const fresh = list?.find((x) => x.key === sel.key);
      if (fresh) pick(fresh);
    } catch (e) {
      notify(e instanceof Error ? e.message : "回滚失败", false);
    }
  }

  async function optimize() {
    if (!sel || optimizing) return;
    setOptimizing(true);
    setSuggestion(null);
    try {
      const j = await api<any>(`/api/admin/prompts/${sel.key}/optimize`, "POST", { hint: optHint });
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
      const j = await api<any>(`/api/admin/prompts/${sel.key}/preview`, "POST", {
        sample: previewSample || undefined,
        period: previewPeriod || undefined,
      });
      setPreviewText(j.userPrompt);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), false);
    } finally {
      setPreviewing(false);
    }
  }

  /** 采纳 AI 优化建议到编辑器（原内联 onClick；按钮仅在 suggestion 非空时渲染，守卫不可达） */
  function adoptSuggestion() {
    if (suggestion === null) return;
    setDraft(suggestion);
    setDirty(true);
    setSuggestion(null);
    notify("已采纳到编辑器（未保存）");
  }

  /** 一键补齐缺失占位符：追加在模板末尾（原内联 onClick；仅缺失占位符可点，守卫与之等价） */
  function fillMissingPlaceholder(p: string) {
    if (!sel) return;
    if (!validateTpl(tplDraft, sel.registry.placeholders).missing.includes(p)) return;
    const fixed = tplDraft.replace(/\s*$/, "") + "\n" + sel.registry.placeholders.filter((x) => validateTpl(tplDraft, sel.registry.placeholders).missing.includes(x)).map((x) => `{${x}}`).join(" ");
    setTplDraft(fixed);
    notify("已补齐缺失占位符（追加在模板末尾，可自行调整位置）");
  }

  /** user 模板还原为代码默认（保存后清除覆盖）（原内联 onClick） */
  function resetTpl() {
    if (!sel) return;
    setTplDraft(sel.userTemplateDefault);
    notify("user 模板已还原为代码默认（保存后清除覆盖）");
  }

  /** 载入某版本 system 到编辑器（未保存）（原内联 onClick） */
  function loadVersionSystem(v: Version) {
    setDraft(v.payload?.system ?? v.content);
    setDirty(true);
    notify("已载入该版本 system 到编辑器（未保存）");
  }

  const isReview = sel?.key.startsWith("review_") ?? false;
  const periodPlaceholder = sel?.key === "review_month" ? "期间 YYYY-MM（空=本月）" : sel?.key === "review_year" ? "期间 YYYY（空=今年）" : "期间 YYYY-MM-DD（空=今天）";

  return {
    armKey,
    setArmKey,
    items,
    loadErr,
    sel,
    draft,
    setDraft,
    enabled,
    setEnabled,
    dirty,
    setDirty,
    saving,
    showCompare,
    setShowCompare,
    optHint,
    setOptHint,
    optimizing,
    suggestion,
    setSuggestion,
    engineMode,
    engineEnvDefault,
    engineSaving,
    tplDraft,
    setTplDraft,
    tplMissing,
    tplUnknown,
    tplDirty,
    cfgDirty,
    injectDraft,
    setInjectDraft,
    capsDraft,
    setCapsDraft,
    previewSample,
    setPreviewSample,
    previewPeriod,
    setPreviewPeriod,
    previewing,
    previewText,
    versions,
    showVersions,
    setShowVersions,
    isReview,
    periodPlaceholder,
    ...ud,
    switchEngineMode,
    pick,
    retryLoad,
    save,
    revertDefault,
    rollback,
    optimize,
    runPreview,
    adoptSuggestion,
    fillMissingPlaceholder,
    resetTpl,
    loadVersionSystem,
  };
}
