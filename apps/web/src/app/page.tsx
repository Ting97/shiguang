"use client";

import { useEffect, useRef, useState } from "react";
import ActionsToday from "@/components/actions-today";
import CaptureButton from "@/components/capture-button";
import PublishSheet from "@/components/publish-sheet";
import { api } from "@/shared/api";
import DesktopComposer from "./home/desktop-composer";
import FeedSection from "./home/feed-section";
import RemindersBanner from "./home/reminders-banner";
import TodaySchedule from "./home/today-schedule";
import type { Msg } from "./home/types";
import { useDesktopPublisher } from "./home/use-desktop-publisher";
import { useHomeData } from "./home/use-home-data";

/**
 * 动态首页入口：状态与发布编排留在本文件，
 * 各区块 UI 与取数/随图上传逻辑拆至 ./home/（行为与视觉与拆分前一致）。
 */
export default function Home() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 发布后识别产物的延迟刷新定时器（卸载时清理，避免对已卸载组件 setState）
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 移动端发布：sheetOpen 控制底部输入面板；voiceDraft 是长按语音转写出的待预览文字
  const [sheetOpen, setSheetOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState("");

  const {
    moments,
    feedTotal,
    loadingMore,
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
  } = useHomeData();
  const {
    desktopImages,
    fileInputRef,
    addDesktopImages,
    removeDesktopImage,
    retryDesktopUpload,
    uploadAfterPublish,
  } = useDesktopPublisher({ setMsg, load });

  useEffect(() => {
    const timers = refreshTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!msg) return;
    // 成功提示短展示；失败/警示保留更久，避免用户错过原因
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

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
      setMsg({ ok: true, text: "✨ 已记录动态，AI 正在识别日程 / 关系 / todo / 收支 / 心情 / 饮食…" });
      setText("");
      // 新动态要立即可见：搜索过滤中则清空搜索再刷新
      if (query || searchInput) {
        await resetSearch();
      } else {
        await load();
      }
      // 识别通常数秒完成：安排两轮延迟刷新把识别产物带上墙（组件卸载时清理）
      for (const delay of [6000, 16000]) {
        const t2 = setTimeout(() => void load(), delay);
        refreshTimers.current.push(t2);
      }
      return j.entry.id as string;
    } catch (e) {
      setMsg({ ok: false, text: `记录失败：${e instanceof Error ? e.message : e}` });
      return null;
    } finally {
      setBusy(false);
      // 移动端不回焦输入框（会把视口拽回顶部并重新拉起键盘，打断阅读动态流）
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
        <RemindersBanner items={reminderItems} setMsg={setMsg} load={load} />

        {/* 输入区（桌面端；移动端改用底部悬浮圆圈：点按打字 / 长按说话） */}
        <DesktopComposer
          text={text}
          setText={setText}
          inputRef={inputRef}
          busy={busy}
          onSubmit={submit}
          setMsg={setMsg}
          images={desktopImages}
          fileInputRef={fileInputRef}
          onAddImages={addDesktopImages}
          onRemoveImage={removeDesktopImage}
          onRetryUpload={retryDesktopUpload}
        />
        {msg && (
          <div className={`msg-banner mb-5 ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</div>
        )}

        {/* 今日行动清单：只展示行动级条目（每日重复 ∪ 父 todo 今日/今日到期），完整管理在「日程 · todo」 */}
        <ActionsToday notify={setMsg} />

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
          onRefresh={load}
        />

        {/* 今日日程：时间轴 / 列表 双视图 */}
        <TodaySchedule blocks={blocks} activities={activities} todayKcal={todayKcal} setMsg={setMsg} load={load} />

        <footer className="mt-10 text-center text-[10px] text-ink-faint">
          拾光 · 第一阶段开发中 · 源码仓库 github.com/Ting97/shiguang
        </footer>
      </div>

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
    </main>
  );
}
