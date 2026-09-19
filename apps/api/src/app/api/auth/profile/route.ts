import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth-crypto";

export const runtime = "nodejs";

/**
 * PATCH /api/auth/profile —— 个性化设置
 * {nickname} 改昵称；{currentPassword, newPassword} 改密码（从未设过密码的账号可免填当前密码）
 */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    nickname?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  const wantsNickname = body.nickname !== undefined;
  const wantsPassword = body.newPassword !== undefined;
  if (!wantsNickname && !wantsPassword) {
    return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
  }

  // ---- 改昵称 ----
  let nickname: string | undefined;
  if (wantsNickname) {
    nickname = body.nickname!.trim();
    if (!nickname || nickname.length > 20) {
      return NextResponse.json({ error: "昵称需为 1~20 个字符" }, { status: 400 });
    }
    await pool.query(`update profiles set nickname = $1 where id = $2`, [nickname, user.id]);
  }

  // ---- 改密码 ----
  let message: string | undefined;
  if (wantsPassword) {
    if (body.newPassword!.length < 8) {
      return NextResponse.json({ error: "新密码至少 8 位" }, { status: 400 });
    }
    const { rows } = await pool.query(`select password_hash from profiles where id = $1`, [user.id]);
    const stored: string | null = rows[0]?.password_hash ?? null;
    if (stored && (!body.currentPassword || !verifyPassword(body.currentPassword, stored))) {
      return NextResponse.json({ error: "当前密码不正确" }, { status: 401 });
    }
    await pool.query(`update profiles set password_hash = $1 where id = $2`, [
      hashPassword(body.newPassword!),
      user.id,
    ]);
    message = "密码已更新";
  }

  return NextResponse.json({ ok: true, nickname, message });
}
