import { NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { z } from "zod";
import { sendEmail } from "@/server/identity";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().optional(),
  purpose: z.enum(["login", "bind"]).default("login"),
});

/** POST /api/auth/email/send —— {email, purpose?} 发送邮箱验证码 */
export const POST = withSchema(schema, async (_req, { valid }) =>
  NextResponse.json(await sendEmail(valid)),
);
