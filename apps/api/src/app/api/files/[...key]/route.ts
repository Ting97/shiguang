import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { pool } from "@/server/platform/db";
import { storagePath, mimeForPath } from "@/server/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/files/<yyyy/mm/uuid.ext> —— 图片访问门禁
 * 登录 → 按 storage_key 查 entry_images（无记录 404 / 他人 403）→ 流式返回
 * uuid key 不可枚举；immutable 私有缓存；ETag 走 304
 */
export const GET = withAuthParams(async (req, { user, params }) => {
  const { key } = (await params) as { key: string[] };
  const storageKey = (key ?? []).join("/");

  const row = (
    await pool.query(`select id, user_id, mime from entry_images where storage_key = $1`, [storageKey])
  ).rows[0];
  if (!row) throw new ApiError(404, "not_found", "文件不存在");
  if (row.user_id !== user.id) throw ApiError.forbidden("无权访问");

  let path: string;
  try {
    path = storagePath(storageKey);
  } catch {
    throw new ApiError(400, "invalid_input", "非法路径");
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new ApiError(404, "not_found", "文件不存在");
  }

  const stat = statSync(path);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304 });
  }
  const mime = mimeForPath(path) === "application/octet-stream" ? row.mime ?? "application/octet-stream" : mimeForPath(path);
  return new NextResponse(Readable.toWeb(createReadStream(path)) as unknown as ReadableStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
    },
  });
});
