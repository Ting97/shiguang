/**
 * 底部标签栏（REQ-导航下移缩小）：6 项图标+小字（动态/目标/日程/人际/财务/我的），
 * fixed 吸底 + 安全区。主题切换挪到「我的」页（此栏只做页面导航）。
 * 页面切换用 redirectTo：等价 tab（栈深恒为 1，不会越叠越深）。
 */
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";
import LucideIcon from "../lucide-icon";
import "./index.scss";

const ITEMS = [
  { key: "feed", label: "动态", icon: "home", path: "/pages/feed/index" },
  { key: "spaces", label: "目标", icon: "target", path: "/packages/space/list/index" },
  { key: "schedule", label: "日程", icon: "calendar_days", path: "/pages/schedule/index" },
  { key: "contacts", label: "人际", icon: "users", path: "/packages/contact/list/index" },
  { key: "finance", label: "财务", icon: "wallet", path: "/pages/finance/index" },
  { key: "profile", label: "我的", icon: "user", path: "/pages/profile/index" },
] as const;

export type NavKey = (typeof ITEMS)[number]["key"];

/** 登录/绑定等无导航页路由（= web NAVLESS_PATHS） */
export const NAVLESS_PATHS = ["/pages/login/index", "/pages/bind/index"];

export default function NavBar({ active }: { active?: NavKey }) {
  const [leaving, setLeaving] = useState(false);

  const go = (item: (typeof ITEMS)[number]) => {
    if (item.key === active || leaving) return;
    setLeaving(true);
    Taro.redirectTo({ url: item.path, complete: () => setLeaving(false) });
  };

  return (
    <View className="tabbar-root">
      <View className="tabbar-track">
        {ITEMS.map((it) => {
          const on = active === it.key;
          return (
            <View
              key={it.key}
              className={`tab-item${on ? " tab-item-active" : ""}`}
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => go(it)}
            >
              <LucideIcon name={it.icon} size={22} color={on ? "var(--accent)" : "var(--ink-mute)"} />
              <Text className="tab-label">{it.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
