import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** GET /api/fitness/exercises?module=run|strength —— 动作库目录（含肌群与收益） */
export const GET = withModule("fitness", async (req) => {
  const mod = new URL(req.url).searchParams.get("module");
  return NextResponse.json(await fitnessService.listExercises(mod));
});
