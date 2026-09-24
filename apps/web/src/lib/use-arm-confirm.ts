"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 两步确认（全站规范，替代原生 window.confirm——阻塞式弹窗与全站样式化确认不一致，
 * 移动 WebView 观感差）：首次 arm(id) 进入待确认态并启动超时，超时内再次 arm(id)
 * 返回 true（调用方执行删除）；超时/换目标/手动 disarm 自动复位。
 * 参考 BlockEditor / ActivityPanel 的既有两步删除交互。
 */
export function useArmConfirm(timeoutMs = 3000) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  /** 返回 true = 已处于待确认态，可以执行 */
  function arm(id: string): boolean {
    if (armedId === id) {
      disarm();
      return true;
    }
    setArmedId(id);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmedId(null), timeoutMs);
    return false;
  }
  function disarm() {
    if (timer.current) clearTimeout(timer.current);
    setArmedId(null);
  }
  return { armedId, arm, disarm };
}
