/**
 * 图片客户端压缩与上传（REQ-001 R1）：
 * - compressImage：canvas 重绘，长边 ≤1920 等比缩小，JPEG 质量 0.85（png 含透明保留 png）
 * - uploadImages：并行上传（单张失败不阻塞其他），返回失败清单供重试
 */

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.85;

export async function compressImage(file: File): Promise<CompressedImage> {
  // gif 直接原样上传（canvas 会丢动画）；webp/png 按透明度决定输出格式
  if (file.type === "image/gif") {
    return { blob: file, width: 0, height: 0 };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const keepPng = file.type === "image/png" && await hasAlpha(ctx, w, h);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("压缩失败"))),
      keepPng ? "image/png" : "image/jpeg",
      keepPng ? undefined : JPEG_QUALITY,
    ),
  );
  // 压缩反而变大（小图）时用原图
  const out = blob.size < file.size ? blob : file;
  return { blob: out, width: w, height: h };
}

/** 抽样检测 canvas 是否含透明像素（决定 png 是否保留） */
async function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): Promise<boolean> {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 32));
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] < 250) return true;
    }
  }
  return false;
}

export interface UploadOutcome {
  ok: number;
  failed: File[];
}

/** 并行上传一组图片（服务端逐张校验：≤5MB、魔数白名单、单条 ≤9 张） */
export async function uploadImages(entryId: string, files: File[]): Promise<UploadOutcome> {
  if (files.length === 0) return { ok: 0, failed: [] };
  const compressed = await Promise.all(
    files.map(async (f) => {
      try {
        return { file: f, blob: (await compressImage(f)).blob };
      } catch {
        return { file: f, blob: f as Blob }; // 压缩失败用原图兜底（服务端仍会校验）
      }
    }),
  );
  const results = await Promise.allSettled(
    compressed.map(({ blob }) => {
      const form = new FormData();
      const name = blob instanceof File ? blob.name : "photo.jpg";
      form.append("files", blob, name);
      return fetch("/api/entries/" + entryId + "/images", { method: "POST", body: form }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "上传失败");
      });
    }),
  );
  const failed = compressed.filter((_, i) => results[i].status === "rejected").map((c) => c.file);
  return { ok: compressed.length - failed.length, failed };
}
