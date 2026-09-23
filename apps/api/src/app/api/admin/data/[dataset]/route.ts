import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { queryDataset } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/data/[dataset]?from&to&category&limit&offset —— 在线试查（FR-5.2，只读） */
export const GET = withAuthParams(async (req, { user, params }) => {
  if (user.role !== "admin") throw ApiError.forbidden("仅管理员");
  const { dataset } = await params;
  const sp = new URL(req.url).searchParams;
  const r = await queryDataset(user.id, dataset, {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    category: sp.get("category") ?? undefined,
    limit: Number(sp.get("limit") ?? 200),
    offset: Number(sp.get("offset") ?? 0),
  });
  return NextResponse.json(r);
});
