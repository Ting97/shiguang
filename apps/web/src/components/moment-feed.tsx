"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Activity, FeedMoment } from "@/lib/types";
import { moodEmoji, moodTone } from "@/lib/mood";
import { TX_CATEGORIES } from "@/lib/finance";
import EntryMenu from "./entry-menu";
import { TagChip } from "./tag-chip";
import { ImageGrid, ImageLightbox } from "./image-grid";
import { PencilLine, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";

const pad = (n: number) => String(n).padStart(2, "0");
const zhClock = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** 记录时刻 →「今天 15:32 / 昨天 21:04 / 9月15日 08:30」 */
export const zhRecordTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86_400_000);
  const clock = zhClock(iso);
  if (diffDays === 0) return { day: "今天", clock };
  if (diffDays === 1) return { day: "昨天", clock };
  const sameYear = d.getFullYear() === now.getFullYear();
  return {
    day: `${sameYear ? "" : d.getFullYear() + "年"}${d.getMonth() + 1}月${d.getDate()}日`,
    clock,
  };
};

const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/** 待办时间标签：有起始时间且与到期同日 →「9:10–9:30」区间；否则退回单时刻 */
function todoTimeLabel(startAt: string | null | undefined, dueAt: string | null): string | null {
  if (!dueAt) return null;
  if (startAt) {
    const a = new Date(startAt);
    const b = new Date(dueAt);
    const sameDay =
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (sameDay && b.getTime() !== a.getTime()) return `${zhClock(startAt)}–${zhClock(dueAt)}`;
  }
  const t = zhRecordTime(dueAt);
  return `${t.day} ${t.clock}`;
}

/** 跨天时间块的日期前缀：非今天 →「9月17日 」（避免凌晨记录的"昨天下午"被误读为今天） */
const dayPrefix = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(now) - day(d)) / 86_400_000) === 0 ? "" : `${d.getMonth() + 1}月${d.getDate()}日 `;
};

export const COMMON_MOODS = ["开心", "满足", "兴奋", "放松", "平静", "疲惫", "焦虑", "烦躁", "难过", "生气"];

// 五域/关系域中文名（待确认提示等处使用）
export const DOMAIN_LABELS: Record<string, string> = {
  schedule: "日程",
  todo: "待办",
  finance: "收支",
  mood: "心情",
  diet: "饮食",
  people: "关系",
};
const FEED_PAGE_SIZE_HINT = 10; // 超过一页才显示「到底啦」提示

/** 用原块日期 + 新的 HH:MM 组装 ISO（保持本地时区与原日期） */
function combineHM(originalIso: string, hm: string): string {
  const d = new Date(originalIso);
  const [h, m] = hm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
const isoToLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localInputToIso = (v: string) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

async function api(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "操作失败");
  return j;
}

interface Props {
  moments: FeedMoment[];
  activities: Activity[];
  onRefresh: () => Promise<void>;
  /** 还有多少条未展示（>0 显示「加载更多」按钮） */
  moreCount?: number;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** 搜索模式：空态文案与常规不同 */
  searching?: boolean;
  searchKeyword?: string;
}

/** 行内小操作按钮（编辑/删除），悬停显示 */
function RowAction({ onEdit, onDelete, editTitle = "修改", delTitle = "删除" }: {
  onEdit?: () => void;
  onDelete?: () => void;
  editTitle?: string;
  delTitle?: string;
}) {
  return (
    <span className="row-actions hidden shrink-0 items-center gap-0.5 group-hover/row:flex">
      {onEdit && (
        <button
          onClick={onEdit}
          title={editTitle}
          className="rounded px-1 py-0.5 text-[11px] text-ink-dim hover:text-accent"
        >
          ✏️
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          title={delTitle}
          className="rounded px-1 py-0.5 text-[11px] text-ink-dim hover:text-danger"
        >
          🗑
        </button>
      )}
    </span>
  );
}

/** 单条动态卡片：原文 + 心情 + AI 识别产物（日程/待办/金额/人物，均可修改/删除） */
function MomentCard({ m, activities, onRefresh }: Props & { m: FeedMoment }) {
  const [confirming, setConfirming] = useState(false);
  const [moodPicker, setMoodPicker] = useState(false);
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 卡内操作反馈：识别/手动添加/编辑/删除的成功失败都显示在当前卡片内（顶部横幅在长页面上看不见）
  const [cardMsg, setCardMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 低置信待确认域（识别登记簿 pending）
  const pendingDomains = (Object.entries(m.recognitions ?? {}) as [string, { status: string; confidence: number }][])
    .filter(([, v]) => v.status === "pending")
    .map(([domain, v]) => ({ domain, confidence: v.confidence }));
  const [editBlock, setEditBlock] = useState<{ id: string; title: string; start: string; end: string; activityId: string } | null>(null);
  const [editTodo, setEditTodo] = useState<{ id: string; title: string; start: string; due: string; activityId: string } | null>(null);
  const [editTx, setEditTx] = useState<{ id: string; direction: string; amount: string; category: string; counterparty: string } | null>(null);
  // 原文行内编辑：null=非编辑态；字符串=textarea 当前内容
  const [editRaw, setEditRaw] = useState<string | null>(null);
  // 卡片操作菜单（编辑/删除）开关 + 桌面端锚定坐标
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsPos, setActionsPos] = useState<{ top: number; left: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // 图片全屏预览（null=关闭；数字=打开的下标）
  const [lightbox, setLightbox] = useState<number | null>(null);

  const emoji = moodEmoji(m.mood);
  const intent =
    m.todos.length > 0
      ? { icon: "📋", label: "待办", tone: "sky" as const }
      : m.blocks.length > 0
        ? { icon: "🕒", label: "日程", tone: "sky" as const }
        : m.mood
          ? { icon: "✨", label: "心情", tone: "violet" as const }
          : { icon: "📝", label: "动态", tone: "slate" as const };

  // 卡内消息自动消失：成功 3.5s / 失败 8s（失败停留更久方便看清原因）
  useEffect(() => {
    if (!cardMsg) return;
    const t = setTimeout(() => setCardMsg(null), cardMsg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [cardMsg]);

  const run = async (fn: () => Promise<string>) => {
    try {
      setCardMsg({ ok: true, text: await fn() });
      await onRefresh();
    } catch (e) {
      setCardMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  /** 菜单里点某域：AI 识别该域 */
  const recognizeDomain = (domain: string) =>
    run(async () => {
      setBusyDomain(domain);
      try {
        const j = await api(`/api/entries/${m.id}/recognize`, "POST", { domain });
        return j.message ?? "已重新识别";
      } finally {
        setBusyDomain(null);
      }
    });

  /** 菜单里手动添加某域产物 */
  const manualAdd = async (domain: string, payload: Record<string, unknown>) => {
    try {
      const j = await api(`/api/entries/${m.id}/manual`, "POST", { domain, payload });
      setCardMsg({ ok: true, text: j.message ?? "已添加" });
      await onRefresh();
    } catch (e) {
      setCardMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  const del = (message: string, fn: () => Promise<unknown>) =>
    window.confirm(message) ? run(async () => (await fn(), "🗑 已删除")) : undefined;

  /** 保存原文：后端自动清旧产物并全域重识别（秒回），延迟刷新呈现新识别结果 */
  const saveRaw = () =>
    run(async () => {
      const text = editRaw!.trim();
      if (!text) throw new Error("内容不能为空");
      await api(`/api/feed/${m.id}`, "PATCH", { raw_text: text });
      setEditRaw(null);
      // 识别在后台进行（约数秒）：延迟两次刷新让新产物自动上墙
      setTimeout(() => void onRefresh(), 6000);
      setTimeout(() => void onRefresh(), 14000);
      return "✏️ 已保存，AI 正在重新识别全部信息…";
    });

  return (
    <article className="glass glass-hover group relative mt-0 flex min-w-0 flex-1 gap-3 rounded-2xl p-4 transition-transform duration-200 hover:-translate-y-0.5">
      {/* 头像位：心情 emoji（无心情时用意图图标） */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-elevated/80 text-xl">
        {m.mood ? emoji : intent.icon}
      </div>

      <div className="min-w-0 flex-1">
        {/* 头部：意图标签 + 空间徽标 + 整条删除（记录时间在卡片外的时间线旁） */}
        <div className="flex items-center gap-2 text-xs text-ink-dim">
          <TagChip icon={intent.icon} label={intent.label} tone={intent.tone} size="sm" />
          {m.space && (
            <Link href={`/spaces/${m.space.id}`} className="min-w-0">
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${m.space.color}26`, color: m.space.color }}
                title={`目标空间：${m.space.name}`}
              >
                <span className="shrink-0 text-[11px] leading-none">{m.space.icon}</span>
                <span className="min-w-0 truncate">{m.space.name}</span>
              </span>
            </Link>
          )}
          {m.source === "voice" && <TagChip icon="🎙" label="语音" tone="slate" size="sm" title="语音输入" />}
          {(Object.values(m.recognitions ?? {}) as { engine?: string | null }[]).some((v) => v.engine === "rules") && (
            <TagChip
              icon="⚠"
              label="离线识别"
              tone="amber"
              size="sm"
              title="AI 暂不可用（额度/网络），本次由离线规则识别，点击原文可重识别"
            />
          )}
          <span className="flex-1" />
          {confirming ? (
            <span className="flex items-center gap-1">
              <button
                onClick={() =>
                  run(async () => {
                    await api(`/api/feed/${m.id}`, "DELETE");
                    return "🗑 已删除这条动态及其识别结果";
                  }).then(() => setConfirming(false))
                }
                className="rounded bg-rose-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-rose-500"
              >
                确认删除
              </button>
              <button onClick={() => setConfirming(false)} className="px-1 text-[10px] text-ink-mute hover:text-ink">
                取消
              </button>
            </span>
          ) : (
            editRaw === null && (
              <>
                <button
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    // 顶部避开吸顶导航（≥60px），底部预留菜单高度
                    setActionsPos({ top: Math.max(60, Math.min(r.bottom + 4, window.innerHeight - 100)), left: Math.max(8, r.right - 128) });
                    setActionsOpen((v) => !v);
                    setMenuOpen(false);
                  }}
                  title="更多操作"
                  className="row-actions-hidden hidden rounded px-1.5 text-sm leading-none text-ink-dim transition hover:text-ink group-hover:block"
                >
                  ⋯
                </button>
                {actionsOpen &&
                  createPortal(
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={() => setActionsOpen(false)} />
                      <div
                        className="fixed z-[60] w-32 overflow-hidden rounded-xl border border-line-soft bg-elevated shadow-lg"
                        style={{ top: actionsPos?.top, left: actionsPos?.left }}
                      >
                        <button
                          onClick={() => { setActionsOpen(false); setEditRaw(m.raw_text); setMenuOpen(false); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-ink transition hover:bg-wash"
                        >
                          <PencilLine size={14} /> 编辑
                        </button>
                        <button
                          onClick={() => { setActionsOpen(false); setConfirming(true); }}
                          className="flex w-full items-center gap-2 border-t border-line-soft px-3 py-2 text-xs text-danger transition hover:bg-wash"
                        >
                          <Trash2 size={14} /> 删除
                        </button>
                      </div>
                    </>,
                    document.body,
                  )}
              </>
            )
          )}
        </div>

        {/* 原文：编辑态 textarea；否则点击弹出「识别与补充」菜单 */}
        {editRaw !== null ? (
          <div className="mt-1.5">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={Math.min(6, Math.max(2, editRaw.split("\n").length + 1))}
              autoFocus
              className="w-full resize-y rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[15px] leading-relaxed text-ink outline-none focus:border-sky-500"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={saveRaw}
                className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
              >
                保存并重新识别
              </button>
              <button onClick={() => setEditRaw(null)} className="px-1 text-xs text-ink-mute hover:text-ink">
                取消
              </button>
            </div>
          </div>
        ) : (
          <p
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const desktop = window.innerWidth >= 640;
              setMenuPos(
                desktop
                  ? {
                      top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 360)),
                      left: Math.max(8, Math.min(r.right - 300, window.innerWidth - 316)),
                    }
                  : null,
              );
              setActionsOpen(false);
              setMenuOpen((v) => !v);
            }}
            title="点击打开识别菜单"
            className="mt-1.5 cursor-pointer whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink transition-colors hover:text-white"
          >
            {m.raw_text}
          </p>
        )}

        {/* 图片九宫格（点击全屏预览） */}
        {m.images?.length > 0 && !editRaw && (
          <ImageGrid images={m.images} onOpen={(i) => setLightbox(i)} />
        )}

        {/* 识别与补充菜单：portal 渲染到 body——卡片 hover 位移会让 fixed 遮罩失效、后续卡片盖住菜单 */}
        {menuOpen &&
          createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
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
              <span className="min-w-0 truncate">正在提取 日程 / 关系 / 待办 / 收支 / 心情 / 饮食…</span>
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
        {m.mood || moodPicker ? (
          <div className="mt-1 text-xs">
            {moodPicker ? (
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-elevated/60 p-2">
                {COMMON_MOODS.map((w) => (
                  <button
                    key={w}
                    onClick={() =>
                      run(async () => {
                        await api(`/api/feed/${m.id}`, "PATCH", { mood: w });
                        return `${moodEmoji(w)} 心情已改为「${w}」`;
                      }).then(() => setMoodPicker(false))
                    }
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      m.mood === w ? "bg-sky-600 text-white" : "bg-soft/60 text-ink-soft hover:bg-strong"
                    }`}
                  >
                    {moodEmoji(w)} {w}
                  </button>
                ))}
                <button
                  onClick={() =>
                    run(async () => {
                      await api(`/api/feed/${m.id}`, "PATCH", { mood: null });
                      return "已清除心情";
                    }).then(() => setMoodPicker(false))
                  }
                  className="rounded-full px-2 py-0.5 text-[11px] text-danger hover:bg-rose-500/20"
                >
                  清除
                </button>
                <button onClick={() => setMoodPicker(false)} className="ml-auto px-1 text-[11px] text-ink-dim">
                  取消
                </button>
              </div>
            ) : (
              <p className={`group/mood flex items-center gap-1.5 ${moodTone(m.mood_score)}`}>
                <span>{moodEmoji(m.mood)} 此刻心情：{m.mood}</span>
                <button
                  onClick={() => setMoodPicker(true)}
                  className="row-actions-hidden hidden text-[11px] text-ink-dim hover:text-accent group-hover/mood:inline"
                >
                  改
                </button>
              </p>
            )}
          </div>
        ) : null}

        {/* AI 识别产物 */}
        {(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0 || m.people.length > 0 || m.diet) && (
          <div className="mt-2.5 space-y-1 rounded-lg border border-line-soft bg-bg/50 px-3 py-2 text-xs text-ink-soft">
            {/* ---- 日程块 ---- */}
            {m.blocks.map((b) =>
              editBlock?.id === b.id ? (
                <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
                  <input
                    value={editBlock.title}
                    onChange={(e) => setEditBlock({ ...editBlock, title: e.target.value })}
                    className="min-w-28 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
                    placeholder="标题"
                  />
                  <input
                    type="time"
                    value={editBlock.start}
                    onChange={(e) => setEditBlock({ ...editBlock, start: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                  />
                  <span className="text-ink-dim">至</span>
                  <input
                    type="time"
                    value={editBlock.end}
                    onChange={(e) => setEditBlock({ ...editBlock, end: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                  />
                  <select
                    value={editBlock.activityId}
                    onChange={(e) => setEditBlock({ ...editBlock, activityId: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                    ))}
                  </select>
                  <span className="flex gap-1">
                    <button onClick={() => setEditBlock(null)} className="rounded px-2 py-1 text-[11px] text-ink-mute hover:bg-soft">取消</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          if (editBlock.end <= editBlock.start) throw new Error("结束时间必须晚于开始时间");
                          await api(`/api/blocks/${b.id}`, "PATCH", {
                            title: editBlock.title.trim() || b.title,
                            startAt: combineHM(b.startAt, editBlock.start),
                            endAt: combineHM(b.endAt, editBlock.end),
                            activityId: editBlock.activityId,
                          });
                          setEditBlock(null);
                          return "💾 日程已更新";
                        })
                      }
                      className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </span>
                </div>
              ) : (
                <p key={b.id} className="group/row flex items-center gap-x-2 gap-y-0.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="truncate">
                    {b.icon} {b.activityName} · {b.title}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-mute">
                    {dayPrefix(b.startAt)}{zhClock(b.startAt)}–{zhClock(b.endAt)} · {b.durationMin} 分钟
                  </span>
                  <RowAction
                    onEdit={() =>
                      setEditBlock({
                        id: b.id,
                        title: b.title,
                        start: zhClock(b.startAt),
                        end: zhClock(b.endAt),
                        activityId: activities.some((a) => a.id === b.activityId) ? b.activityId : activities[0]?.id ?? "",
                      })
                    }
                    onDelete={() =>
                      del(`删除这条日程？\n「${b.title}」 ${zhClock(b.startAt)}–${zhClock(b.endAt)}`, () =>
                        api(`/api/blocks/${b.id}`, "DELETE"))
                    }
                  />
                </p>
              ),
            )}

            {/* ---- 待办 ---- */}
            {m.todos.map((td) =>
              editTodo?.id === td.id ? (
                <div key={td.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
                  <input
                    value={editTodo.title}
                    onChange={(e) => setEditTodo({ ...editTodo, title: e.target.value })}
                    className="min-w-28 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
                    placeholder="标题"
                  />
                  <input
                    type="datetime-local"
                    value={editTodo.start}
                    onChange={(e) => setEditTodo({ ...editTodo, start: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                    title="开始时间（可清空）"
                  />
                  <input
                    type="datetime-local"
                    value={editTodo.due}
                    onChange={(e) => setEditTodo({ ...editTodo, due: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                    title="到期时间"
                  />
                  <select
                    value={editTodo.activityId}
                    onChange={(e) => setEditTodo({ ...editTodo, activityId: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    {activities.map((a) => (
                      <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                    ))}
                  </select>
                  <span className="flex gap-1">
                    <button onClick={() => setEditTodo(null)} className="rounded px-2 py-1 text-[11px] text-ink-mute hover:bg-soft">取消</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          if (!editTodo.title.trim()) throw new Error("标题不能为空");
                          await api(`/api/todos/${td.id}`, "PATCH", {
                            title: editTodo.title.trim(),
                            startAt: localInputToIso(editTodo.start),
                            dueAt: localInputToIso(editTodo.due),
                            activityId: editTodo.activityId,
                          });
                          setEditTodo(null);
                          return "💾 待办已更新";
                        })
                      }
                      className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </span>
                </div>
              ) : (
                <p key={td.id} className="group/row flex items-center gap-x-2">
                  <TagChip icon="📋" label="待办" tone="sky" size="sm" className="shrink-0" />
                  <span className="truncate">{td.title}</span>
                  <span className="shrink-0 text-ink-mute">
                    {todoTimeLabel(td.startAt, td.dueAt) ?? "未定时间"}
                  </span>
                  {td.status === "done" && <span className="shrink-0 text-success">已完成</span>}
                  <RowAction
                    onEdit={() =>
                      setEditTodo({
                        id: td.id,
                        title: td.title,
                        start: isoToLocalInput(td.startAt ?? null),
                        due: isoToLocalInput(td.dueAt),
                        activityId: activities.some((a) => a.id === td.activityId) ? td.activityId! : activities[0]?.id ?? "",
                      })
                    }
                    onDelete={() => del(`删除这条待办？\n「${td.title}」`, () => api(`/api/todos/${td.id}`, "DELETE"))}
                  />
                </p>
              ),
            )}

            {/* ---- 金额流水 ---- */}
            {m.transactions.map((x) =>
              editTx?.id === x.id ? (
                <div key={x.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-elevated/60 p-2">
                  <select
                    value={editTx.direction}
                    onChange={(e) => setEditTx({ ...editTx, direction: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    <option value="out">支出</option>
                    <option value="in">收入</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editTx.amount}
                    onChange={(e) => setEditTx({ ...editTx, amount: e.target.value })}
                    className="w-24 rounded border border-line-strong bg-surface px-2 py-1 text-xs tabular-nums outline-none focus:border-sky-500"
                    placeholder="金额(元)"
                  />
                  <select
                    value={editTx.category}
                    onChange={(e) => setEditTx({ ...editTx, category: e.target.value })}
                    className="rounded border border-line-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-sky-500"
                  >
                    {TX_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    value={editTx.counterparty}
                    onChange={(e) => setEditTx({ ...editTx, counterparty: e.target.value })}
                    className="w-24 flex-1 rounded border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-sky-500"
                    placeholder="对方(可空)"
                  />
                  <span className="flex gap-1">
                    <button onClick={() => setEditTx(null)} className="rounded px-2 py-1 text-[11px] text-ink-mute hover:bg-soft">取消</button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const cents = Math.round(parseFloat(editTx.amount) * 100);
                          if (!Number.isFinite(cents) || cents <= 0) throw new Error("金额必须大于 0");
                          await api(`/api/transactions/${x.id}`, "PATCH", {
                            direction: editTx.direction,
                            amountCents: cents,
                            category: editTx.category,
                            counterparty: editTx.counterparty,
                          });
                          setEditTx(null);
                          return "💾 金额已更新";
                        })
                      }
                      className="rounded bg-sky-600 px-2 py-1 text-[11px] font-medium hover:bg-sky-500"
                    >
                      保存
                    </button>
                  </span>
                </div>
              ) : (
                <p key={x.id} className="group/row flex items-center gap-x-2 text-ink-mute">
                  <TagChip
                    icon="💰"
                    label={`${x.direction === "out" ? "支出" : "收入"} ${yuan(x.amountCents)}`}
                    tone={x.direction === "out" ? "rose" : "emerald"}
                    size="sm"
                    className="shrink-0"
                  />
                  <span className="min-w-0 truncate">
                    {x.category}
                    {x.counterparty ? ` · 对方：${x.counterparty}` : ""}
                  </span>
                  <RowAction
                    onEdit={() =>
                      setEditTx({
                        id: x.id,
                        direction: x.direction,
                        amount: String(x.amountCents / 100),
                        category: TX_CATEGORIES.includes(x.category) ? x.category : "其他",
                        counterparty: x.counterparty ?? "",
                      })
                    }
                    onDelete={() => del(`删除这笔金额记录？（${x.direction === "out" ? "支出" : "收入"} ${yuan(x.amountCents)}）`, () =>
                      api(`/api/transactions/${x.id}`, "DELETE"))}
                  />
                </p>
              ),
            )}

            {/* ---- 人物 ---- */}
            {m.people.length > 0 && (
              <p className="group/row flex items-center gap-x-2 text-ink-mute">
                <TagChip icon="👥" label={m.people.map((p) => p.name).join("、")} tone="sky" size="sm" />
                <RowAction
                  onDelete={() =>
                    del(`移除人物关联？（不影响联系人档案）\n「${m.people.map((p) => p.name).join("、")}」`, () =>
                      Promise.all(m.people.map((p) => api(`/api/interactions/${p.interactionId}`, "DELETE"))).then(() => undefined))
                  }
                />
              </p>
            )}

            {/* ---- 饮食 ---- */}
            {m.diet && (
              <p className="group/row flex items-center gap-x-2 text-ink-mute">
                <TagChip icon="🍽" label="饮食" tone="amber" size="sm" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {m.diet.meal !== "未知" ? `${m.diet.meal} · ` : ""}
                  {(m.diet.items ?? []).map((i) => `${i.name}${i.amount ?? ""}`).join(" + ")}
                  {m.diet.totalKcal != null ? ` · ≈${m.diet.totalKcal} kcal` : ""}
                </span>
                <button
                  onClick={() =>
                    del("删除这条饮食记录？", async () => {
                      await api(`/api/entries/${m.id}/diet`, "DELETE");
                      return "🗑 已删除饮食记录";
                    })
                  }
                  title="删除饮食记录"
                  className="row-actions-hidden hidden shrink-0 rounded px-1 text-xs text-ink-dim hover:text-danger group-hover/row:block"
                >
                  🗑
                </button>
              </p>
            )}
          </div>
        )}

        {/* 待确认的低置信识别 */}
        {pendingDomains.length > 0 && (
          <div className="mt-2 space-y-1">
            {pendingDomains.map((d) => (
              <div key={d.domain} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-[11px] text-warn/90">
                <span>🤔 识别到{DOMAIN_LABELS[d.domain] ?? d.domain}（置信度 {Math.round((d.confidence ?? 0) * 100)}%），确认吗？</span>
                <button
                  onClick={() => run(async () => { await api(`/api/entries/${m.id}/confirm`, "POST", { domain: d.domain }); return "✅ 已确认入账"; })}
                  className="rounded bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-sky-500"
                >
                  确认
                </button>
                <button
                  onClick={() => run(async () => { await api(`/api/entries/${m.id}/confirm`, "POST", { domain: d.domain, ignore: true }); return "已忽略"; })}
                  className="rounded px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink"
                >
                  忽略
                </button>
              </div>
            ))}
          </div>
        )}

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

/** 动态流：按天分组（今天/昨天/历史日期），组内时间线 + 记录时刻贴合节点 */
export default function MomentFeed(props: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, FeedMoment[]>();
    for (const m of props.moments) {
      const key = zhRecordTime(m.created_at).day;
      (map.get(key) ?? map.set(key, []).get(key)!).push(m);
    }
    return [...map.entries()];
  }, [props.moments]);

  if (props.moments.length === 0) {
    return (
      <p className="empty-state">
        {props.searching
          ? `没有找到包含「${props.searchKeyword}」的动态 —— 换个关键词，或点 ✕ 清除搜索`
          : "还没有动态 —— 随口说一句今天的事、心情或明天的计划试试"}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(([day, items]) => (
        <section key={day}>
          <h3 className="sticky top-14 z-30 -mx-1 mb-2 bg-gradient-to-b from-bg via-bg/95 to-transparent px-1 pb-1 text-xs font-medium text-ink-dim">
            — {day} —
          </h3>
          <div className="relative space-y-3">
            {items.map((m, idx) => {
              const t = zhRecordTime(m.created_at);
              const isLast = idx === items.length - 1;
              return (
                <div key={m.id} className="relative flex items-start gap-2 sm:gap-2.5">
                  {/* 连接线：从本节点延伸到下一个节点（末条不画，避免悬空） */}
                  {!isLast && (
                    <span className="absolute left-[8px] top-[42px] -bottom-3 w-px bg-gradient-to-b from-sky-500/40 to-indigo-500/15 sm:left-[10.5px]" />
                  )}
                  <span className="absolute left-[4px] top-8 z-10 h-2 w-2 shrink-0 rounded-full bg-gradient-to-br from-sky-400 to-indigo-400 shadow-[0_0_10px_rgba(56,189,248,0.6)] sm:left-[6px] sm:h-2.5 sm:w-2.5" />
                  {/* 记录时刻：桌面在卡片外节点旁；移动端窄屏隐藏（时刻移入卡片头部，把宽度还给正文） */}
                  <div className="ml-[14px] hidden w-12 shrink-0 pt-7 text-left leading-tight sm:ml-[18px] sm:block">
                    <div className="text-xs tabular-nums text-ink-mute">{t.clock}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 pl-1 text-[11px] tabular-nums text-ink-dim sm:hidden">{t.clock}</div>
                    <MomentCard m={m} {...props} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* 分页：每次多加载一页 */}
      {(props.moreCount ?? 0) > 0 && props.onLoadMore ? (
        <div className="pt-1 text-center">
          <button
            onClick={props.onLoadMore}
            disabled={props.loadingMore}
            className="rounded-full border border-line-soft bg-surface/60 px-5 py-2 text-xs text-accent transition hover:border-sky-500/50 hover:text-accent disabled:opacity-50"
          >
            {props.loadingMore ? "加载中…" : `加载更多（还有 ${props.moreCount} 条）`}
          </button>
        </div>
      ) : (
        props.moments.length >= FEED_PAGE_SIZE_HINT && (
          <p className="pt-1 text-center text-[11px] text-ink-dim">— 已经到底啦 —</p>
        )
      )}
    </div>
  );
}
