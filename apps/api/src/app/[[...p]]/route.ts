/**
 * 静态站点托管：把 apps/web 静态导出产物（out/）经本服务同域提供。
 * - /_next/static/* 由 out/_next/static 读取，immutable 缓存
 * - 页面路径映射 <path>.html（/ → index.html），防目录穿越
 * - 目录由环境变量 STATIC_DIR 指定（standalone 部署时为 server.js 同级的 out/）
 * - 中间件仍先行：未登录页面照常 307 → /login
 */
import { NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

function staticDir(): string {
  return process.env.STATIC_DIR || join(process.cwd(), "out");
}

function fileStream(path: string): ReadableStream | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  // Readable.toWeb 的类型与 Next 期待的 ReadableStream 兼容（运行时为 WHATWG 流）
  return Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
}

function respond(path: string, req: Request): NextResponse {
  const immutable = path.includes(`${join("_next", "static")}`) || path.includes("_next/static");
  const stream = fileStream(path);
  if (!stream) return new NextResponse(null, { status: 404 });
  return new NextResponse(stream, {
    headers: {
      "Content-Type": MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: `"${statSync(path).size}-${statSync(path).mtimeMs}"`,
    },
  });
}

async function GET(req: Request) {
  const { pathname } = new URL(req.url);
  const dir = staticDir();
  const clean = normalize(decodeURIComponent(pathname)).replace(/\\/g, "/");
  if (clean.includes("..")) return new NextResponse(null, { status: 400 });

  const candidates: string[] = [];
  if (clean === "/" || clean === "") {
    candidates.push(join(dir, "index.html"));
  } else if (clean.endsWith("/")) {
    candidates.push(join(dir, clean, "index.html"), join(dir, clean.slice(0, -1) + ".html"));
  } else {
    candidates.push(join(dir, clean), join(dir, clean + ".html"), join(dir, clean, "index.html"));
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return respond(c, req);
  }
  const notFound = join(dir, "404.html");
  if (existsSync(notFound)) {
    return new NextResponse(Readable.toWeb(createReadStream(notFound)) as unknown as ReadableStream, {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new NextResponse(null, { status: 404 });
}

export { GET };
