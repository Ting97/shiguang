import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { wechatLoginSchema, loginByWechat } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/wechat/login —— {code} 一键登录：已绑定发会话，未绑定发一次性绑定票据（docs/15） */
export const POST = withSchema(wechatLoginSchema, async (req: NextRequest, { valid }) =>
  NextResponse.json(await loginByWechat({ code: valid.code, userAgent: req.headers.get("user-agent") })),
);
