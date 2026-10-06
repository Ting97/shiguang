import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { wechatLoginSchema, loginByWechat } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/wechat/login —— {code, profile?} 一键登录：已绑定发会话；未绑定自动建号（免绑手机号） */
export const POST = withSchema(wechatLoginSchema, async (req: NextRequest, { valid }) =>
  NextResponse.json(await loginByWechat({ code: valid.code, profile: valid.profile, userAgent: req.headers.get("user-agent") })),
);
