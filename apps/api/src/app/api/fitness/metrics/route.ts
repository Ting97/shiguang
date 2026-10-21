import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

export const GET = withModule("fitness", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? to;
  return NextResponse.json(await fitnessService.listMetrics(user.id, from, to));
});

export const POST = withModule("fitness", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.saveMetric(user.id, body));
});
