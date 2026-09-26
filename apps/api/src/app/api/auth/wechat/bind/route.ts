import { NextRequest, NextResponse } from "next/server";
import { withSchema } from "@/server/platform/http/route";
import { wechatBindSchema, bindWechat } from "@/server/identity";

export const runtime = "nodejs";

/** POST /api/auth/wechat/bind —— {bindTicket, phone, smsCode} 短信验证码绑定微信并建会话（docs/15） */
export const POST = withSchema(wechatBindSchema, async (req: NextRequest, { valid }) =>
  NextResponse.json(
    await bindWechat({
      bindTicket: valid.bindTicket,
      phone: valid.phone,
      smsCode: valid.smsCode,
      userAgent: req.headers.get("user-agent"),
    }),
  ),
);
