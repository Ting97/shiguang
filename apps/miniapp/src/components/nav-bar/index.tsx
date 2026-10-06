/**
 * 顶部胶囊导航 —— 逐像素对齐 web components/nav.tsx 移动端形态：
 * sticky 玻璃圆角顶栏 + 五项横滑 pill（动态/目标/日程/人际/财务，激活渐变底）。
 * 与 web 的差异（微信壳约束）：右上角被小程序胶囊按钮占用，
 * web 的「主题切换 + 昵称 + 登出」收编为胶囊左侧两个图标（主题 / 我的），
 * 登出入口在「我的」页（web 的 /profile 同职责）。
 * 页面切换用 redirectTo：导航行为等价 tab（栈深恒为 1，不会越叠越深）。
 */
import { ScrollView, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useMemo, useState } from "react";
import LucideIcon, { type LucideIconName } from "../lucide-icon";
import { useTheme } from "../../lib/theme";
import "./index.scss";

const ITEMS = [
  { key: "feed", label: "动态", icon: "list_todo", path: "/pages/feed/index" },
  { key: "spaces", label: "目标", icon: "trending_up", path: "/packages/space/list/index" },
  { key: "schedule", label: "日程", icon: "calendar", path: "/pages/schedule/index" },
  { key: "contacts", label: "人际", icon: "users", path: "/packages/contact/list/index" },
  { key: "finance", label: "财务", icon: "wallet", path: "/pages/finance/index" },
] as const;

export type NavKey = (typeof ITEMS)[number]["key"];

/** 登录/绑定等无导航页路由（= web NAVLESS_PATHS） */
export const NAVLESS_PATHS = ["/pages/login/index", "/pages/bind/index"];

export default function NavBar({ active }: { active?: NavKey }) {
  const { mode, cycle } = useTheme();
  const [leaving, setLeaving] = useState(false);

  const { statusBarPx, rightPadPx } = useMemo(() => {
    try {
      const win = Taro.getWindowInfo();
      const capsule = Taro.getMenuButtonBoundingClientRect();
      // 胶囊左缘之外再留 8px 间距；取不到胶囊（部分机型）退化为固定 96px
      const pad = capsule.width ? win.windowWidth - capsule.left + 8 : 96;
      return { statusBarPx: win.statusBarHeight || 20, rightPadPx: Math.max(pad, 96) };
    } catch {
      return { statusBarPx: 20, rightPadPx: 96 };
    }
  }, []);

  const go = (item: (typeof ITEMS)[number]) => {
    if (item.key === active || leaving) return;
    setLeaving(true);
    Taro.redirectTo({ url: item.path, complete: () => setLeaving(false) });
  };

  const themeIcon = mode === "dark" ? "🌙" : mode === "light" ? "☀️" : "🌓";

  return (
    <View className="nav-root" style={{ paddingTop: `${statusBarPx}px` }}>
      <View className="nav-inner" style={{ paddingRight: `${rightPadPx}px` }}>
        <ScrollView
          className="nav-scroll"
          scrollX
          enhanced
          showScrollbar={false}
          scrollIntoView={`nav-${active}`}
          scrollWithAnimation
        >
          <View className="nav-track">
            {ITEMS.map((it) => (
              <View
                key={it.key}
                id={`nav-${it.key}`}
                className={`nav-pill${active === it.key ? " nav-pill-active" : ""}`}
                hoverClass="press"
                hoverStayTime={80}
                onTap={() => go(it)}
              >
                <LucideIcon name={it.icon} size={14} color={active === it.key ? "#fff" : "var(--ink-mute)"} />
                {it.label}
              </View>
            ))}
          </View>
        </ScrollView>
        <View className="nav-actions">
          <View className="nav-icon" hoverClass="press" hoverStayTime={80} onTap={() => cycle()}>{themeIcon}</View>
          <View className="nav-icon" hoverClass="press" hoverStayTime={80} onTap={() => Taro.redirectTo({ url: "/pages/profile/index" })}>
            <LucideIcon name="user" size={15} color="var(--ink-mute)" />
          </View>
        </View>
      </View>
    </View>
  );
}
