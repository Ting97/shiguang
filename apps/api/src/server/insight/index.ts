/** insight 域对外面（REQ-004 FR-B1.2）：跨域只准 import 本 index。
 * review-ctx/review-input 为域内装配件（ReviewKind 与 review-quota 同名不同型，不进 export *）。 */
export * from "./review-cache";
export * from "./review-quota";
