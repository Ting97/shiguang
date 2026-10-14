import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withAuth(async (req, { user }) => {
  return NextResponse.json(await fitnessService.getProfile(user.id));
});

export const PUT = withAuth(async (req, { user }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.saveProfile(user.id, body));
});
