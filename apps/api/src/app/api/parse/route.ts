import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthSchema } from "@/server/platform/http/route";
import { ingest } from "@/server/timeline";

export const runtime = "nodejs";

const schema = z.object({ text: z.string().min(1, "text 必填") });

/** POST /api/parse —— 发动态：本体先落库秒回，后台五域识别 */
export const POST = withAuthSchema(schema, async (_req, { user, valid }) =>
  NextResponse.json(await ingest(user.id, valid.text)),
);
