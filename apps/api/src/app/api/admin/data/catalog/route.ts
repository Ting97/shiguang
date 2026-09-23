import { NextResponse } from "next/server";
import { withAdmin } from "@/server/platform/http/route";
import { catalogPayload } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/data/catalog —— 数据集目录（FR-5.3，含 promptRefs 静态映射） */
export const GET = withAdmin(async () => {
  return NextResponse.json(catalogPayload());
});
