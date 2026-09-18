import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { analyzeAndPersist } from "@/lib/analyze";

export const runtime = "nodejs";

/**
 * POST /api/parse —— 发动态：**先落库秒回，识别随后后台进行**
 * 动态立即上墙（analyzed_at 为空 = 识别中）；五域识别（日程/关系/待办/收支/心情/饮食）
 * 在后台完成后自动写入各产物并打 analyzed_at，前端延迟刷新呈现。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text 必填" }, { status: 400 });
  }

  // 动态本体先落地（不含识别结果），请求即回
  const entry = (
    await pool.query(
      `insert into entries (user_id, source, raw_text) values ($1,'keyboard',$2)
       returning id, raw_text, created_at, analyzed_at`,
      [user.id, text.trim()],
    )
  ).rows[0];

  // 后台识别：不阻塞响应。standalone 常驻进程下 fire-and-forget 安全；
  // 无论成败都打 analyzed_at，失败时卡片五域状态条全为「·」，可手动重识别
  void analyzeAndPersist(user.id, entry.id, text.trim())
    .catch((e) => console.error(`[analyze] entry ${entry.id} 识别失败:`, e))
    .finally(() =>
      pool.query(`update entries set analyzed_at = now() where id = $1 and analyzed_at is null`, [entry.id]).catch(() => {}),
    );

  return NextResponse.json({ entry });
}
