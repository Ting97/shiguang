"use client";

import Reminders from "@/components/reminders";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import type { ReminderItem } from "@/lib/reminders";

/** W12 提醒横幅：生日/纪念日/到期 todo（可一键加入今日） */
export default function RemindersBanner({
  items,
  load,
}: {
  items: ReminderItem[];
  load: () => Promise<void>;
}) {
  return (
    <Reminders
      items={items}
      onMarkToday={async (todoId, label) => {
        try {
          await api(`/api/todos/${todoId}`, "PATCH", { today: true });
          toast(`☀️ 已加入今日 todo`);
          await load();
        } catch {
          toast(`加入今日失败（${label.slice(0, 20)}…）`, "err");
        }
      }}
    />
  );
}
