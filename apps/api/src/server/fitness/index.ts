/** fitness 域对外面（REQ-004 FR-B1.2 同款约定）：跨域只准 import 本 index */
export * from "./service";
export { readTrains, makeLocalResolver, XUNJI_NAME_ALIAS } from "./xunji";
export { getXunjiKey } from "./xunji-keys";
