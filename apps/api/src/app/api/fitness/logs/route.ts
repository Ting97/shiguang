import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withAuth(async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? to;
  return NextResponse.json(await fitnessService.listLogs(user.id, from, to));
});

export const POST = withAuth(async (req, { user }) => {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await fitnessService.addLog(user.id, body));
});
