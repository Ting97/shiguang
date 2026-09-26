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
  window: {
    navigationBarBackgroundColor: "#0b1220",
    navigationBarTextStyle: "white",
    navigationBarTitleText: "拾光",
    backgroundColor: "#020617",
    backgroundTextStyle: "dark",
  },
  tabBar: {
    color: "#64748b",
    selectedColor: "#38bdf8",
    backgroundColor: "#0b1220",
    borderStyle: "black",
    list: [
      { pagePath: "pages/feed/index", text: "动态" },
      { pagePath: "pages/schedule/index", text: "日程" },
      { pagePath: "pages/finance/index", text: "财务" },
      { pagePath: "pages/profile/index", text: "我的" },
    ],
  },
});
