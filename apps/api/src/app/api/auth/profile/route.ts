import { NextResponse } from "next/server";
import { withAuthSchema } from "@/server/platform/http/route";
import { extractBearerToken } from "@shiguangri/shared/bearer";

import { SESSION_COOKIE, profileSchema, updateProfile } from "@/server/identity";

export const runtime = "nodejs";

/**
 * PATCH /api/auth/profile —— 个性化设置
 * {nickname} 改昵称；{currentPassword, newPassword} 改密码（从未设过密码的账号可免填当前密码）。
 * 改密成功后服务端会吊销其余全部会话（保留当前会话，见 updateProfile）。
 */
export const PATCH = withAuthSchema(profileSchema, async (req, { user, valid }) => {
  const keepToken =
    extractBearerToken(req.headers.get("authorization")) ?? req.cookies.get(SESSION_COOKIE)?.value ?? null;
  return NextResponse.json(await updateProfile(user.id, valid, { keepToken }));
});
