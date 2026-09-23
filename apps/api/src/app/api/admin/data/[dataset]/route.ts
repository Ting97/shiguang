import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { queryDataset, writeAuditRecord, type AuditRecord } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/data/[dataset]?from&to&category&limit&offset —— 在线试查（FR-5.2，只读） */
export const GET = withAuthParams(async (req, { user, params }) => {
  if (user.role !== "admin") throw ApiError.forbidden("仅管理员");
  const { dataset } = await params;
  const sp = new URL(req.url).searchParams;
  const startedAt = Date.now();
  const r = await queryDataset(user.id, dataset, {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    category: sp.get("category") ?? undefined,
    limit: Number(sp.get("limit") ?? 200),
    offset: Number(sp.get("offset") ?? 0),
  });
  // FR-5.5：audit 只记数据集 key 与条数（engine=key / text_len=total），不记查询与结果内容；
  // 与既有模式一致不阻塞返回（写失败由 writeAuditRecord 内部兜底）
  void writeAuditRecord({
    userId: user.id,
    entryId: null,
    // audit.ts 的 stage 联合类型未含 admin_data（本批不可改 audit.ts），DB 侧 stage 为自由 text
    stage: "admin_data" as unknown as AuditRecord["stage"],
    model: null,
    engine: `admin-data:${dataset}`,
    latencyMs: Date.now() - startedAt,
    textLen: r.total,
    ok: true,
  });
  return NextResponse.json(r);
});
