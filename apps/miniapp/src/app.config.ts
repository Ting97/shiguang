export default defineAppConfig({
  pages: [
    "pages/feed/index",
    "pages/schedule/index",
    "pages/finance/index",
    "pages/profile/index",
    "pages/login/index",
    "pages/bind/index",
  ],
  subPackages: [
    { root: "packages/space", pages: ["list/index", "detail/index"] },
    { root: "packages/contact", pages: ["list/index", "detail/index"] },
    { root: "packages/debt", pages: ["index"] },
    { root: "packages/review", pages: ["index"] },
    { root: "packages/trading", pages: ["index"] },
    { root: "packages/calendar", pages: ["index"] },
  ],
  // 微信系统深浅色跟随（REQ-009 9-A）：theme.json 由 design-tokens 生成，值随主题切换
  darkmode: true,
  themeLocation: "theme.json",
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
