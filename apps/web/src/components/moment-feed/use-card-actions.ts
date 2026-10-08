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

  // 行内编辑「保存」等按钮无 disabled 态：重入锁防双击并发提交
  // （PATCH 双发、DELETE 第二次 404 会再弹一条错误 toast）
  const runningRef = useRef(false);

  // delArmed 的镜像 ref：快速二次点击时两次事件都读到旧 state 闭包，只用 state 判断会两次都 arm
  const delArmedRef = useRef<string | null>(null);

  const run = async (fn: () => Promise<string>): Promise<boolean> => {
    if (runningRef.current) {
      // 重入锁占用 = 本次点击未受理：静默返回会让用户以为点了没生效（全部调用方都是用户点击，无程序化路径）
      toast("上一步操作还在进行中，请稍候", "info");
      return false;
    }
    runningRef.current = true;
    try {
      toast(await fn());
      await onRefresh();
      // 卡片内容变了（增删识别产物/待办），「今日行动」清单同步重拉（它只监听该事件）
      window.dispatchEvent(new CustomEvent("shiguang:entry-analyzed"));
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
      return true; // 请求已发出并失败：确认态照常收尾
    } finally {
      runningRef.current = false;
    }
  };

  /** 菜单里点某域：AI 识别该域（服务端 LLM 预算 45s+，客户端超时放宽到 120s） */
  const recognizeDomain = (domain: string) =>
    run(async () => {
      setBusyDomain(domain);
      try {
        const j = await api(`/api/entries/${m.id}/recognize`, "POST", { domain }, undefined, {
          timeoutMs: 120_000,
        });
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
    if (delArmedRef.current === key) {
      delArmedRef.current = null;
      setDelArmed(null);
      void run(async () => (await fn(), "🗑 已删除"));
      return;
    }
    delArmedRef.current = key;
    setDelArmed(key);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => {
      delArmedRef.current = null;
      setDelArmed(null);
    }, 3000);
  };

  return { busyDomain, run, recognizeDomain, manualAdd, del, delArmed };
}
