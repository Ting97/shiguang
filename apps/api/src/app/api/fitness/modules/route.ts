import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withAuth(async () => {
  return NextResponse.json(await fitnessService.listModules());
});
