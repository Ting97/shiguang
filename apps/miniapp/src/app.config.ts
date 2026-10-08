export default defineAppConfig({
  pages: [
    "pages/feed/index",
    "pages/schedule/index",
    "pages/finance/index",
    "pages/profile/index",
    "pages/login/index",
    "pages/bind/index",
    "pages/agreement/index",
    "pages/manual/index",
  ],
  subPackages: [
    { root: "packages/space", pages: ["list/index", "detail/index"] },
    { root: "packages/contact", pages: ["list/index", "detail/index"] },
    // 四个单页分包的注册路径必须与源码目录一致（index/index）：曾注册为 "index"，
    // Taro 在分包根产出的 index.wxml 为 0 字节且缺 index.json → 页面加载即抛错无法打开
    { root: "packages/debt", pages: ["index/index"] },
    { root: "packages/review", pages: ["index/index"] },
    { root: "packages/trading", pages: ["index/index"] },
    { root: "packages/calendar", pages: ["index/index"] },
  ],
  // 微信系统深浅色跟随（REQ-009 9-A）：theme.json 由 design-tokens 生成，值随主题切换
  darkmode: true,
  themeLocation: "theme.json",
  // 录音授权用途声明（REQ-009 9-C 提审配置）：语音一句话记录（长按悬浮钮说话）；
  // 无位置等其它敏感接口，不加多余 permission。授权被拒的恢复引导在 voice-button/publish-sheet（openSetting）。
  permission: {
    "scope.record": {
      desc: "用于语音一句话记录",
    },
  },
  window: {
    // 顶栏（含导航/标题）全部自绘：对齐 web 移动端顶部胶囊导航（components/nav.tsx）
    navigationStyle: "custom",
    navigationBarBackgroundColor: "#020617",
    navigationBarTextStyle: "white",
    navigationBarTitleText: "拾光",
    backgroundColor: "@bgColor",
    backgroundTextStyle: "@bgTxtStyle",
  },
});
