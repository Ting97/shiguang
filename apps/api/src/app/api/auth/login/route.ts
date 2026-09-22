import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { loginSchema, login, clientIp } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/login —— 双身份三凭证登录（4-B：双层防护 + 模糊文案） */
export const POST = withSchema(loginSchema, async (req: NextRequest, { valid }) =>
  NextResponse.json(
    await login({ ...valid, ip: clientIp(req), userAgent: req.headers.get("user-agent") }),
  ),
);
