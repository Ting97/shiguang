import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** REQ-024 睡眠独立记录（每日一条）：GET 区间序列；POST 按日 upsert（hours 小时，同日重录=更新） */
export const GET = withModule("sleep", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const from = sp.get("from") ?? to;
  return NextResponse.json(await fitnessService.listSleep(user.id, from, to));
});

export const POST = withModule("sleep", async (req, { user }) => {
  const body = await readJsonCapped(req) as any;
  return NextResponse.json(await fitnessService.saveSleep(user.id, body));
});
