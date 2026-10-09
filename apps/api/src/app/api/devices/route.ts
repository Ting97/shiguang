import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { withAuth, withAuthSchema } from "@/server/platform/http/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  platform: z.enum(["ios", "android"]),
  /** ExpoPushToken（ExponentPushToken[...]）或原生 FCM/APNs token，长度放宽兼容两类 */
  token: z.string().min(8).max(4096),
});

/**
 * POST /api/devices —— 移动端推送 token 注册/更新（REQ-009 9-D）
 * 幂等 upsert：同一 token 重复注册刷新 last_seen_at；换号登录改属主（token 全局唯一）
 */
export const POST = withAuthSchema(registerSchema, async (_req, { user, valid }) => {
  // 属主守卫：token 已绑他人时不得静默顶掉（否则知悉 token 即可把受害者的设备改收攻击者账号的推送）
  const held = await pool.query(`select user_id from device_tokens where token = $1`, [valid.token]);
  if (held.rows[0] && held.rows[0].user_id !== user.id) {
    throw ApiError.conflict("该设备推送已绑定其他账号，请先在原账号注销");
  }
  await pool.query(
    `insert into device_tokens (user_id, platform, token)
     values ($1, $2, $3)
     on conflict (token) do update set
       user_id = excluded.user_id,
       platform = excluded.platform,
       enabled = true,
       last_seen_at = now()`,
    [user.id, valid.platform, valid.token],
  );
  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/devices —— 注销（body JSON {token?}；幂等）：
 * 带 token 只删本人名下该条；不带 token 删本人全部（客户端缓存丢失的兜底）。
 */
export const DELETE = withAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token) {
    await pool.query(`delete from device_tokens where user_id = $1 and token = $2`, [user.id, token]);
  } else {
    await pool.query(`delete from device_tokens where user_id = $1`, [user.id]);
  }
  return NextResponse.json({ ok: true });
});
