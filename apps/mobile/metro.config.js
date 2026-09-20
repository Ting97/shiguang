/** monorepo：固定 metro 项目根为 apps/mobile，并让依赖解析同时覆盖两级 node_modules */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

/**
 * monorepo 依赖去重：npm workspaces 下 web(19.3) 与 mobile(19.0) 各持一份 react，
 * 混用会导致 "Cannot read property 'useState' of null" 首屏崩溃。
 * 这里强制 bundle 内所有 react 引用统一解析到 mobile 自带的 19.0.0（RN 0.79 官方配对版本）。
 */
const reactPkg = path.join(projectRoot, "node_modules", "react");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react") {
    return context.resolveRequest(context, reactPkg, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
