/**
 * 动态 feed 页（= web app/page.tsx 移动端形态，区块组件逐一同构）：
 * hero 渐变标题「拾光」→ RemindersBanner 提醒横幅 → 消息/加载失败横幅 → ActionsToday 今日行动清单
 * → FeedSection 动态流（计数 + 搜索 + 空间过滤 chips + 按天分组时间线 + MomentCard）
 * → TodaySchedule 今日日程 → footer；右下悬浮发布钮（点按打字 / 长按说话）+ 发布底部抽屉。
 *
 * 发布链路保留旧版契约：POST /api/parse 文字落库秒回拿 entryId → 图片并行上传
 * POST /api/entries/:id/images（publish-sheet 内置单张失败重试一次）；识别数秒完成，
 * 发布后安排 6s/16s 两轮延迟刷新把 AI 产物带上墙（经 loadRef 总是以最新筛选参数取数）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Input, ScrollView } from "@tarojs/components";
import Taro, { usePullDownRefresh, useReachBottom, useShareAppMessage } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import { parseText } from "@/lib/api";
import { request } from "@/lib/request";
import { getSessionToken } from "@/lib/session";
import { loadActiveSpaces, loadFeedPage, loadToday, type Activity, type FeedMomentFull, type SpaceRow, type TodayBlock } from "./api";
import { FilterChip } from "./chip";
import MomentCard from "./moment-card";
import ActionsToday from "./actions-today";
import TodaySchedule from "./today-schedule";
import RemindersBanner from "./reminders-banner";
import CaptureButton from "./voice-button";
import PublishSheet from "./publish-sheet";
import { pickReminders, zhRecordTime, type ReminderContact, type ReminderItem, type ReminderTodo } from "./kit";
import "./index.scss";
import "./moment-card.scss";
import "./voice-button.scss";

/** 动态流每页条数，「加载更多」按页扩 limit（= web FEED_PAGE_SIZE） */
const PAGE_SIZE = 10;

type Msg = { ok: boolean; text: string } | null;

export default function Feed() {
  /* ---------- 页面消息横幅 ---------- */
  const [msg, setMsg] = useState<Msg>(null);
  // 成功提示短展示；失败/警示保留更久（= web page.tsx msg 自动消失）
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  /* ---------- 首页取数（= web use-home-data.ts 的页面局部移植） ---------- */
  const [moments, setMoments] = useState<FeedMomentFull[]>([]);
  const [feedTotal, setFeedTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState(""); // 生效中的搜索词（输入防抖后）
  const [loadingMore, setLoadingMore] = useState(false);
  // 「加载更多」页数不参与渲染，走 ref：feedLimit 若为 state 会在 loadMore 时再触发一次 effect 造成重复请求
  const feedLimitRef = useRef(PAGE_SIZE);
  // 取数竞态守卫：仅「最新一次 load」的响应可落地（连续快切空间/搜索场景旧响应会覆盖新视图）
  const seqRef = useRef(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 空间切换条：all=全部 / none=未归属 / <id>=某空间
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [blocks, setBlocks] = useState<TodayBlock[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [todayKcal, setTodayKcal] = useState(0);
  const [reminderItems, setReminderItems] = useState<ReminderItem[]>([]);

  const load = useCallback(
    async (opts?: { limit?: number; query?: string; spaceId?: string }): Promise<boolean> => {
      // opts 用于「状态尚未生效就要请求」的场景（如发布后清空搜索再刷新）
      const seq = ++seqRef.current;
      const lim = opts?.limit ?? feedLimitRef.current;
      const q = opts?.query !== undefined ? opts.query : query;
      const sp = opts?.spaceId ?? spaceFilter;
      setLoadErr(null);
      try {
        const [today, feed, reminders] = await Promise.all([
          loadToday(),
          loadFeedPage(lim, q, sp),
          // 提醒横幅：接口失败不打扰主流程（= web api("/api/reminders").catch(() => null)）
          loadRemindersSafe(),
        ]);
        if (seq !== seqRef.current) return false;
        setBlocks(today.blocks ?? []);
        setActivities(today.activities ?? []);
        setTodayKcal(today.todayKcal ?? 0);
        setMoments(feed.moments ?? []);
        setFeedTotal(feed.total ?? 0);
        setReminderItems(reminders ? pickReminders(reminders.contacts ?? [], reminders.todos ?? []) : []);
        return true;
      } catch (e: any) {
        if (seq !== seqRef.current) return false;
        // 失败不停在静默空态：置 loadErr（页面展示错误 + 重试按钮）
        setLoadErr(e?.message ?? String(e));
        return false;
      } finally {
        if (seq === seqRef.current) setLoadingMore(false);
      }
    },
    [query, spaceFilter],
  );

  const loadVoid = useCallback(async () => {
    await load();
  }, [load]);

  // 最新 load 的 ref：发布后的延迟刷新定时器只负责触发，总是以最新筛选/搜索参数取数
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // 搜索词输入防抖：停顿 400ms 才真正检索（= web；query 变化由上面的取数 effect 接力）
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // 空间切换条数据（active 空间；失败静默——切换条隐藏，feed 照常）
  useEffect(() => {
    loadActiveSpaces()
      .then((j) => setSpaces((j.spaces ?? []).filter((s) => s.status === "active")))
      .catch(() => setSpaces([]));
  }, []);

  // 首次加载 + query/spaceFilter 变化 → 自动拉取一次（= web useEffect(() => { load() }, [load])）；
  // 未登录（无 token）时跳过，由 request 层 401 统一跳登录
  useEffect(() => {
    if (!getSessionToken()) return;
    feedLimitRef.current = PAGE_SIZE;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, spaceFilter]);

  /** 「加载更多」：显式再拉一页；try/finally 保证失败时加载态必复位 */
  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    feedLimitRef.current += PAGE_SIZE;
    try {
      const ok = await load();
      if (!ok) setMsg({ ok: false, text: "加载更多失败，请稍后重试" });
    } finally {
      setLoadingMore(false);
    }
  }
  useReachBottom(() => {
    if (feedTotal > moments.length) void loadMore();
  });

  usePullDownRefresh(() => {
    feedLimitRef.current = PAGE_SIZE;
    load().finally(() => Taro.stopPullDownRefresh());
  });

  /** 发布时清空搜索再刷新：只置状态，由 effect 自动拉取（= web resetSearch，避免同参数连发两批） */
  async function resetSearch() {
    setSearchInput("");
    setQuery("");
  }

  function changeSpace(id: string) {
    setSpaceFilter(id);
  }

  // 卸载时清掉发布后的延迟刷新定时器（避免对已卸载页面 setState）
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      refreshTimers.current.forEach(clearTimeout);
      refreshTimers.current = [];
    },
    [],
  );

  /* ---------- 发布（= web page.tsx publish：文字秒存上墙，识别后台进行） ---------- */
  const [busy, setBusy] = useState(false);
  // 移动端发布：sheetOpen 控制底部输入面板；voiceDraft 是长按语音转写出的待预览文字
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");

  async function publish(raw: string): Promise<string | null> {
    const t = raw.trim();
    if (!t || busy) return null;
    setBusy(true);
    try {
      const j = await parseText(t);
      // 防御非约定响应（结构变更）：给出可读原因，而不是 TypeError
      if (!j?.entry) throw new Error("服务异常，请稍后重试");
      setMsg({ ok: true, text: "✨ 已记录动态，AI 正在识别日程 / 关系 / todo / 收支 / 心情 / 饮食…" });
      // 新动态要立即可见：搜索过滤中则清空搜索再刷新
      if (query || searchInput) await resetSearch();
      else await load();
      // 识别通常数秒完成：两轮延迟刷新把识别产物带上墙（经 loadRef 取最新参数）
      refreshTimers.current.forEach(clearTimeout);
      refreshTimers.current = [
        setTimeout(() => void loadRef.current(), 6000),
        setTimeout(() => void loadRef.current(), 16000),
      ];
      return j.entry.id as string;
    } catch (e: any) {
      setMsg({ ok: false, text: `记录失败：${e?.message ?? e}` });
      return null;
    } finally {
      setBusy(false);
    }
  }

  // 分享卡片（小程序独有增量）：带来源标记，好友点开落登录页
  useShareAppMessage(() => ({ title: "拾光 —— 钱 · 时间 · 人，一句话记录生活", path: "/pages/login/index" }));

  /* ---------- 动态流按天分组（= web MomentFeed groups useMemo） ---------- */
  const groups = (() => {
    const map = new Map<string, FeedMomentFull[]>();
    for (const m of moments) {
      const key = zhRecordTime(m.created_at).day;
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    }
    return [...map.entries()];
  })();

  const moreCount = Math.max(0, feedTotal - moments.length);

  return (
    <PageShell active="feed">
      {/* = web header：hero 渐变标题 + 副标题（渐变类挂在 Text 上：weapp 里 background-clip:text 只作用于自身文本盒） */}
      <View className="feed-head">
        <Text className="hero text-gradient feed-hero">
          {"拾光"}
          <Text className="feed-hero-sub">动态</Text>
        </Text>
        <Text className="feed-subtitle">随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来 todo</Text>
      </View>

      {/* W12 提醒横幅：生日/纪念日/到期 todo（可一键加入今日） */}
      <RemindersBanner items={reminderItems} notify={setMsg} load={loadVoid} />

      {/* 消息横幅（发布/加入今日/语音提示等，= web msg-banner） */}
      {msg ? <View className={`msg-banner feed-banner ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</View> : null}

      {/* 取数失败态：给出重试入口，避免失败后整页静默空态（= web loadErr 卡） */}
      {loadErr ? (
        <View className="glass glass-p4 feed-retry">
          <Text className="feed-retry-text">加载失败：{loadErr}</Text>
          <View className="btn-primary feed-retry-btn" hoverClass="press" hoverStayTime={80} onTap={() => void load()}>
            <Text className="feed-retry-btn-text">重试</Text>
          </View>
        </View>
      ) : null}

      {/* 今日行动清单：只展示行动级条目，完整管理在「日程 · todo」 */}
      <ActionsToday notify={setMsg} />

      {/* = web FeedSection：计数 + 搜索框 + 空间过滤 chips + MomentFeed */}
      <View className="fs">
        <View className="fs-head">
          <Text className="fs-title">
            🌱 我的动态{" "}
            <Text className="fs-count">
              {query
                ? `找到 ${feedTotal} 条`
                : feedTotal > 0
                  ? `共 ${feedTotal} 条${feedTotal > moments.length ? ` · 已显示 ${moments.length} 条` : " · 点内容可修正识别"}`
                  : ""}
            </Text>
          </Text>
          <View className="fs-search">
            <Input
              className="fs-search-input"
              value={searchInput}
              placeholder="🔍 搜索：原文/日程/todo/金额/联系人"
              placeholderClass="input-placeholder"
              confirmType="search"
              onInput={(e) => setSearchInput(e.detail.value)}
            />
            {searchInput ? (
              <Text className="fs-search-clear" onClick={() => setSearchInput("")}>
                ✕
              </Text>
            ) : null}
          </View>
        </View>

        {/* 空间切换条：全部 / 未归属 / 各 active 空间（有归属数据才显示），横滑 */}
        {spaces.length > 0 || moments.some((m) => m.space) ? (
          <ScrollView className="fs-chips" scrollX enhanced showScrollbar={false}>
            <View className="fs-chips-track">
              <FilterChip label="全部" active={spaceFilter === "all"} onTap={() => changeSpace("all")} />
              <FilterChip label="未归属" active={spaceFilter === "none"} onTap={() => changeSpace("none")} />
              {spaces.map((s) => (
                <FilterChip key={s.id} label={s.name} icon={s.icon} active={spaceFilter === s.id} onTap={() => changeSpace(s.id)} />
              ))}
            </View>
          </ScrollView>
        ) : null}

        {/* = web MomentFeed：按天分组（今天/昨天/历史），组内时间线节点 + 记录时刻贴合卡片 */}
        {moments.length === 0 ? (
          <View className="empty-state">
            <Text>
              {query ? `没有找到包含「${query}」的动态 —— 换个关键词，或点 ✕ 清除搜索` : "还没有动态 —— 随口说一句今天的事、心情或明天的计划试试"}
            </Text>
          </View>
        ) : (
          <View className="mf">
            {groups.map(([day, items]) => (
              <View key={day} className="mf-day">
                {/* 吸顶日期头（= web sticky top-14 渐变底；个别基础库不支持 sticky 时静默退化static） */}
                <Text className="mf-day-head">— {day} —</Text>
                <View className="mf-items">
                  {items.map((m, idx) => {
                    const t = zhRecordTime(m.created_at);
                    const isLast = idx === items.length - 1;
                    return (
                      <View key={m.id} className="mf-item">
                        {/* 连接线：从本节点延伸到下一个节点（末条不画，避免悬空） */}
                        {!isLast ? <View className="mf-line" /> : null}
                        <View className="mf-dot" />
                        {/* 记录时刻：移动端窄屏置于卡片上方（= web sm:hidden 时刻行） */}
                        <Text className="mf-clock">{t.clock}</Text>
                        <View className="mf-card">
                          <MomentCard m={m} activities={activities} onRefresh={loadVoid} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}

            {/* 分页：触底自动加载（useReachBottom）+ 手动按钮兜底（= web 加载更多按钮） */}
            {moreCount > 0 ? (
              <View className={`mf-more${loadingMore ? " disabled" : ""}`} hoverClass="press" hoverStayTime={80} onClick={() => void loadMore()}>
                <Text>{loadingMore ? "加载中…" : `加载更多（还有 ${moreCount} 条）`}</Text>
              </View>
            ) : (
              moments.length >= PAGE_SIZE ? <Text className="mf-end">— 已经到底啦 —</Text> : null
            )}
          </View>
        )}
      </View>

      {/* 今日日程：时间轴 / 列表 双视图 */}
      <TodaySchedule blocks={blocks} activities={activities} todayKcal={todayKcal} notify={setMsg} load={loadVoid} />

      {/* = web footer */}
      <Text className="feed-footer">拾光 · 第一阶段开发中 · 源码仓库 github.com/Ting97/shiguang</Text>

      {/* 移动端发布入口：底部悬浮圆圈（点按打字 / 长按说话，转写后回填面板预览） */}
      <CaptureButton
        onTap={() => {
          setVoiceDraft("");
          setSheetOpen(true);
        }}
        onVoiceText={(t) => {
          setVoiceDraft(t);
          setSheetOpen(true);
        }}
        onError={(m) => setMsg({ ok: false, text: m })}
        onHint={(m) => setMsg({ ok: true, text: m })}
      />
      <PublishSheet
        open={sheetOpen}
        initialText={voiceDraft}
        busy={busy}
        onPublish={publish}
        onClose={() => setSheetOpen(false)}
        notify={setMsg}
      />
    </PageShell>
  );
}

/** GET /api/reminders 的安全封装：失败返回 null（横幅静默消失，不打扰主流程） */
async function loadRemindersSafe(): Promise<{ contacts: ReminderContact[]; todos: ReminderTodo[] } | null> {
  try {
    return await request<{ contacts: ReminderContact[]; todos: ReminderTodo[] }>("/api/reminders");
  } catch {
    return null;
  }
}
