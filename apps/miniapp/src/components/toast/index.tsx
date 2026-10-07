/**
 * 全局 Toast（= web shared/ui/toast.tsx 的小程序同语义版，REQ-009 9-C）：
 * - 命令式 showToast({ type, text })：ok=成功 / err=失败 / info=提示，任何组件无需挂载关系直接调用；
 *   渲染由挂在 PageShell 的 <ToastHost/> 承担（登录/绑定页不用 PageShell，页面里单独挂一次）。
 * - 与 web 的任务约定差异：web 顶部下滑、ok 3.2s/info 4.2s/err 8s；小程序底部浮出（拇指区可见）
 *   且停留更短（ok 1.8s / info 2.6s / err 3.5s），点击任意一条立即关闭，同屏最多 3 条（超出最旧让位）。
 * - type=ok 时附带轻振动（Taro.vibrateShort light，对齐 mobile Haptics.success 的成功反馈；
 *   模拟器/老设备不支持时静默）。表单就地校验与持续状态横幅（loadErr 等）不走这里。
 * - 着色与 web 同语义：成功 emerald/失败 rose/提示 sky 的半透明底 + 令牌文字色（--success/--danger/--accent），
 *   深浅主题自动适配。
 */
import { useRef, useEffect, useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import LucideIcon, { type LucideIconName } from "../lucide-icon";
import "./index.scss";

export type ToastType = "ok" | "err" | "info";

export interface ToastPayload {
  type: ToastType;
  text: string;
}

interface ToastItem extends ToastPayload {
  id: number;
  /** 离场中：先播 200ms 收起动画再移除（= web LEAVE_MS） */
  leaving?: boolean;
}

const DURATION_MS: Record<ToastType, number> = { ok: 1800, info: 2600, err: 3500 };
const LEAVE_MS = 200;
const MAX_VISIBLE = 3;

type Listener = (t: ToastItem) => void;
/** 模块级订阅表：Taro 每页一个渲染树，命令式入口经它广播到当前页的 ToastHost */
const listeners = new Set<Listener>();
let seq = 0;

/** 发一条全局 toast：showToast({ type: "ok", text: "已保存" }) / { type: "err", text: "保存失败：…" } */
export function showToast(t: ToastPayload) {
  if (t.type === "ok") Taro.vibrateShort({ type: "light" }).catch(() => {});
  const item: ToastItem = { ...t, id: ++seq };
  listeners.forEach((l) => l(item));
}

const ICON: Record<ToastType, LucideIconName> = { ok: "check_circle_2", err: "x", info: "info" };

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  // 待触发自动收起的定时器：卸载时清理（页面销毁后不再 setState）
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const l: Listener = (t) => {
      // 同屏超过上限：最旧一条立即让位（= web MAX_VISIBLE）
      setItems((arr) => (arr.length >= MAX_VISIBLE ? [...arr.slice(arr.length - MAX_VISIBLE + 1), t] : [...arr, t]));
      const timer = setTimeout(() => dismiss(t.id), DURATION_MS[t.type]);
      timers.current.push(timer);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
      timers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 点击关闭：先置 leaving 播收起动画，动画结束再真正移除 */
  function dismiss(id: number) {
    setItems((arr) => arr.map((x) => (x.id === id && !x.leaving ? { ...x, leaving: true } : x)));
    setTimeout(() => setItems((arr) => arr.filter((x) => x.id !== id)), LEAVE_MS);
  }

  if (items.length === 0) return null;
  return (
    <View className="gtoast-host">
      {items.map((t) => (
        <View
          key={t.id}
          hoverClass="press"
          hoverStayTime={80}
          onClick={() => dismiss(t.id)}
          className={`gtoast gtoast-${t.type} ${t.leaving ? "gtoast-leave" : "gtoast-enter"}`}
        >
          <View className="gtoast-icon">
            <LucideIcon
              name={ICON[t.type]}
              size={12}
              color={t.type === "ok" ? "var(--success)" : t.type === "err" ? "var(--danger)" : "var(--accent)"}
            />
          </View>
          <Text className="gtoast-text">{t.text}</Text>
        </View>
      ))}
    </View>
  );
}
