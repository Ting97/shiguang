"use client";

import type { Dispatch, SetStateAction } from "react";
import { useRef } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { PencilLine, Trash2 } from "lucide-react";
import type { FeedMoment } from "@/lib/types";
import { TagChip } from "../tag-chip";
import { Dismissable } from "../dismissable";
import type { IntentTag, MenuPos } from "./types";

interface CardHeaderProps {
  m: FeedMoment;
  intent: IntentTag;
  /** 整条删除的二次确认态 */
  confirming: boolean;
  onConfirmDelete: () => void;
  /** 删除请求进行中（按钮禁用，防双发） */
  deleting?: boolean;
  setConfirming: Dispatch<SetStateAction<boolean>>;
  /** 原文行内编辑态：编辑中不显示「⋯」操作入口 */
  editRaw: string | null;
  setEditRaw: Dispatch<SetStateAction<string | null>>;
  /** 卡片操作菜单（编辑/删除）开关 + 桌面端锚定坐标 */
  actionsOpen: boolean;
  setActionsOpen: Dispatch<SetStateAction<boolean>>;
  actionsPos: MenuPos;
  setActionsPos: Dispatch<SetStateAction<MenuPos>>;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
}

/** 卡片头部：意图标签 + 空间徽标 + 整条删除（记录时间在卡片外的时间线旁） */
export function CardHeader({
  m,
  intent,
  confirming,
  onConfirmDelete,
  deleting,
  setConfirming,
  editRaw,
  setEditRaw,
  actionsOpen,
  setActionsOpen,
  actionsPos,
  setActionsPos,
  setMenuOpen,
}: CardHeaderProps) {
  // 「⋯」再点应关闭菜单：但 pointerdown 已先经 Dismissable 关闭，click 的 toggle 会把它翻回开。
  // 记录本实例最近一次关闭时刻，300ms 内的紧随 click 视为同一次点击，不再重开（按实例隔离，不影响别卡浮层互斥）。
  const closedAtRef = useRef(0);
  return (
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
            onClick={onConfirmDelete}
            disabled={deleting}
            className="rounded bg-rose-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {deleting ? "删除中…" : "确认删除"}
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
                if (Date.now() - closedAtRef.current < 300) return; // 刚被本次点击的 pointerdown 关闭：视为关闭操作
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
                <Dismissable
                  onClose={() => {
                    closedAtRef.current = Date.now();
                    setActionsOpen(false);
                  }}
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
                </Dismissable>,
                document.body,
              )}
          </>
        )
      )}
    </div>
  );
}
