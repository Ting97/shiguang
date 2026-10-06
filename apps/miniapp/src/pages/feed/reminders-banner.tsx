/**
 * W12 提醒横幅（= web app/home/reminders-banner.tsx + components/reminders.tsx）：
 * 生日/纪念日/到期 todo；todo 条目可一键「☀️ 今日」（PATCH today:true）；
 * 「知道了」当天不再展示（storage 按北京日期记录，次日自动回来）。
 */
import { useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { showToast } from "@/components/toast";
import { patchTodo } from "./api";
import { TagChip } from "./chip";
import LucideIcon, { type LucideIconName } from "../../components/lucide-icon";
import { bjToday, type ReminderItem } from "./kit";

const DISMISS_KEY = "shiguang_reminders_dismissed";

/** web 用本地日 todayStr 记「今天不再展示」；这里统一北京日口径（跨零点自动失效的语义不变） */
function dismissedToday(): boolean {
  try {
    return Taro.getStorageSync(DISMISS_KEY) === bjToday();
  } catch {
    return false;
  }
}

export default function RemindersBanner({
  items,
  load,
}: {
  items: ReminderItem[];
  /** 加入今日成功后刷新整页（= web load） */
  load: () => Promise<void>;
}) {
  // 默认不展示，读到 storage 后纠正，避免闪烁（= web dismissed 初值 true）
  const [dismissed, setDismissed] = useState(dismissedToday);
  // 已标今日的条目（防重复提交 + 即时反馈）
  const [marked, setMarked] = useState<Set<string>>(new Set());

  if (items.length === 0 || dismissed) return null;

  async function markToday(it: ReminderItem) {
    if (!it.todoId || marked.has(it.todoId)) return;
    setMarked((s) => new Set(s).add(it.todoId!));
    try {
      await patchTodo(it.todoId!, { today: true });
      showToast({ type: "ok", text: "☀️ 已加入今日 todo" });
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: `加入今日失败（${it.label.slice(0, 20)}…）${e?.message ? `：${e.message}` : ""}` });
    }
  }

  function dismissToday() {
    try {
      Taro.setStorageSync(DISMISS_KEY, bjToday());
    } catch {
      /* storage 不可用：本次会话内仍生效 */
    }
    setDismissed(true);
  }

  return (
    // = web section.rounded-xl.border-amber-500/30.bg-amber-500/10.px-3.py-2.5.text-xs
    <View className="rb">
      <View className="rb-head">
        <TagChip lucide="bell" label="提醒" tone="amber" />
        <View className="rb-spacer" />
        <Text className="rb-dismiss" onClick={dismissToday}>
          知道了 ✕
        </Text>
      </View>
      <View className="rb-list">
        {items.map((it) => (
          <View key={it.key} className="rb-item">
            <View className="rb-icon">
              <LucideIcon
                name={(it.kind === "birthday" ? "cake" : it.kind === "anniversary" ? "heart" : it.overdue ? "alarm_clock" : "list_todo") as LucideIconName}
                size={11}
                color="var(--warn)"
              />
            </View>
            <Text className={`rb-label${it.overdue ? " rb-overdue" : ""}`}>{it.label}</Text>
            {it.todoId ? (
              <View className={`rb-mark ico-row${marked.has(it.todoId) ? " rb-marked" : ""}`} onClick={() => void markToday(it)}>
                {marked.has(it.todoId) ? (
                  <Text>已加入 ✓</Text>
                ) : (
                  <>
                    <LucideIcon name="sun" size={11} color="var(--warn)" />
                    <Text>今日</Text>
                  </>
                )}
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
