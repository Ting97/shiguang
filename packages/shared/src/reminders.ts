/**
 * W12 提醒推送 —— 工作台横幅的候选条目计算（纯函数，便于单测）
 * 数据源：contacts.birthday / contacts.anniversary（复用 social 的生日倒计时逻辑）+ todos.remind_at
 * 短信等主动消息依赖 SMS 通道，Phase 4 再接（docs/10 §2）
 */
import { birthdayCountdown, birthdayCountdownOf, type BirthdayFields } from "./social";

export interface ReminderContact extends BirthdayFields {
  id: string;
  name: string;
  birthday: string | null; // YYYY-MM-DD（SQL 里 to_char，防 pg date 时区偏移）；农历生日时为空
  anniversary: string | null; // YYYY-MM-DD
}

export interface ReminderTodo {
  id: string;
  title: string;
  due_at: string | null;
  remind_at: string | null;
}

export interface ReminderItem {
  key: string;
  kind: "birthday" | "anniversary" | "todo";
  label: string;
  contactId?: string; // 联系人类条目 → 跳 TA 档案
  todoId?: string; // todo 条目 → 锚到工作台 todo 区
  overdue?: boolean;
  /** 排序权重：越紧迫越小（已过期待办 -1，今天 0，N 天后 N） */
  sort: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 生日/纪念日/到期待办 → 横幅条目（窗口默认 7 天，含今天） */
export function pickReminders(
  contacts: ReminderContact[],
  todos: ReminderTodo[],
  now = new Date(),
  windowDays = 7,
): ReminderItem[] {
  const items: ReminderItem[] = [];

  for (const c of contacts) {
    const bd = birthdayCountdownOf(c, now);
    if (bd !== null && bd <= windowDays) {
      items.push({
        key: `bd-${c.id}`,
        kind: "birthday",
        contactId: c.id,
        sort: bd,
        label: bd === 0 ? `今天是 ${c.name} 的生日，记得送上祝福 🎂` : `${c.name} 的生日 ${bd === 1 ? "明天" : `${bd} 天后`}，提前准备一下？`,
      });
    }
    const ad = birthdayCountdown(c.anniversary, now);
    if (ad !== null && ad <= windowDays) {
      items.push({
        key: `an-${c.id}`,
        kind: "anniversary",
        contactId: c.id,
        sort: ad,
        label: ad === 0 ? `今天是和 ${c.name} 的纪念日 💞` : `和 ${c.name} 的纪念日 ${ad === 1 ? "明天" : `${ad} 天后`} 💞`,
      });
    }
  }

  for (const t of todos) {
    const dueRaw = t.due_at ? new Date(t.due_at) : null;
    const due = dueRaw && !Number.isNaN(dueRaw.getTime()) ? dueRaw : null;
    const overdue = due !== null && due < now;
    const hm = due ? `（${pad(due.getHours())}:${pad(due.getMinutes())}）` : "";
    items.push({
      key: `td-${t.id}`,
      kind: "todo",
      todoId: t.id,
      sort: overdue ? -1 : 0,
      overdue,
      label: `${overdue ? "todo 已过期" : "todo 即将到期"}：${t.title}${hm}`,
    });
  }

  return items.sort((a, b) => a.sort - b.sort);
}
