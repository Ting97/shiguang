import { NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { z } from "zod";
import { sendSms } from "@/server/identity";

export const runtime = "nodejs";

const schema = z.object({
  phone: z.string().optional(),
  purpose: z.enum(["login", "bind"]).default("login"),
});

/** POST /api/auth/sms/send —— {phone, purpose?} 发送验证码；同号 60s/次、日 10 条 */
export const POST = withSchema(schema, async (_req, { valid }) =>
  NextResponse.json(await sendSms(valid)),
);
