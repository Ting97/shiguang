/**
 * feed 页共用小工具（= web moment-feed/kit.ts + lib/mood + lib/bj-time + lib/reminders 的页面局部移植）。
 * 纯函数无副作用：时间全部走「UTC + 8h 再取 UTC getter」的北京口径——
 * getHours() 等本地 getter 在非中国时区设备会错 8 小时（海外日界错一天的坑）。
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** 北京日历日序号（UTC+8 推算，禁本地 getter） */
export const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);

/** ISO → 北京 HH:MM（= web zhClock/zhTime） */
export const bjClock = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** 北京今天 YYYY-MM-DD（= web bjToday；lib/api 里有同款，这里不跨目录再引一份避免耦合） */
export const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** ISO → 北京日历日键 YYYY-MM-DD（= web bjYmd，日程冲突「去调整」跳日期用） */
export const bjDateKey = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/** 记录时刻 →「今天 15:32 / 昨天 21:04 / 9月15日 08:30」（= web zhRecordTime，按天分组的键也来自它） */
export function zhRecordTime(iso: string): { day: string; clock: string } {
  const t = Date.parse(iso);
  const nowT = Date.now();
  const diffDays = bjDayIdx(nowT) - bjDayIdx(t);
  const d = new Date(t + 8 * 3600_000);
  const clock = bjClock(iso);
  if (diffDays === 0) return { day: "今天", clock };
  if (diffDays === 1) return { day: "昨天", clock };
  const sameYear = d.getUTCFullYear() === new Date(nowT + 8 * 3600_000).getUTCFullYear();
  return {
    day: `${sameYear ? "" : d.getUTCFullYear() + "年"}${d.getUTCMonth() + 1}月${d.getUTCDate()}日`,
    clock,
  };
}

/** 跨天时间块的日期前缀：非今天 →「9月17日 」（凌晨记录的「昨天下午」不被误读为今天） */
export function dayPrefix(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 8 * 3600_000);
  return bjDayIdx(Date.now()) - bjDayIdx(t) === 0 ? "" : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 `;
}

/** 待办时间标签：起止同日 →「9:10–9:30」区间；否则退回「9月17日 08:30」（= web todoTimeLabel） */
export function todoTimeLabel(startAt?: string | null, dueAt?: string | null): string | null {
  if (!dueAt) return null;
  if (startAt) {
    const a = Date.parse(startAt);
    const b = Date.parse(dueAt);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b && bjDayIdx(a) === bjDayIdx(b)) {
      return `${bjClock(startAt)}–${bjClock(dueAt)}`;
    }
  }
  return `${dayPrefix(dueAt)}${bjClock(dueAt)}`;
}

/** 用原块北京日期 + 新 HH:MM 组装 ISO（= web combineHM：改日程时间只换钟点、日期不动） */
export function combineHM(originalIso: string, hm: string): string {
  const d = new Date(new Date(originalIso).getTime() + 8 * 3600_000);
  const [h, m] = hm.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return new Date(d.getTime() - 8 * 3600_000).toISOString();
}

/** ISO → 北京墙上时间输入值 YYYY-MM-DDTHH:mm（= web isoToBjInput，编辑框回填用） */
export function isoToBjInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 北京墙上时间串 → ISO（显式 +08:00 解析；裸串按宿主时区解释会偏 8 小时） */
export function bjInputToIso(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v.length === 16 ? `${v}:00+08:00` : `${v}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** 分钟数 →「2小时30分」（= web zhDuration，今日日程头部的总时长） */
export function zhDuration(min: number): string {
  if (min <= 0) return "0分钟";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分钟`;
  if (m === 0) return `${h}小时`;
  return `${h}小时${m}分`;
}

/** 金额分 → chip 展示串（= web kit yuan：整百不带小数，其余两位） */
export function yuanCents(cents: number | string): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "¥0";
  return `¥${(n / 100).toFixed(n % 100 === 0 ? 0 : 2)}`;
}

/* ---------- 心情（= web lib/mood） ---------- */

const MOOD_EMOJI: Array<[RegExp, string]> = [
  [/生气|气死|愤怒|火大|气人/, "😠"],
  [/难过|伤心|失落|想哭|emo|崩溃/, "😢"],
  [/委屈|心酸/, "🥺"],
  [/孤独|寂寞/, "😔"],
  [/焦虑|压力|紧张|担心|慌|发愁/, "😟"],
  [/烦|暴躁|郁闷|抓狂|无语|无聊/, "😤"],
  [/累|疲惫|困|犯困|乏力|虚/, "😪"],
  [/幸福|感恩|感谢|幸运/, "🥰"],
  [/兴奋|激动|期待|迫不及待/, "🤩"],
  [/开心|高兴|快乐|心情好|心情不错|爽|美滋滋/, "😊"],
  [/满足|充实|值得|值了|成就|骄傲/, "😌"],
  [/放松|舒服|惬意|治愈|解压|舒坦/, "😌"],
  [/平静|还行|一般|淡淡/, "🙂"],
];

export function moodEmoji(label: string | null | undefined): string {
  if (!label) return "📝";
  return MOOD_EMOJI.find(([re]) => re.test(label))?.[1] ?? "✨";
}

/** 情绪分 → 文字色（积极琥珀 / 消极玫瑰 / 0 石墨 / 无分 mute）——返回主题令牌，深浅主题自动适配 */
export function moodToneColor(score: number | null | undefined): string {
  if (score == null) return "var(--ink-mute)";
  if (score > 0) return "var(--warn)";
  if (score < 0) return "var(--danger)";
  return "var(--ink-soft)";
}

export const COMMON_MOODS = ["开心", "满足", "兴奋", "放松", "平静", "疲惫", "焦虑", "烦躁", "难过", "生气"];

/** 五域/关系域中文名（待确认提示用，= web DOMAIN_LABELS） */
export const DOMAIN_LABELS: Record<string, string> = {
  schedule: "日程",
  todo: "todo",
  finance: "收支",
  mood: "心情",
  diet: "饮食",
  people: "关系",
};

/** 交易类别（= web lib/finance TX_CATEGORIES，手动补流水/编辑流水共用） */
export const TX_CATEGORIES = ["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "医疗", "居住", "还款", "其他"];

/** 手动补日程的餐次/关系类型选项（= web entry-menu.tsx 内联常量） */
export const MEALS = ["早餐", "午餐", "晚餐", "加餐", "夜宵"];
export const PEOPLE_TYPES = ["见面", "通话", "送礼", "收礼", "请客", "帮忙", "其他"];

/* ---------- 提醒横幅（= web lib/reminders pickReminders + social birthdayCountdown 的局部移植） ---------- */

export interface ReminderItem {
  key: string;
  kind: "birthday" | "anniversary" | "todo";
  label: string;
  contactId?: string;
  todoId?: string;
  overdue?: boolean;
  /** 排序权重：越紧迫越小（已过期待办 -1，今天 0，N 天后 N） */
  sort: number;
}

export interface ReminderContact {
  id: string;
  name: string;
  birthday: string | null;
  birthday_cal?: string | null;
  lunar_month?: number | null;
  lunar_day?: number | null;
  lunar_leap?: boolean | null;
  anniversary: string | null;
}

export interface ReminderTodo {
  id: string;
  title: string;
  due_at: string | null;
  remind_at?: string | null;
}

/** 距下一个生日/纪念日天数：0=今天；"YYYY-MM-DD"/"MM-DD" 均可；无效返回 null（= web social.birthdayCountdown） */
export function birthdayCountdown(birthday: string | null | undefined, now = new Date()): number | null {
  if (!birthday) return null;
  const m = String(birthday).match(/(\d{4})?-?(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 2/29 生日在平年会滚到 3/1 → 用「3 月 0 日」惯用法显式取 2 月最后一天
  const dateOf = (y: number): Date => (month === 2 && day === 29 ? new Date(y, 2, 0) : new Date(y, month - 1, day));
  // 「今天」按北京日历日取（本地日界与业务日界错位时今天/明天边界会错报一天）
  const shifted = new Date(now.getTime() + 8 * 3600_000);
  const bjTodayMs = new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()).getTime();
  const thisYear = dateOf(shifted.getUTCFullYear());
  const target = thisYear.getTime() >= bjTodayMs ? thisYear : dateOf(shifted.getUTCFullYear() + 1);
  return Math.round((target.getTime() - bjTodayMs) / 86_400_000);
}

/** 生日/纪念日/到期待办 → 横幅条目（窗口默认 7 天，含今天；= web pickReminders） */
export function pickReminders(contacts: ReminderContact[], todos: ReminderTodo[], now = new Date(), windowDays = 7): ReminderItem[] {
  const items: ReminderItem[] = [];
  for (const c of contacts) {
    const bd = birthdayCountdown(c.birthday, now);
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
    const bjHm = due ? new Date(due.getTime() + 8 * 3600_000) : null;
    const hm = bjHm ? `（${pad(bjHm.getUTCHours())}:${pad(bjHm.getUTCMinutes())}）` : "";
    const daysLeft = due && !overdue ? Math.max(0, bjDayIdx(due.getTime()) - bjDayIdx(now.getTime())) : 0;
    items.push({
      key: `td-${t.id}`,
      kind: "todo",
      todoId: t.id,
      sort: overdue ? -1 : daysLeft,
      overdue,
      label: `${overdue ? "todo 已过期" : "todo 即将到期"}：${t.title}${hm}`,
    });
  }
  return items.sort((a, b) => a.sort - b.sort);
}

/** 行动到期标签：已过期红 / 今天 / 明天 / N 天后 / 无时间（= web todo-bits.dueTag） */
export function dueTag(iso: string | null | undefined): { text: string; color: string } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  if (t < Date.now()) return { text: "已过期", color: "var(--danger)" };
  const days = bjDayIdx(t) - bjDayIdx(Date.now());
  if (days === 0) return { text: "今天", color: "var(--warn)" };
  if (days === 1) return { text: "明天", color: "var(--accent)" };
  return { text: `${days} 天后`, color: "var(--ink-mute)" };
}
