"use client";

import Reminders from "@/components/reminders";
import { api } from "@/shared/api";
import type { ReminderItem } from "@/lib/reminders";
import type { Notify } from "./types";

/** W12 提醒横幅：生日/纪念日/到期 todo（可一键加入今日） */
export default function RemindersBanner({
  items,
  setMsg,
  load,
}: {
  items: ReminderItem[];
  setMsg: Notify;
  load: () => Promise<void>;
}) {
  return (
    <Reminders
      items={items}
      onMarkToday={async (todoId, label) => {
        try {
          await api(`/api/todos/${todoId}`, "PATCH", { today: true });
          setMsg({ ok: true, text: `☀️ 已加入今日 todo` });
          await load();
        } catch {
          setMsg({ ok: false, text: `加入今日失败（${label.slice(0, 20)}…）` });
        }
      }}
    />
  );
}
