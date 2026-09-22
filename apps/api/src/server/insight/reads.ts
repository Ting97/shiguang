/**
 * insight 读侧跨域表清单（REQ-004 FR-B1.3 依赖规则 / 004 持续项③）：
 * insight 作为显式 CQRS 读模型允许跨域 SELECT，但表必须在此集中声明——
 * repo/路由新增跨域读时先登记此清单（评审一目了然，CI 可 grep 校验）。
 * 跨域写入仍然禁止（写走各域 service 接口）。
 */
export const INSIGHT_READABLE_TABLES = [
  // timeline
  "entries",
  "entry_recognitions",
  "entry_images",
  "diet_records",
  // time
  "time_blocks",
  "activities",
  // goal
  "todos",
  "goal_spaces",
  "space_reflections",
  // finance
  "transactions",
  "accounts",
  "budgets",
  // people
  "contacts",
  "interactions",
  // ai（审计计量聚合）
  "audit_logs",
  // 本域
  "review_caches",
  "review_gen_quotas",
  "user_ai_profiles",
] as const;

export type InsightReadableTable = (typeof INSIGHT_READABLE_TABLES)[number];
