import { NextResponse } from "next/server";
import { withModuleParams, readJsonCapped } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { milestoneService } from "@/server/goal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/spaces/:id/milestones/:mid —— 编辑/达成/放弃 { title?, targetDate?, status? } */
export const PATCH = withModuleParams("goal", async (req, { user, params }) => {
  const { id, mid } = await params;
  assertUuidParam(id, "id");
  assertUuidParam(mid, "mid");
  const body = (await readJsonCapped(req) as any) as {
    title?: string;
    targetDate?: string | null;
    status?: "active" | "done" | "abandoned";
  };
  return NextResponse.json(await milestoneService.update(user.id, mid, body, id));
});
