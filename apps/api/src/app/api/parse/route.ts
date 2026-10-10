import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuthSchema } from "@/server/platform/http/route";
import { ingest } from "@/server/timeline";

export const runtime = "nodejs";

const schema = z.object({
  text: z.string().min(1, "text 必填").max(2000, "动态最长 2000 字"),
  // 语音动态：录音转写发布时标记来源（entries.source 枚举含 voice）
  source: z.enum(["keyboard", "voice"]).optional(),
});

/** POST /api/parse —— 发动态：本体先落库秒回，后台五域识别 */
export const POST = withAuthSchema(schema, async (_req, { user, valid }) =>
  NextResponse.json(await ingest(user.id, valid.text, valid.source)),
);
