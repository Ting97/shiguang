import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withModule("fitness", async (req, { user }) => {
  return NextResponse.json(await fitnessService.listGoals(user.id));
});

export const POST = withModule("fitness", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.createGoal(user.id, body));
});
