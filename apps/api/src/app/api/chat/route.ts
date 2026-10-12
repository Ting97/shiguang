import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, withAuthSchema } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { chatService } from "@/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat —— 会话列表 + 当日配额（首屏一次拉齐）；
 * GET /api/chat?id=<uuid> —— 单会话消息（分页：默认最近 6 条=3 轮，before=上一页游标向前翻）。
 */
export const GET = withAuth(async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (id) {
    const before = sp.get("before") ?? undefined;
    const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
    if (before && !/^[0-9a-f-]{36}$/i.test(before)) throw ApiError.badRequest("翻页游标无效");
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 2 || limit > 50)) {
      throw ApiError.badRequest("limit 需为 2~50 整数");
    }
    return NextResponse.json(await chatService.getConversation(user.id, id, { before, limit }));
  }
  return NextResponse.json(await chatService.listConversations(user.id));
});

const sendSchema = z.object({
  /** 不传 = 新建会话（首句前 20 字作标题） */
  conversationId: z.string().uuid().optional(),
  text: z.string().trim().min(1, "消息不能为空").max(2000, "消息最长 2000 字"),
});

/** POST /api/chat —— 发送消息，AI 工具循环查库后回答（MVP 非流式；LLM+查询总预算 60s，客户端超时需放宽） */
export const POST = withAuthSchema(sendSchema, async (_req, { user, valid }) => {
  const r = await chatService.sendMessage(user.id, valid);
  return NextResponse.json(r);
});
