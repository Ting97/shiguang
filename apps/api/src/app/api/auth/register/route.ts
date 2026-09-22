import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { registerSchema, register } from "@/server/identity";

export const runtime = "nodejs";

/**
 * POST /api/auth/register —— 邀请码注册，双身份二选一（通道已配置时须验证码）
 */
export const POST = withSchema(registerSchema, async (req: NextRequest, { valid }) =>
  NextResponse.json(await register({ ...valid, userAgent: req.headers.get("user-agent") })),
);
