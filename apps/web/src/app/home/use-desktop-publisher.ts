"use client";

import { useRef, useState } from "react";
import { uploadImages } from "@/lib/image";
import type { DesktopImage, Notify } from "./types";

/**
 * 桌面输入区随附图片状态机（自 page.tsx 原样迁出）：
 * 选图（≤9 张）→ 发布后并行上传 → 失败标记 error 可用暂存 entryId 补传重试。
 */
export function useDesktopPublisher({ setMsg, load }: { setMsg: Notify; load: () => Promise<void> }) {
  // 桌面输入区：随动态附带的图片（发布后并行上传；失败可重试）
  const [desktopImages, setDesktopImages] = useState<DesktopImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 最近一次成功发布的动态 id（图片上传失败补传时使用）
  const lastEntryId = useRef<string | null>(null);

  /** 随动态附图：选择（≤9 张，超出的忽略并提示） */
  function addDesktopImages(files: File[]) {
    const imgs = files
      .filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type))
      .slice(0, 9 - desktopImages.length)
      .map((file) => ({ file, url: URL.createObjectURL(file), status: "ready" as const }));
    if (files.length && !imgs.length) setMsg({ ok: false, text: "仅支持 jpg/png/webp/gif 图片" });
    else if (imgs.length < files.length) setMsg({ ok: false, text: "最多添加 9 张，多余图片已忽略" });
    setDesktopImages((prev) => [...prev, ...imgs]);
  }

  function removeDesktopImage(index: number) {
    setDesktopImages((prev) => {
      URL.revokeObjectURL(prev[index]?.url ?? "");
      return prev.filter((_, i) => i !== index);
    });
  }

  /** 上传失败重试：用暂存的 entryId 重新上传仍处于 error 态的图片 */
  async function retryDesktopUpload() {
    if (!lastEntryId.current) return;
    const retryFiles = desktopImages.filter((i) => i.status === "error").map((i) => i.file);
    if (!retryFiles.length) return;
    const { failed } = await uploadImages(lastEntryId.current, retryFiles);
    if (failed.length) {
      setMsg({ ok: false, text: `仍有 ${failed.length} 张上传失败，请稍后再试` });
      void load();
      return;
    }
    setDesktopImages([]);
    setMsg({ ok: true, text: "✨ 图片已补传完成" });
    void load();
  }

  /**
   * 发布成功后的随图上传（原 submit 后半段，行为一致）：
   * 暂存 entryId；无图直接返回；失败留下 error 态供重试，成功则清空缩略条。
   */
  async function uploadAfterPublish(entryId: string, files: File[]) {
    lastEntryId.current = entryId;
    if (!files.length) return;
    setDesktopImages((prev) => prev.map((i) => ({ ...i, status: "uploading" as const })));
    const { failed } = await uploadImages(entryId, files);
    if (failed.length) {
      const failedSet = new Set(failed);
      setDesktopImages((prev) =>
        prev.filter((i) => failedSet.has(i.file)).map((i) => ({ ...i, status: "error" as const })),
      );
      setMsg({ ok: false, text: "动态已发布；部分图片上传失败，点缩略图上的「↻ 重试」" });
    } else {
      setDesktopImages((prev) => {
        prev.forEach((i) => URL.revokeObjectURL(i.url));
        return [];
      });
      setMsg({ ok: true, text: "✨ 动态与图片已发布，AI 正在识别…" });
    }
    void load();
  }

  return {
    desktopImages,
    fileInputRef,
    addDesktopImages,
    removeDesktopImage,
    retryDesktopUpload,
    uploadAfterPublish,
  };
}
