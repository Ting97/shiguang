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
 * monorepo 依赖去重：强制 bundle 内所有 react 引用统一解析到同一份 react
 * （RN 0.79 配对 react 19.0.0；混用两份 react 会报 "Cannot read property 'useState' of null" 首屏崩溃）。
 * npm 将 19.0.0 提升到根 node_modules 时用根副本，否则用 mobile 自带的。
 */
const fs = require("fs");
const mobileReact = path.join(projectRoot, "node_modules", "react");
const rootReact = path.join(workspaceRoot, "node_modules", "react");
const reactPkg = fs.existsSync(path.join(mobileReact, "package.json")) ? mobileReact : rootReact;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react") {
    return context.resolveRequest(context, reactPkg, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
