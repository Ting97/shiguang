"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedMoment } from "@/lib/types";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";

/**
 * 单张动态卡内的提交逻辑 hook：
 * - 操作反馈统一走全局 toast（自动消失；卡片可能滚动出视口，就地横幅反而看不见）
 * - busyDomain：识别菜单里正在 AI 识别的域
 * - run / recognizeDomain / manualAdd / del：统一的取数与提交入口
 */
export function useCardActions(m: FeedMoment, onRefresh: () => Promise<void>) {
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  // 两步删除的待确认 key（3 秒超时自动复位）
  const [delArmed, setDelArmed] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  const run = async (fn: () => Promise<string>) => {
    try {
      toast(await fn());
      await onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
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
      toast(j.message ?? "已添加");
      await onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
      throw e;
    }
  };

  /** 两步删除（全站规范）：首点 arm(key)，按钮呈「确认删除？」；3 秒内再点同一 key 执行 */
  const del = (key: string, fn: () => Promise<unknown>) => {
    if (delArmed === key) {
      setDelArmed(null);
      void run(async () => (await fn(), "🗑 已删除"));
      return;
    }
    setDelArmed(key);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setDelArmed(null), 3000);
  };

  return { busyDomain, run, recognizeDomain, manualAdd, del, delArmed };
}
