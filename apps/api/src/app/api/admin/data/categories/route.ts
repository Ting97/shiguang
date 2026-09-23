import { NextResponse } from "next/server";
import { withAdmin } from "@/server/platform/http/route";
import { categoriesPayload } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/data/categories —— 类别清单按域分组（FR-5.1） */
export const GET = withAdmin(async (_req, { user }) => {
  return NextResponse.json(await categoriesPayload(user.id));
});
