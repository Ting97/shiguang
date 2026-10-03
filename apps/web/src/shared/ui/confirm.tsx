"use client";

/**
 * 命令式确认弹窗（REQ-009 FR-B1/B2）：window.confirm 与「portal 菜单内两步确认」的统一替代。
 * 背景（008 实测）：React 19 下 portal 菜单内经重渲染的按钮第二次点击事件不送达，
 * 两步确认在行菜单场景不可靠；本组件走独立渲染树 + 单次点击确认，规避该问题。
 * 用法：if (!(await confirmDialog({ title: "删除空间", message: "…" }))) return;
 */
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";

export interface ConfirmOptions {
  title: string;
  /** 说明文案（支持多行 \n） */
  message?: string;
  confirmText?: string;
  cancelText?: string;
  /** destructive 语义：确认钮红色（默认 true——确认弹窗绝大多数是删除类） */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

let ask: ((o: PendingConfirm) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    ask?.({ danger: true, ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ask = (o) => {
      setBusy(false);
      setPending(o);
    };
    return () => {
      ask = null;
    };
  }, []);

  function close(ok: boolean) {
    if (!pending || busy) return;
    setBusy(true);
    pending.resolve(ok);
    setPending(null);
  }

  if (!pending) return null;
  const danger = pending.danger !== false;
  return (
    <Modal title={pending.title} onClose={() => close(false)}>
      {pending.message && (
        <p className="mb-4 whitespace-pre-line text-xs leading-relaxed text-ink-soft">{pending.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => close(false)} className="btn-ghost rounded-lg px-4 py-1.5 text-xs font-medium">
          {pending.cancelText ?? "取消"}
        </button>
        <button
          type="button"
          onClick={() => close(true)}
          autoFocus
          className={`rounded-lg px-4 py-1.5 text-xs font-medium text-white transition active:scale-[0.97] ${
            danger ? "bg-rose-600 hover:bg-rose-500" : "btn-primary"
          }`}
        >
          {pending.confirmText ?? "确认"}
        </button>
      </div>
    </Modal>
  );
}
