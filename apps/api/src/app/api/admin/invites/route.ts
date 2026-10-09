import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { createInvite, listInvites } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requireAdmin = (role: string) => {
  if (role !== "admin") throw ApiError.forbidden("仅管理员可管理邀请码");
};

/** GET /api/admin/invites —— 管理员查看邀请码（最近 50 个；自 auth/invites 迁移，旧地址保留别名） */
export const GET = withAuth(async (_req, { user }) => {
  requireAdmin(user.role);
  return NextResponse.json({ invites: await listInvites() });
});

/** POST /api/admin/invites {days?: 7} —— 管理员生成邀请码 */
export const POST = withAuth(async (req, { user }) => {
  requireAdmin(user.role);
  const { days = 7 } = (await req.json().catch(() => ({}))) as { days?: number };
  return NextResponse.json({ ok: true, invite: await createInvite(user.id, days) });
});
