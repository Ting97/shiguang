/**
 * 图片存储层（REQ-001 R1）：本地磁盘 + storage_key 抽象（未来可平滑迁移 COS/OSS）。
 * - 生产 UPLOAD_DIR=/opt/shiguangri_data/uploads（发布交换目录之外，双 tar 发版不丢文件）
 * - 开发缺省 apps/api 运行目录下 .uploads/（gitignore）
 * - key: {yyyy}/{mm}/{uuid}.{ext}（北京时间），uuid 不可枚举；访问统一走 /api/files/<key>
 */
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "@/server/platform/config";

/** 支持的图片 MIME → 扩展名（与前端压缩输出对齐） */
export const IMAGE_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** 音频 MIME → 扩展名（语音动态：前端固定转 16k 单声道 wav 后上传） */
export const AUDIO_MIME_EXT: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** 上传根目录：UPLOAD_DIR（config 集中读取）；开发缺省 apps/api 运行目录下 .uploads/ */
export function uploadDir(): string {
  return loadConfig().uploadDir ?? join(process.cwd(), ".uploads");
}

/** wav 魔数嗅探：RIFF....WAVE */
export function sniffWavMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE") return "audio/wav";
  return null;
}

/** 魔数白名单嗅探（防改后缀）：jpeg/png/webp/gif；未知返回 null */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  // RIFF....WEBP
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** 生成 storage_key：yyyy/mm/uuid.ext（北京时间取年月） */
export function newStorageKey(mime: string): string {
  const ext = IMAGE_MIME_EXT[mime] ?? AUDIO_MIME_EXT[mime] ?? "jpg";
  const now = new Date(Date.now() + 8 * 3600_000);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/${randomUUID()}.${ext}`;
}

/** key → 磁盘路径；key 必须严格匹配生成规则（防目录穿越） */
export function storagePath(key: string): string {
  if (!/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|gif|wav)$/.test(key)) {
    throw new Error("illegal storage key");
  }
  return join(uploadDir(), key);
}

/** 写盘（递归建目录）。key 校验与读侧 storagePath 同源（二十轮纵深防御）：
 *  storage_key/audio_url 列若被未来导入路径污染，写/删侧不复用正则即可目录穿越 */
export async function saveImageFile(key: string, data: Buffer): Promise<void> {
  const p = storagePath(key);
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, data, { mode: 0o644 });
}

/** 删盘上文件（异步，失败仅记日志——行已删，孤儿文件无泄露风险）。
 *  key 非法（被污染列）时同样只告警不 unlink，调用方 fire-and-forget 语义不变（二十轮） */
export async function deleteImageFile(key: string): Promise<void> {
  try {
    await unlink(storagePath(key));
  } catch (e) {
    console.warn(`[storage] 删除文件失败（忽略）${key}:`, String(e).slice(0, 120));
  }
}

/** 路径扩展名 → Content-Type（004 FR-B2.1：MIME 表单源，files 静态托管与图片路由共用） */
export function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".json": "application/json",
    ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".webmanifest": "application/manifest+json", ".xml": "application/xml",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm", ".mp4": "video/mp4",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
    ".map": "application/json", ".md": "text/markdown; charset=utf-8",
  };
  return map[ext] ?? "application/octet-stream";
}
