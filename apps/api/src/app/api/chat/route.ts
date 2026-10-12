import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, withAuthSchema } from "@/server/platform/http/route";
import { chatService } from "@/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat —— 会话列表 + 当日配额（首屏一次拉齐）；
 * GET /api/chat?id=<uuid> —— 单会话消息历史（点开历史会话时）。
 */
export const GET = withAuth(async (req, { user }) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) return NextResponse.json(await chatService.getConversation(user.id, id));
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
