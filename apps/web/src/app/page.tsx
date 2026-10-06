"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import ActionsToday from "@/components/actions-today";
import { useDesktopPublisher } from "./home/use-desktop-publisher";
import type { Notify } from "./home/types";
import DesktopComposer from "./home/desktop-composer";
import CaptureButton from "@/components/capture-button";
import PublishSheet from "@/components/publish-sheet";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { bjToday } from "@/lib/date";
import { ListTodo } from "lucide-react";
import { Dismissable } from "@/components/dismissable";
import FeedSection from "./home/feed-section";
import RemindersBanner from "./home/reminders-banner";
import TodaySchedule from "./home/today-schedule";
import { useHomeData } from "./home/use-home-data";

/**
 * 动态首页入口：状态与发布编排留在本文件，
 * 各区块 UI 与取数/随图上传逻辑拆至 ./home/（行为与视觉与拆分前一致）。
 */
export default function Home() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 发布后识别产物的延迟刷新定时器（卸载时清理，避免对已卸载组件 setState）
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 移动端发布：sheetOpen 控制底部输入面板；voiceDraft 是长按语音转写出的待预览文字
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");

  // 首页操作反馈统一走全局 toast（自动消失）；尚未迁移的下游仍以消息对象上报，经下面两个包装转发
  const notifyLoadErr = useCallback((t: string) => toast(t, "err"), []);
  const forwardMsg = useCallback((m: { ok: boolean; text: string } | null) => {
    if (m) toast(m.text, m.ok ? "ok" : "err");
  }, []);

  const {
    moments,
    feedTotal,
    loadingMore,
    loadErr,
    query,
    searchInput,
    setSearchInput,
    spaceFilter,
    spaces,
    blocks,
    activities,
    todayKcal,
    reminderItems,
    load,
    loadMore,
    resetSearch,
    changeSpace,
    historyBefore,
  } = useHomeData({ notify: notifyLoadErr });
  // 消费组件的 load 形参是 () => Promise<void>：包一层丢弃 load 的成功与否返回值
  const loadVoid = useCallback(async () => {
    await load();
  }, [load]);
  // 最新 load 的 ref：发布后的延迟刷新定时器只负责触发，总是以最新筛选/搜索参数取数——
  // 否则定时器持有过期闭包，用户切换空间后会用旧 spaceId 拉取并覆盖当前视图
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // 历史回看横幅锚点：跳转后滚动定位用
  const historyBannerRef = useRef<HTMLDivElement | null>(null);
  // 动态流顶部锚点：发布后视口定位（scroll-mt 预留吸顶导航高度）
  const feedTopRef = useRef<HTMLDivElement | null>(null);

  // 日期跳转锚点（YYYY-MM-DD）：null=最新模式。选择某天 → feed 以该天次日北京零点为 before
  // 锚刷新，首条即那天的最后一条；往前加载更多=更早，横幅提供相邻日切换
  const [anchorDate, setAnchorDate] = useState<string | null>(null);

  // 跳转后横幅闪烁强调（含相邻日切换），3s 后停止
  const [bannerFlash, setBannerFlash] = useState(false);

  // 桌面端：今日行动收纳为右上角触发钮 + 弹出面板（lg 断点与布局类一致）
  const [isDesktop, setIsDesktop] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setIsDesktop(mq.matches);
      if (!mq.matches) setActionsOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const jumpToDate = useCallback((date: string | null) => {
    setAnchorDate(date);
    if (!date) {
      void loadRef.current({ before: null });
      return;
    }
    setBannerFlash(true);
    const [y, m, d] = date.split("-").map(Number);
    // 次日北京零点 = 该天全天的上界（UTC 前一日 16:00）
    const before = new Date(Date.UTC(y, m - 1, d + 1, -8)).toISOString();
    void loadRef.current({ before }).then(() => {
      setTimeout(() => {
        // scroll-mt-24 已在横幅上：sticky 导航不会盖住 block:start 的定位结果
        historyBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => setBannerFlash(false), 3200);
      }, 80);
    });
  }, []);

  // 搜索/空间筛选会重置 before（use-home-data 内同名 effect）：锚点日期同步清空，避免 input 显示过期锚点
  useEffect(() => {
    setAnchorDate(null);
  }, [query, spaceFilter]);
  // use-desktop-publisher 的形参是旧 Notify（setState 签名）：只可能收到消息对象值，函数式更新视为无操作
  const notifyDispatch = useCallback<Notify>((m) => {
    if (typeof m === "function") return;
    if (m) toast(m.text, m.ok ? "ok" : "err");
  }, []);
  const {
    desktopImages,
    fileInputRef,
    addDesktopImages,
    removeDesktopImage,
    retryDesktopUpload,
    uploadAfterPublish,
  } = useDesktopPublisher({ setMsg: notifyDispatch, load: loadVoid });

  useEffect(() => {
    const timers = refreshTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  async function submit() {
    const files = desktopImages.filter((i) => i.status !== "error").map((i) => i.file);
    const entryId = await publish(text);
    if (!entryId) return;
    await uploadAfterPublish(entryId, files);
  }

  /** 发布一条动态（文字秒存上墙），返回 entry id；图片上传由调用方拿到 id 后自行并行处理（可重试） */
  async function publish(raw: string): Promise<string | null> {
    const t = raw.trim();
    if (!t || busy) return null;
    setBusy(true);
    try {
      const j = await api<any>("/api/parse", "POST", { text: t });
      // 防御非约定响应（结构变更）：给出可读原因，而不是 TypeError
      if (!j?.entry) throw new Error("服务异常，请稍后重试");
      // 动态已秒存上墙；五域识别在后台进行，完成后由延迟刷新呈现
      toast("✨ 已记录动态，AI 正在识别日程 / 关系 / todo / 收支 / 心情 / 饮食…");
      setText("");
      // 新动态要立即可见：历史回看中发布的新动态晚于锚点会不可见 → 发布即回到「今天」；
      // 搜索过滤中则清空搜索再刷新（搜索词可能不匹配新动态）
      if (anchorDate) {
        setAnchorDate(null);
        if (query || searchInput) await resetSearch();
        else await loadRef.current({ before: null });
      } else if (query || searchInput) {
        await resetSearch();
      } else {
        await load();
      }
      // 视口定位仅移动端：发布面板从底部弹出，刚发的动态（列表首位）可能不在视口内；
      // PC 发布框在顶部、新动态就在下方，自动滚动反而把视口从输入框拽走（2026-10-04 反馈）
      if (window.innerWidth < 640) {
        setTimeout(() => feedTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
      // 识别通常数秒完成：安排两轮延迟刷新把识别产物带上墙（经 loadRef 取最新参数；卸载时清理）。
      // 同时派发识别完成事件：今日行动等自取数区块（不走 use-home-data）联动刷新，
      // 否则识别出的 todo 要手动刷新页面才出现（2026-10-04 用户反馈）
      for (const delay of [6000, 16000]) {
        const t2 = setTimeout(() => {
          void loadRef.current();
          window.dispatchEvent(new CustomEvent("shiguang:entry-analyzed"));
        }, delay);
        refreshTimers.current.push(t2);
      }
      return j.entry.id as string;
    } catch (e) {
      toast(`记录失败：${e instanceof Error ? e.message : e}`, "err");
      return null;
    } finally {
      setBusy(false);
      // 桌面回焦输入框便于连发；移动端不回焦（重新拉起键盘打断阅读）
      if (window.innerWidth >= 640) inputRef.current?.focus();
    }
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 pb-28 pt-5 sm:pb-8 sm:pt-8">
        <header className="mb-5 text-center sm:mb-7">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光
            <span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">动态</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">
            随口一句 → AI 自动识别：此刻心情 · 过往日程 · 未来 todo
          </p>
        </header>

        {/* W12 提醒横幅：生日/纪念日/到期 todo（可一键加入今日） */}
        <RemindersBanner items={reminderItems} load={loadVoid} />

        {/* 取数失败态：给出重试入口，避免失败后整页静默空态（对齐 spaces 页范式） */}
        {/* 输入区（桌面端；移动端改用底部悬浮圆圈：点按打字 / 长按说话） */}
        <DesktopComposer
          text={text}
          setText={setText}
          inputRef={inputRef}
          busy={busy}
          onSubmit={submit}
          images={desktopImages}
          fileInputRef={fileInputRef}
          onAddImages={addDesktopImages}
          onRemoveImage={removeDesktopImage}
          onRetryUpload={retryDesktopUpload}
        />

        {loadErr && (
          <div className="glass mb-5 rounded-2xl p-6 text-center">
            <p className="text-sm text-danger">加载失败：{loadErr}</p>
            <button onClick={() => void load()} className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs font-medium">
              重试
            </button>
          </div>
        )}

        {/* 今日行动清单：只展示行动级条目（每日重复 ∪ 父 todo 今日/今日到期），完整管理在「日程 · todo」 */}
        {/* 今日行动：移动端顶部内联；桌面端收纳为右上角触发钮 + 弹出面板（见下方） */}
        <div className="lg:hidden">
          <ActionsToday notify={forwardMsg} />
        </div>

        {/* 动态流顶部锚点：发布后视口定位到这（新动态即列表首位） */}
        <div ref={feedTopRef} className="scroll-mt-24" aria-hidden />

        {/* 历史回看横幅：相邻日切换 + 回到最新（前一天无界；后一天越过今天即等于回到最新） */}
        {historyBefore && anchorDate && (
          <div
            ref={historyBannerRef}
            className={`fade-up mb-2 flex scroll-mt-24 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-micro text-accent ${bannerFlash ? "banner-flash" : ""}`}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => jumpToDate(shiftYmd(anchorDate, -1))}
                className="btn-ghost press flex items-center gap-0.5 rounded-lg px-2 py-1"
                title="前一天"
              >
                <ArrowLeft size={11} aria-hidden /> 前一天
              </button>
              <span className="tabular-nums font-medium">{zhYmd(anchorDate)}</span>
              <button
                type="button"
                onClick={() => jumpToDate(shiftYmd(anchorDate, +1) > bjToday() ? null : shiftYmd(anchorDate, +1))}
                className="btn-ghost press flex items-center gap-0.5 rounded-lg px-2 py-1"
                title="后一天（越过今天回到最新）"
              >
                后一天 <ArrowRight size={11} aria-hidden />
              </button>
            </div>
            <span className="min-w-0 truncate text-ink-mute">列表从这天的最后一条往前展示；搜索/筛选会回到最新</span>
            <button
              type="button"
              onClick={() => jumpToDate(null)}
              className="btn-ghost press flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 font-medium"
            >
              <RotateCcw size={11} aria-hidden /> 回到最新
            </button>
          </div>
        )}

        {/* 动态流：每条记录都是一条动态（记录时刻 + AI 识别结果，均可修改/删除） */}
        <FeedSection
          moments={moments}
          activities={activities}
          feedTotal={feedTotal}
          query={query}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          spaces={spaces}
          spaceFilter={spaceFilter}
          onSpaceChange={changeSpace}
          loadingMore={loadingMore}
          onLoadMore={loadMore}
          onRefresh={loadVoid}
          anchorDate={anchorDate}
          onJumpDate={jumpToDate}
        />

        {/* 今日日程：时间轴 / 列表 双视图 */}
        <TodaySchedule blocks={blocks} activities={activities} todayKcal={todayKcal} load={loadVoid} />

        <footer className="mt-10 text-center text-badge text-ink-faint">
          拾光 · 钱·时间·人 · 源码仓库 github.com/Ting97/shiguang
        </footer>
      </div>

      {/* 发布入口（全端统一移动式交互）：底部悬浮圆圈，点按打字 / 长按说话（转写后回填面板预览） */}
      <CaptureButton
        onTap={() => {
          setVoiceDraft("");
          setSheetOpen(true);
        }}
        onVoiceText={(t) => {
          setVoiceDraft(t);
          setSheetOpen(true);
        }}
        onError={(m) => toast(m, "err")}
        onHint={(m) => toast(m)}
      />
      <PublishSheet
        open={sheetOpen}
        initialText={voiceDraft}
        busy={busy}
        onPublish={publish}
        onClose={() => setSheetOpen(false)}
        notify={forwardMsg}
      />

      {/* 桌面：右上角今日行动触发钮 + 弹出面板（点击展开/收起；点空白/Esc 关闭） */}
      {isDesktop && (
        <button
          data-popover-trigger
          onClick={() => setActionsOpen((v) => !v)}
          className="fixed right-5 top-[4.25rem] z-40 flex items-center gap-1.5 rounded-full border border-line-soft bg-surface/90 px-3.5 py-2 text-xs font-medium text-ink-soft shadow-lg shadow-scrim/40 backdrop-blur transition hover:border-sky-500/50 hover:text-accent"
          aria-expanded={actionsOpen}
        >
          <ListTodo size={15} aria-hidden /> 今日行动
        </button>
      )}
      {isDesktop && actionsOpen && (
        <div className="fixed right-5 top-[7.25rem] z-40 max-h-[72dvh] w-80 overflow-y-auto">
          <Dismissable onClose={() => setActionsOpen(false)} className="rounded-2xl">
            <ActionsToday notify={forwardMsg} />
          </Dismissable>
        </div>
      )}
    </main>
  );
}

/** Y-M-D 平移 n 天（UTC 日历算术，与时区无关） */
function shiftYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Y-M-D → 中文展示 */
function zhYmd(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}月${d}日`;
}
