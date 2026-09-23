/** insight 域对外面（REQ-004 FR-B1.2）：跨域只准 import 本 index。
 * review-ctx/review-input 装配件按需显式导出（review-quota 的 ReviewKind 已 export *，ctx 版改名 ReviewContentKind 防冲突）。 */
export * from "./review-cache";
export * from "./review-quota";
export { chatReviewJson, updateProfileFromReview, loadProfileBlock } from "./review-input";
export { buildReviewCtx } from "./review-ctx";
export type { ReviewContentKind } from "./review-ctx";
