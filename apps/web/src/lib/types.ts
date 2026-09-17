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
