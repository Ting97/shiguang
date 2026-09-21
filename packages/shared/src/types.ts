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

/** 待办（TODO 模块，微软 To Do 式）：接口返回的行结构（未组装子级） */
export interface TodoRow {
  id: string;
  parent_todo_id: string | null;
  title: string;
  activity_id: string | null;
  activity_name: string | null;
  icon: string | null;
  color: string | null;
  due_at: string | null;
  start_at: string | null;
  remind_at: string | null;
  status: string;
  source: string;
  is_important: boolean;
  today_tag_date: string | null;
  note: string | null;
  done_at: string | null;
  created_at: string;
  /* —— REQ-001 R3 行动模型 / 空间 —— */
  space_id: string | null;
  sort: number;
  repeat_daily: boolean;
  repeat_done_count: number;
  last_done_date: string | null;
}

/** 目标空间（REQ-001 R3）：宏大目标容器 */
export interface Space {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  status: "active" | "archived";
  started_at: string | null;
  target_date: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
  todo_total?: number;
  todo_done?: number;
  action_total?: number;
  action_done?: number;
  entry_count?: number;
}

/** 今日行动清单条目：行动 + 父待办上下文 */
export interface TodayAction extends TodoRow {
  parent_title: string;
  parent_due: string | null;
}

/** 待办树节点：顶层待办 + 子待办（最多一层） */
export interface TodoItem extends TodoRow {
  children: TodoRow[];
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
  todos: { id: string; title: string; dueAt: string | null; startAt?: string | null; status: string; activityId: string | null }[];
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
  images: FeedImage[];
  space: { id: string; name: string; icon: string; color: string } | null;
  recognitions: Partial<Record<string, { status: "applied" | "pending" | "none"; confidence: number; reason?: string | null; reasonDismissed?: boolean; engine?: string | null }>>;
  /** 五域识别完成时间；为空 = 仍在后台识别（卡片显示「AI 识别中」） */
  analyzed_at: string | null;
}

/** 动态图片（REQ-001 R1）：访问统一走 /api/files/{storageKey} */
export interface FeedImage {
  id: string;
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
  sort: number;
}
