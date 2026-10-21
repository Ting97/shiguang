import { NextResponse } from "next/server";
import { withAdmin, readJsonCapped } from "@/server/platform/http/route";
import { createInvite, listInvites } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/invites —— 管理员查看邀请码（最近 50 个；新地址 /api/admin/invites，此处保留别名，实现单源在 identity 域） */
export const GET = withAdmin(async (_req) => {
  return NextResponse.json({ invites: await listInvites() });
});

/** POST /api/auth/invites —— 管理员生成邀请码 {days?: 7}（别名路由） */
export const POST = withAdmin(async (req, { user }) => {
  const { days = 7 } = (await readJsonCapped(req) as any) as { days?: number };
  return NextResponse.json({ ok: true, invite: await createInvite(user.id, days) });
});
