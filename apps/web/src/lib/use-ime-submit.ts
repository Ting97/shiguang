"use client";

import { useRef, type FormEvent } from "react";

/**
 * 表单隐式提交的 IME 守卫：WebKit/Safari（含 iOS）组词确认 Enter 仍会触发 <form> 的
 * 隐式提交，而 submit 事件不携带键盘信息——onKeyDown 的 isComposing 守卫覆盖不到
 * （Chrome 已修，Safari 未修）。组词确认的时序是 compositionend 紧跟 submit：
 * 记下 compositionend 时刻，短窗内到达的 submit 视为候选确认拦截（不执行保存）。
 * 代价：组词结束后 100ms 内的主动提交也会被拦一次——再按一次 Enter 即可，可接受。
 * 用法：const ime = useImeSubmit(save); <form onSubmit={ime.onSubmit} onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd}>
 */
export function useImeSubmit(save: () => void | Promise<unknown>) {
  const lastCompEndRef = useRef(0);
  return {
    onCompositionStart: () => {
      lastCompEndRef.current = 0;
    },
    onCompositionEnd: () => {
      lastCompEndRef.current = Date.now();
    },
    onSubmit: (e: FormEvent) => {
      e.preventDefault();
      if (lastCompEndRef.current && Date.now() - lastCompEndRef.current < 100) return;
      void save();
    },
  };
}
