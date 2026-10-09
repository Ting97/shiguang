/**
 * 日程页（= web app/schedule/page.tsx）：hero + 副导航三 tab（📅日历 / todo / 🏷️分类）。
 * tab 用页面内 state 切换；首次激活才挂载（避免首屏三份请求），挂过后保留状态不重挂——
 * 用 display 控制显隐而非条件卸载（= web hidden class 的 keep-alive 语义）。
 * ?tab=todo|categories、?date=YYYY-MM-DD 直达子页（= web URL 参数，动态流冲突提示跳转用）。
 */
import { useEffect, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import LucideIcon, { type LucideIconName } from "@/components/lucide-icon";
import { getSessionToken } from "@/lib/session";
import CalendarPanel from "./calendar-panel";
import TodoBoard from "./todo-board";
import ActivityPanel from "./activity-panel";
import "./index.scss";
import GuestGate from "@/components/guest-gate";

type Tab = "calendar" | "todo" | "categories";
/** tab 图标 = lucide 对应（🏷️ 分类缺 tag 图标，就近用 clipboard_list） */
const TABS: [Tab, string, LucideIconName | null][] = [
  ["calendar", "日历", "calendar_days"],
  ["todo", "todo", null], // todo 用 CSS 圆环 logo（= web TodoLogo），不配图标
  ["categories", "分类", "clipboard_list"],
];

export default function Schedule() {
  const router = Taro.useRouter();
  const [tab, setTab] = useState<Tab>(() => (router.params.tab === "todo" || router.params.tab === "categories" ? router.params.tab : "calendar"));
  // 首次激活才挂载；挂过后 display 切换保状态（日历锚点/TODO 视图不被切换重置）
  const [mounted, setMounted] = useState<Record<Tab, boolean>>({ calendar: true, todo: false, categories: false });
  // ?date=YYYY-MM-DD 直达某天；非法值回落今天（由 CalendarPanel 一次性采纳）
  const [initialDate, setInitialDate] = useState<string | undefined>(() =>
    router.params.date && /^\d{4}-\d{2}-\d{2}$/.test(router.params.date) ? router.params.date : undefined,
  );
  // 下拉刷新广播：三个面板常驻挂载，各自按 tick 重拉当前视图
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setMounted((m) => (m[tab] ? m : { ...m, [tab]: true }));
  }, [tab]);

  usePullDownRefresh(() => {
    setRefreshTick((n) => n + 1);
    Taro.stopPullDownRefresh();
  });

  // 未登录不拉数据（面板内部请求会 401 跳登录，这里直接不渲染避免首屏报错）
  if (!getSessionToken()) {
    return (
      <PageShell active="schedule">
        <View className="hero-wrap">
          <View className="hero-line">
            <Text className="hero text-gradient">
              拾光
              <Text className="hero-badge">日程</Text>
            </Text>
          </View>
          <Text className="hero-sub">时间去了哪、todo 推进如何 —— 日历 · 看板 · 分类</Text>
          <GuestGate title="日程" desc="时间去了哪、todo 推进如何 —— 日历 · 看板 · 分类" />
        </View>
      </PageShell>
    );
  }

  return (
    <PageShell active="schedule">
      {/* 模块抬头：与动态/财务统一的居中 hero；子页切换居中悬挂在副标题下（= web SubNav） */}
      <View className="hero-wrap">
        <View className="hero-line">
          <Text className="hero text-gradient">
            拾光
            <Text className="hero-badge">日程</Text>
          </Text>
        </View>
        <Text className="hero-sub">时间去了哪、todo 推进如何 —— 日历 · 看板 · 分类</Text>
        {/* = web SubNav：pill-nav 容器 + pill（激活渐变底）；todo tab 用 CSS 圆环替代 TodoLogo SVG */}
        <View className="pill-nav sched-nav">
          {TABS.map(([v, label, icon]) => (
            <View
              key={v}
              className={`pill sched-pill ${tab === v ? "pill-active" : ""}`}
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => setTab(v)}
            >
              {v === "todo" ? (
                <View className={`todo-logo ${tab === v ? "on" : ""}`} />
              ) : icon ? (
                <LucideIcon name={icon} size={13} color={tab === v ? "#fff" : "var(--ink-mute)"} />
              ) : null}
              <Text>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* keep-alive 三面板：挂载过就保留，display 控制显隐 */}
      {mounted.calendar && (
        <View style={{ display: tab === "calendar" ? "" : "none" }}>
          <CalendarPanel initialAnchor={initialDate} refreshTick={refreshTick} />
        </View>
      )}
      {mounted.todo && (
        <View style={{ display: tab === "todo" ? "" : "none" }}>
          <TodoBoard refreshTick={refreshTick} />
        </View>
      )}
      {mounted.categories && (
        <View style={{ display: tab === "categories" ? "" : "none" }}>
          <ActivityPanel refreshTick={refreshTick} />
        </View>
      )}
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="calendar_days" label="日程" />
    </PageShell>
  );
}
