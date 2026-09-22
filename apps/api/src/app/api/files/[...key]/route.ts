import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { getCurrentUser } from "@/server/identity/auth";
import { pool } from "@/server/platform/db";
import { storagePath } from "@/server/timeline/storage";
import { Readable } from "node:stream";
import { extname } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * GET /api/files/<yyyy/mm/uuid.ext> —— 图片访问门禁
 * 登录 → 按 storage_key 查 entry_images（无记录 404 / 他人 403）→ 流式返回
 * uuid key 不可枚举；immutable 私有缓存；ETag 走 304
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { key } = await params;
  const storageKey = (key ?? []).join("/");

  const row = (
    await pool.query(`select id, user_id, mime from entry_images where storage_key = $1`, [storageKey])
  ).rows[0];
  if (!row) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  if (row.user_id !== user.id) return NextResponse.json({ error: "无权访问" }, { status: 403 });

  let path: string;
  try {
    path = storagePath(storageKey);
  } catch {
    return NextResponse.json({ error: "非法路径" }, { status: 400 });
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const stat = statSync(path);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304 });
  }
  const mime = MIME[extname(path).toLowerCase()] ?? row.mime ?? "application/octet-stream";
  return new NextResponse(Readable.toWeb(createReadStream(path)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}
