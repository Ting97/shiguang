/**
 * 目标分包 list/detail 两页共用类型与小工具。
 * 口径逐条对齐 web：lib/bj-time（北京时区）、spaces/page.tsx 的 daysOf/progressOf、
 * todo-bits.dueTag、use-arm-confirm（两步删除）。
 */
import { useRef, useState } from "react";

/** GET /api/spaces 行结构（= web lib/types Space；本页消费的子集） */
export interface SpaceRow {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  status?: string;
  started_at?: string | null;
  target_date?: string | null;
  todo_total?: number;
  todo_done?: number;
  action_total?: number;
  action_done?: number;
  entry_count?: number;
  reflection_count?: number;
}

/** pg date/timestamptz 按北京日期还原（+8h 归一后取 UTC 日；本地 getter 在海外设备差一天） */
export function bjDate(v: unknown): string {
  if (v == null) return "";
  return new Date(new Date(String(v)).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 北京今天 YYYY-MM-DD（REQ-009 9-C 单源：= shared/date bjToday，原手工拷贝已收敛） */
export { bjToday } from "@shiguangri/shared";

/** ISO → 北京 M/D HH:mm（动态时间戳，= web moments-section bjStamp） */
export function bjStamp(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 持续天数：起点钉在北京零点（T00:00:00+08:00 钉法），与 web daysOf 同口径（第 N 天两处一致） */
export function daysOf(startedAt?: string | null): number | null {
  if (!startedAt) return null;
  return Math.max(1, Math.ceil((Date.now() - new Date(`${bjDate(startedAt)}T00:00:00+08:00`).getTime()) / 86_400_000));
}

/** todo 进度百分比（顶层待办口径 todo_done/todo_total）；无待办返回 null（不显示进度条） */
export function progressOf(s: SpaceRow): number | null {
  return s.todo_total ? Math.round(((s.todo_done ?? 0) / s.todo_total) * 100) : null;
}

export interface DueTag {
  text: string;
  tone: "danger" | "warn" | "accent" | "mute";
}

/** due 标签（= web todo-bits.dueTag）：已过期红 / 今天黄 / 明天蓝 / N 天后灰 */
export function dueTag(iso?: string | null): DueTag | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (t < Date.now()) return { text: "已过期", tone: "danger" };
  const dayIdx = (v: number) => Math.floor((v + 8 * 3600_000) / 86_400_000);
  const days = dayIdx(t) - dayIdx(Date.now());
  if (days === 0) return { text: "今天", tone: "warn" };
  if (days === 1) return { text: "明天", tone: "accent" };
  return { text: `${days} 天后`, tone: "mute" };
}

/**
 * 两步确认（= web useArmConfirm）：首点进入武装态，3 秒内再点才真正执行，超时自动解除。
 * 返回 true = 本次应执行；false = 刚进入武装态（提示用户再点一次）。
 */
export function useArmConfirm() {
  const [armedId, setArmedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (id: string): boolean => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (armedId === id) {
      setArmedId(null);
      return true;
    }
    setArmedId(id);
    timerRef.current = setTimeout(() => setArmedId(null), 3000);
    return false;
  };
  return { armedId, arm };
}
