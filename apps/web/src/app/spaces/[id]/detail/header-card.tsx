"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import { Dismissable } from "@/components/dismissable";
import InlineRename from "@/components/inline-rename";
import type { Space } from "@/lib/types";
import { api, ApiClientError } from "@/shared/api";
import { bjDate, bjToday } from "./kit";
import type { Msg, Pos } from "./types";

/** 空间头部卡（自 detail.tsx 拆出）：图标/重命名/目标到期就地编辑/⋯ 菜单入口/进度概览 */
export default function SpaceHeaderCard(opts: {
  id: string;
  space: Space;
  onSaveTargetDate: (v: string | null) => Promise<boolean>;
  setSpace: Dispatch<SetStateAction<Space | null>>;
  setMsg: Dispatch<SetStateAction<Msg>>;
  setSpaceMenu: Dispatch<SetStateAction<boolean>>;
  setSpaceMenuPos: Dispatch<SetStateAction<Pos | null>>;
}) {
  const { id, space, onSaveTargetDate, setSpace, setMsg, setSpaceMenu, setSpaceMenuPos } = opts;
  // 目标到期时间就地编辑（头部 ⏳ 日期可点击调整/清除）
  const [dateEdit, setDateEdit] = useState(false);
  const [dateDraft, setDateDraft] = useState("");

  const todoProgress = space.todo_total ? Math.round((space.todo_done ?? 0) / space.todo_total * 100) : null;
  const actionProgress = space.action_total ? Math.round((space.action_done ?? 0) / space.action_total * 100) : null;
  const days = space.started_at ? Math.max(1, Math.ceil((Date.now() - new Date(bjDate(space.started_at) + "T00:00:00+08:00").getTime()) / 86_400_000)) : null;

  return (
    <div className="glass mb-4 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl" style={{ backgroundColor: `${space.color}26` }}>
          {space.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">
            <InlineRename
              value={space.name}
              onSave={async (name) => {
                try {
                  await api<any>(`/api/spaces/${id}`, "PATCH", { name });
                } catch (e) {
                  if (e instanceof ApiClientError) {
                    setMsg({ ok: false, text: e.message === "操作失败" ? "重命名失败" : e.message });
                    return false;
                  }
                  // 网络断开等异常收口为提示，不抛出点击处理器（裸 rejection 会触发整页刷新）
                  setMsg({ ok: false, text: "网络异常，请稍后重试" });
                  return false;
                }
                setSpace({ ...space, name });
                setMsg({ ok: true, text: "已重命名" });
                return true;
              }}
            />
          </h1>
          {space.description && <p className="mt-1 text-xs leading-relaxed text-ink-mute">{space.description}</p>}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-dim">
            {space.started_at && <span>{bjDate(space.started_at)} 开始</span>}
            {dateEdit ? (
              <Dismissable onClose={() => setDateEdit(false)} className="inline-flex items-center gap-1.5">
                <input
                  type="date"
                  autoFocus
                  value={dateDraft}
                  onChange={(e) => setDateDraft(e.target.value)}
                  className="rounded-lg border border-sky-500/50 bg-elevated px-1.5 py-0.5 text-[11px] text-ink"
                />
                <button
                  onClick={async () => {
                    if (await onSaveTargetDate(dateDraft || null)) setDateEdit(false);
                  }}
                  className="rounded-lg bg-sky-500/20 px-1.5 py-0.5 text-accent transition hover:bg-sky-500/30"
                >
                  保存
                </button>
                {space.target_date && (
                  <button
                    onClick={async () => {
                      if (await onSaveTargetDate(null)) setDateEdit(false);
                    }}
                    className="rounded-lg px-1.5 py-0.5 text-ink-mute transition hover:bg-soft hover:text-danger"
                  >
                    清除
                  </button>
                )}
              </Dismissable>
            ) : (
              <button
                onClick={() => {
                  setDateDraft(space.target_date ? bjDate(space.target_date) : "");
                  setDateEdit(true);
                }}
                className="-mx-1 rounded px-1 text-left transition hover:bg-soft hover:text-accent"
                title={space.target_date ? "点击调整目标到期时间" : "设置目标到期时间"}
              >
                {space.target_date ? (
                  <span className={bjDate(space.target_date) < bjToday() ? "text-danger" : undefined}>
                    ⏳ {bjDate(space.target_date)}
                    {bjDate(space.target_date) < bjToday() && " 已过期"}
                  </span>
                ) : (
                  <span className="text-ink-faint">＋ 设目标</span>
                )}
              </button>
            )}
            {days != null && <span>第 {days} 天</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href="/spaces" className="rounded px-2 py-1 text-xs text-ink-mute transition hover:bg-soft hover:text-accent">
            ← 列表
          </Link>
          <button
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setSpaceMenuPos({ top: Math.min(r.bottom + 6, window.innerHeight - 240), left: Math.max(8, r.right - 224) });
              setSpaceMenu(true);
            }}
            title="更多操作"
            className="rounded px-2 py-1 text-base leading-none text-ink-dim transition hover:bg-soft hover:text-ink"
          >
            ⋯
          </button>
        </div>
      </div>
      {/* 进度概览 */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 flex justify-between text-[10px] text-ink-faint">
            <span>todo 完成率</span>
            <span className="tabular-nums">{todoProgress == null ? "—" : `${space.todo_done}/${space.todo_total} · ${todoProgress}%`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${todoProgress ?? 0}%`, backgroundColor: space.color }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[10px] text-ink-faint">
            <span>行动完成率</span>
            <span className="tabular-nums">{actionProgress == null ? "—" : `${space.action_done}/${space.action_total} · ${actionProgress}%`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${actionProgress ?? 0}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
