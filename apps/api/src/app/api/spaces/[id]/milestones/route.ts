import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { milestoneService } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/spaces/:id/milestones —— 阶段目标全部列表（历史保留，active 在前） */
export const GET = withModuleParams("goal", async (_req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  return NextResponse.json(await milestoneService.list(user.id, id));
});

/** POST /api/spaces/:id/milestones —— 新建阶段目标 { title, targetDate? }（201） */
export const POST = withModuleParams("goal", async (req, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  const body = (await readJsonCapped(req) as any) as { title?: string; targetDate?: string | null };
  return NextResponse.json(await milestoneService.create(user.id, id, body), { status: 201 });
});
