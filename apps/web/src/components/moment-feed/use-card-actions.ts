"use client";

import { useEffect, useState } from "react";
import type { FeedMoment } from "@/lib/types";
import { api } from "@/shared/api";
import type { CardMsg } from "./types";

/**
 * 单张动态卡内的提交逻辑 hook：
 * - cardMsg：识别/手动添加/编辑/删除的成功失败都显示在当前卡片内（顶部横幅在长页面上看不见），自动消失
 * - busyDomain：识别菜单里正在 AI 识别的域
 * - run / recognizeDomain / manualAdd / del：统一的取数与提交入口
 */
export function useCardActions(m: FeedMoment, onRefresh: () => Promise<void>) {
  const [cardMsg, setCardMsg] = useState<CardMsg>(null);
  const [busyDomain, setBusyDomain] = useState<string | null>(null);

  // 卡内消息自动消失：成功 3.5s / 失败 8s（失败停留更久方便看清原因）
  useEffect(() => {
    if (!cardMsg) return;
    const t = setTimeout(() => setCardMsg(null), cardMsg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [cardMsg]);

  const run = async (fn: () => Promise<string>) => {
    try {
      setCardMsg({ ok: true, text: await fn() });
      await onRefresh();
    } catch (e) {
      setCardMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** 菜单里点某域：AI 识别该域 */
  const recognizeDomain = (domain: string) =>
    run(async () => {
      setBusyDomain(domain);
      try {
        const j = await api(`/api/entries/${m.id}/recognize`, "POST", { domain });
        return j.message ?? "已重新识别";
      } finally {
        setBusyDomain(null);
      }
    });

  /** 菜单里手动添加某域产物 */
  const manualAdd = async (domain: string, payload: Record<string, unknown>) => {
    try {
      const j = await api(`/api/entries/${m.id}/manual`, "POST", { domain, payload });
      setCardMsg({ ok: true, text: j.message ?? "已添加" });
      await onRefresh();
    } catch (e) {
      setCardMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  const del = (message: string, fn: () => Promise<unknown>) =>
    window.confirm(message) ? run(async () => (await fn(), "🗑 已删除")) : undefined;

  return { cardMsg, setCardMsg, busyDomain, run, recognizeDomain, manualAdd, del };
}
