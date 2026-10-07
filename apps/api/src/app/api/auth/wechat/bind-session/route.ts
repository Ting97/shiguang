import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import {
  bindSessionByWechat,
  bindSessionForceCurrent,
  bindSessionSwitchToOwner,
} from "@/server/identity";

export const runtime = "nodejs";

/**
 * POST /api/auth/wechat/bind-session —— 已登录账号绑定当前微信。
 * body: { code, resolve?: "current" | "wechat" }
 * - 无 resolve：正常绑定；openid 被有数据的账号占用时返回 409 { code: "wechat_bind_conflict", owner, current }
 *   （双方数据概览，前端弹「保留哪份数据」选择；空壳仍自动回收，见 wechat.ts）
 * - resolve=current：保留当前账号——微信从占用方解绑并绑到当前账号（占用方数据原地保留）
 * - resolve=wechat：保留微信账号的数据——本次会话切换为微信绑定的账号（发对方新 token）
 */
export const POST = withAuth(async (req: NextRequest, { user }) => {
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; resolve?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 512) {
    return NextResponse.json({ error: "code 无效", code: "invalid_input" }, { status: 400 });
  }
  const resolve = body.resolve === "current" || body.resolve === "wechat" ? body.resolve : undefined;
  const userAgent = req.headers.get("user-agent");

  if (resolve === "current") {
    return NextResponse.json(await bindSessionForceCurrent({ code, userId: user.id }));
  }
  if (resolve === "wechat") {
    return NextResponse.json(await bindSessionSwitchToOwner({ code, userAgent }));
  }

  const result = await bindSessionByWechat({ code, userId: user.id, userAgent });
  if (result.status === "conflict") {
    return NextResponse.json(
      {
        error: "该微信已绑定其他账号",
        code: "wechat_bind_conflict",
        owner: result.owner,
        current: result.current,
      },
      { status: 409 },
    );
  }
  return NextResponse.json(result);
});
