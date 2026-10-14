import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withAuth(async (req, { user }) => {
  return NextResponse.json(await fitnessService.listGoals(user.id));
});

export const POST = withAuth(async (req, { user }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.createGoal(user.id, body));
});
