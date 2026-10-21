import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withModule("fitness", async (req, { user }) => {
  return NextResponse.json(await fitnessService.getProfile(user.id));
});

export const PUT = withModule("fitness", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.saveProfile(user.id, body));
});
