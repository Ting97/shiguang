import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { createContact, listContacts } from "@/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/contacts —— 联系人列表（含互动次数/最近往来/人情往来净额） */
export const GET = withAuth(async (_req, { user }) => NextResponse.json(await listContacts(user.id)));

/** POST /api/contacts —— 手动建档 */
export const POST = withAuth(async (req, { user }) =>
  NextResponse.json(await createContact(user.id, await req.json().catch(() => ({})))),
);
