/**
 * platform 域对外面（REQ-004 FR-B1.2）。
 * http 基座 / db / security 为共享基建，调用方按深路径引用（@/server/platform/http/route 等）；
 * modules（模块授权面：MODULES/listUserModules）是平台对业务域暴露的业务面，经此 index 导出。
 */
export * from "./modules";
