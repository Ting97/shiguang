"use client";

import { useEffect, useRef, useState } from "react";
import { uploadImages } from "@/lib/image";

/**
 * 移动端发布输入面板（底部抽屉）：悬浮圆圈点按=空面板；长按语音松开=转写文字带入预览，
 * 用户确认/修改后点「发布」才真正提交。
 * 附带图片（REQ-001 R1）：相册多选 ≤9 张 + 触屏设备「拍照」入口；文字秒发后并行上传，失败可重试。
 */
interface SheetImage {
  file: File;
  url: string;
  status: "ready" | "uploading" | "error";
}

export default function PublishSheet({
  open,
  initialText,
  busy,
  onPublish,
  onClose,
}: {
  open: boolean;
  /** 打开时带入的初始文字（语音转写结果或空串） */
  initialText: string;
  busy: boolean;
  /** 发布文字动态；返回 entry id（供图片上传），失败/无图返回 null */
  onPublish: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<SheetImage[]>([]);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // 触屏设备提供「拍照」入口（桌面无摄像头场景隐藏）
  const [canCapture, setCanCapture] = useState(false);
  useEffect(() => setCanCapture(window.matchMedia("(pointer: coarse)").matches), []);
  // 最近发布的动态 id（重试用）
  const lastEntryId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialText);
    setImages([]);
    setSheetMsg(null);
    // 等挂载/键盘弹起后再聚焦，保证光标落在面板输入框
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [open, initialText]);

  if (!open) return null;

  function addImages(files: File[], source: "gallery" | "camera") {
    const imgs = files
      .filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type))
      .slice(0, 9 - images.length)
      .map((file) => ({ file, url: URL.createObjectURL(file), status: "ready" as const }));
    if (!imgs.length) setSheetMsg("仅支持 jpg/png/webp/gif 图片");
    else if (imgs.length < files.length) setSheetMsg("最多添加 9 张，多余图片已忽略");
    setImages((prev) => [...prev, ...imgs]);
    void source;
  }

  async function publish() {
    const t = value.trim();
    if (!t || busy) return;
    const files = images.filter((i) => i.status !== "error").map((i) => i.file);
    const entryId = await onPublish(t);
    if (!entryId) {
      onClose(); // 文字发布失败：关面板，错误提示在主页横幅
      return;
    }
    lastEntryId.current = entryId;
    if (!files.length) {
      onClose(); // 无图：直接收尾
      return;
    }
    setImages((prev) => prev.map((i) => ({ ...i, status: "uploading" as const })));
    const { failed } = await uploadImages(entryId, files);
    if (failed.length) {
      const failedSet = new Set(failed);
      setImages((prev) => prev.filter((i) => failedSet.has(i.file)).map((i) => ({ ...i, status: "error" as const })));
      setSheetMsg("动态已发布；部分图片上传失败，可「↻ 重试」或关闭面板");
      return;
    }
    images.forEach((i) => URL.revokeObjectURL(i.url));
    onClose();
  }

  async function retryUpload() {
    if (!lastEntryId.current) return;
    const retryFiles = images.filter((i) => i.status === "error").map((i) => i.file);
    if (!retryFiles.length) return;
    setImages((prev) => prev.map((i) => (i.status === "error" ? { ...i, status: "uploading" as const } : i)));
    const { failed } = await uploadImages(lastEntryId.current, retryFiles);
    if (failed.length) {
      const failedSet = new Set(failed);
      setImages((prev) => prev.filter((i) => failedSet.has(i.file)).map((i) => ({ ...i, status: "error" as const })));
      setSheetMsg(`仍有 ${failed.length} 张上传失败，请稍后再试`);
      return;
    }
    setSheetMsg(null);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-[55] bg-black/50" onClick={onClose} />
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-[56] rounded-t-2xl border-t border-line-soft bg-surface p-4 pb-5 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-soft">记录此刻</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-1 text-ink-dim hover:bg-white/5 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void publish();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          rows={3}
          maxLength={2000}
          placeholder='说点什么…（试试"刚跑完步40分钟，心情不错"、"明天下午三点看牙"）'
          className="input-glow w-full resize-none rounded-xl border border-line-soft bg-surface/60 px-4 py-3 text-sm outline-none placeholder:text-ink-faint"
        />
        {/* 接近上限才显示字数，平时不干扰 */}
        {value.length >= 1800 && (
          <p className={`mt-1 text-right text-[11px] tabular-nums ${value.length >= 1950 ? "text-danger" : "text-ink-faint"}`}>
            {value.length}/2000
          </p>
        )}

        {/* 已选图片缩略条（上传失败显示重试） */}
        {images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <span key={img.url} className={`relative overflow-hidden rounded-lg border ${img.status === "error" ? "border-rose-500/60" : "border-line-soft"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="h-14 w-14 object-cover" />
                {img.status === "error" ? (
                  <button
                    type="button"
                    onClick={() => void retryUpload()}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white"
                  >
                    ↻ 重试
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setImages((prev) => {
                        URL.revokeObjectURL(prev[i]?.url ?? "");
                        return prev.filter((_, idx) => idx !== i);
                      })
                    }
                    className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[9px] text-white"
                    aria-label="移除"
                  >
                    ✕
                  </button>
                )}
                {img.status === "uploading" && (
                  <span className="absolute inset-x-0 bottom-0 bg-black/50 text-center text-[9px] text-white">上传中…</span>
                )}
              </span>
            ))}
          </div>
        )}
        {sheetMsg && <p className="mt-1.5 text-[11px] text-warn">{sheetMsg}</p>}

        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label
              title="从相册选择（最多 9 张）"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-line-soft bg-surface/60 text-base transition active:border-sky-500/60"
            >
              🖼
              <input
                ref={galleryRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  addImages(Array.from(e.target.files ?? []), "gallery");
                  e.target.value = "";
                }}
              />
            </label>
            {canCapture && (
              <label
                title="拍照"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border border-line-soft bg-surface/60 text-base transition active:border-sky-500/60"
              >
                📷
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    addImages(Array.from(e.target.files ?? []), "camera");
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            <span className="text-[11px] text-ink-faint">发布后 AI 自动识别</span>
          </div>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy || !value.trim()}
            className="btn-primary rounded-xl px-7 py-2 text-sm font-medium"
          >
            {busy ? "识别中…" : "发布"}
          </button>
        </div>
      </div>
    </>
  );
}
