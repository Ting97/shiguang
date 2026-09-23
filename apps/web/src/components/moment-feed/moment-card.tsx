"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedMoment } from "@/lib/types";
import { moodEmoji } from "@/lib/mood";
import { TagChip } from "../tag-chip";
import { ImageGrid, ImageLightbox } from "../image-grid";
import EntryMenu from "../entry-menu";
import { createPortal } from "react-dom";
import { api } from "@/shared/api";
import { useCardActions } from "./use-card-actions";
import { CardHeader } from "./card-header";
import { RawTextSection } from "./raw-text-section";
import { MoodBlock } from "./mood-block";
import { RecognitionSection } from "./recognition-section";
import { PendingConfirms } from "./pending-confirms";
import type { IntentTag, MenuPos, MomentFeedProps } from "./types";

/** 单条动态卡片：原文 + 心情 + AI 识别产物（日程/待办/金额/人物，均可修改/删除） */
export default function MomentCard({ m, activities, onRefresh }: MomentFeedProps & { m: FeedMoment }) {
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // 原文行内编辑：null=非编辑态；字符串=textarea 当前内容
  const [editRaw, setEditRaw] = useState<string | null>(null);
  // 卡片操作菜单（编辑/删除）开关 + 桌面端锚定坐标
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsPos, setActionsPos] = useState<MenuPos>(null);
  // 识别与补充菜单的桌面端锚定坐标
  const [menuPos, setMenuPos] = useState<MenuPos>(null);
  // 图片全屏预览（null=关闭；数字=打开的下标）
  const [lightbox, setLightbox] = useState<number | null>(null);

  const emoji = moodEmoji(m.mood);
  const intent: IntentTag =
    m.todos.length > 0
      ? { icon: "📋", label: "todo", tone: "sky" as const }
      : m.blocks.length > 0
        ? { icon: "🕒", label: "日程", tone: "sky" as const }
        : m.mood
          ? { icon: "✨", label: "心情", tone: "violet" as const }
          : { icon: "📝", label: "动态", tone: "slate" as const };

  // 卡内操作反馈 + 提交逻辑（识别/手动添加/删除），由 useCardActions 提供
  const { cardMsg, setCardMsg, busyDomain, run, recognizeDomain, manualAdd, del } = useCardActions(m, onRefresh);

  // 延迟刷新定时器：卸载（删卡/切页）时清理，避免对已卸载卡片发起请求（失败会触发整页自愈刷新）
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      refreshTimers.current.forEach(clearTimeout);
      refreshTimers.current = [];
    },
    [],
  );

  /** 保存原文：后端自动清旧产物并全域重识别（秒回），延迟刷新呈现新识别结果 */
  const saveRaw = () =>
    run(async () => {
      const text = editRaw!.trim();
      if (!text) throw new Error("内容不能为空");
      await api(`/api/feed/${m.id}`, "PATCH", { raw_text: text });
      setEditRaw(null);
      // 识别在后台进行（约数秒）：延迟两次刷新让新产物自动上墙（覆盖上一轮未触发的定时器）
      refreshTimers.current.forEach(clearTimeout);
      refreshTimers.current = [
        setTimeout(() => void onRefresh(), 6000),
        setTimeout(() => void onRefresh(), 14000),
      ];
      return "✏️ 已保存，AI 正在重新识别全部信息…";
    });

  const confirmDelete = () =>
    run(async () => {
      await api(`/api/feed/${m.id}`, "DELETE");
      return "🗑 已删除这条动态及其识别结果";
    }).then(() => setConfirming(false));

  return (
    <article className="glass glass-hover group relative mt-0 flex min-w-0 flex-1 gap-3 rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5">
      {/* 头像位：心情 emoji（无心情时用意图图标） */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-elevated/80 text-xl">
        {m.mood ? emoji : intent.icon}
      </div>

      <div className="min-w-0 flex-1">
        {/* 头部：意图标签 + 空间徽标 + 整条删除（记录时间在卡片外的时间线旁） */}
        <CardHeader
          m={m}
          intent={intent}
          confirming={confirming}
          onConfirmDelete={confirmDelete}
          setConfirming={setConfirming}
          editRaw={editRaw}
          setEditRaw={setEditRaw}
          actionsOpen={actionsOpen}
          setActionsOpen={setActionsOpen}
          actionsPos={actionsPos}
          setActionsPos={setActionsPos}
          setMenuOpen={setMenuOpen}
        />

        {/* 原文：编辑态 textarea；否则点击弹出「识别与补充」菜单 */}
        <RawTextSection
          m={m}
          editRaw={editRaw}
          setEditRaw={setEditRaw}
          setActionsOpen={setActionsOpen}
          setMenuOpen={setMenuOpen}
          setMenuPos={setMenuPos}
          setCardMsg={setCardMsg}
          onSaveRaw={saveRaw}
        />

        {/* 图片九宫格（点击全屏预览） */}
        {m.images?.length > 0 && !editRaw && (
          <ImageGrid images={m.images} onOpen={(i) => setLightbox(i)} />
        )}

        {/* 识别与补充菜单：portal 渲染到 body——卡片 hover 位移会让 fixed 遮罩失效、后续卡片盖住菜单；点空白关闭由 EntryMenu 内部 useDismiss 处理（N3） */}
        {menuOpen &&
          createPortal(
            <>
              <EntryMenu
                m={m}
                activities={activities}
                busyDomain={busyDomain}
                onAI={recognizeDomain}
                onManual={manualAdd}
                onSetSpace={(spaceId) =>
                  run(async () => {
                    await api(`/api/feed/${m.id}`, "PATCH", { spaceId });
                    return spaceId ? `🎯 已归属空间` : "已移除空间归属";
                  })
                }
                onClose={() => setMenuOpen(false)}
                desktopPos={menuPos}
              />
            </>,
            document.body,
          )}

        {/* 图片全屏预览 */}
        {lightbox !== null && m.images?.length > 0 &&
          createPortal(<ImageLightbox images={m.images} index={lightbox} onClose={() => setLightbox(null)} />, document.body)}

        {/* 后台识别中 / 识别超时：动态已上墙，产物随后出现；超 10 分钟未完成则显示失败态（不再转圈） */}
        {!m.analyzed_at &&
          (m.recognize_state === "timeout" ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-faint">
              <TagChip icon="🤖" label="识别未完成" tone="slate" size="sm" className="shrink-0" />
              <span className="min-w-0 truncate">AI 当时未返回结果 · 点击原文可重新识别</span>
            </p>
          ) : (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-accent/80">
              <TagChip icon="🤖" label="AI 识别中" tone="violet" size="sm" className="shrink-0" />
              <span className="min-w-0 truncate">正在提取 日程 / 关系 / todo / 收支 / 心情 / 饮食…</span>
            </p>
          ))}

        {/* 日程冲突降级提示：识别时发现时间重叠，未登记时间轴；可关闭（服务端标记，多端不再出现） */}
        {m.analyzed_at &&
          m.recognitions?.schedule?.status === "none" &&
          !m.recognitions.schedule.reasonDismissed &&
          (m.recognitions.schedule.reason?.includes("已有日程") || m.recognitions.schedule.reason?.includes("时间冲突")) && (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-warn/90">
              <span className="min-w-0 flex-1">⚠️ 未生成日程：{m.recognitions.schedule.reason}</span>
              <button
                onClick={() =>
                  run(async () => {
                    await api(`/api/feed/${m.id}/dismiss-conflict`, "POST");
                    return "已关闭，不再提示";
                  })
                }
                title="不再显示此提示"
                className="shrink-0 rounded px-1 text-warn/60 transition hover:text-warn"
              >
                ✕
              </button>
            </div>
          )}

        {/* 心情：可改可删 */}
        <MoodBlock m={m} run={run} />

        {/* AI 识别产物 */}
        <RecognitionSection m={m} activities={activities} run={run} del={del} />

        {/* 待确认的低置信识别 */}
        <PendingConfirms m={m} run={run} />

        {/* 交互提示：点原文打开识别菜单（六域 AI 识别 / 手动补充) */}
        {!menuOpen && (
          <p className="mt-2 border-t border-line-soft/60 pt-2 text-[10px] text-ink-faint">
            点击动态内容 → 打开识别菜单（AI 识别 / 手动补充六类信息）
          </p>
        )}

        {/* 卡内操作反馈：识别/手动添加/编辑/删除的结果就地展示（不滚到页面顶部也能看到） */}
        {cardMsg && (
          <div
            role="status"
            className={`msg-banner mt-2 ${cardMsg.ok ? "msg-banner-ok" : "msg-banner-err"}`}
          >
            {cardMsg.text}
          </div>
        )}
      </div>
    </article>
  );
}
