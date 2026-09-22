import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { setupSchema, setup } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/setup —— 初始化管理员（4-B：SETUP_TOKEN 一次性令牌防护） */
export const POST = withSchema(setupSchema, async (req: NextRequest, { valid }) =>
  NextResponse.json(
    await setup(valid, req.headers.get("x-setup-token"), req.headers.get("user-agent")),
  ),
);
