/**
 * monorepo（npm workspaces）下把 RN CLI/Expo export:embed 的项目根钉在 apps/mobile，
 * 防止沿目录树上溯把仓库根当成项目根（表现为 Unable to resolve module ./index.js）。
 */
const path = require("path");

module.exports = {
  project: {
    ios: {},
    android: {
      sourceDir: path.join(__dirname, "android"),
    },
  },
  assets: [],
};
