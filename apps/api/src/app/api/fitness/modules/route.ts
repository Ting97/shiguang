import { NextResponse } from "next/server";
import { withModule } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withModule("fitness", async () => {
  return NextResponse.json(await fitnessService.listModules());
});
