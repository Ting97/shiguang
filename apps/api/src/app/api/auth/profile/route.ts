import { NextResponse } from "next/server";
import { withAuthSchema } from "@/server/platform/http/route";
import { profileSchema, updateProfile } from "@/server/identity";

export const runtime = "nodejs";

/**
 * PATCH /api/auth/profile —— 个性化设置
 * {nickname} 改昵称；{currentPassword, newPassword} 改密码（从未设过密码的账号可免填当前密码）
 */
export const PATCH = withAuthSchema(profileSchema, async (_req, { user, valid }) =>
  NextResponse.json(await updateProfile(user.id, valid)),
);
