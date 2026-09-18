/** 共享类型（页面与组件共用） */
export interface Activity {
  id: string;
  name: string;
  icon: string;
  color: string;
  default_min?: number;
  is_preset?: boolean;
}

export interface Block {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  duration_min: number;
  activity_id: string;
  activity_name: string;
  icon: string;
  color: string;
  source: string;
}

/** 单日聚合（统计接口） */
export interface DayStat {
  date: string; // YYYY-MM-DD
  totalMin: number;
  byActivity: Record<string, number>;
}

/** 动态（朋友圈式记录流的一条）：记录时刻 + AI 识别产物 */
export interface FeedMoment {
  id: string;
  raw_text: string;
  source: string;
  mood: string | null;
  mood_score: number | null;
  created_at: string; // 记录时刻（动态的"发布时间"）
  blocks: {
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    durationMin: number;
    activityId: string;
    activityName: string;
    icon: string;
    color: string;
  }[];
  todos: { id: string; title: string; dueAt: string | null; status: string; activityId: string | null }[];
  transactions: {
    id: string;
    amountCents: number;
    direction: string;
    category: string;
    counterparty: string | null;
  }[];
  people: { interactionId: string; name: string; summary: string | null }[];
  diet: {
    id: string;
    meal: string;
    items: { name: string; amount?: string | null; kcal?: number | null }[] | null;
    totalKcal: number | null;
  } | null;
  recognitions: Partial<Record<string, { status: "applied" | "pending" | "none"; confidence: number }>>;
}
