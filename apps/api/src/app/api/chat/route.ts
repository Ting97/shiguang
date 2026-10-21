import { NextResponse } from "next/server";
import { z } from "zod";
import { withModule, withModuleSchema } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam, isUuid } from "@/server/platform/http/validate";
import { chatService, parseScope } from "@/server/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chat —— 会话列表 + 当日配额（首屏一次拉齐）；?scope= 域过滤（REQ-019 FR-C1）；
 * GET /api/chat?id=<uuid> —— 单会话消息（分页：默认最近 6 条=3 轮，before=上一页游标向前翻）。
 */
export const GET = withModule("ai", async (req, { user }) => {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (id) {
    assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
    const before = sp.get("before") ?? undefined;
    const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
    if (before !== undefined && !isUuid(before)) throw ApiError.badRequest("翻页游标无效"); // 同上：旧宽松正则放行畸形串
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 2 || limit > 50)) {
      throw ApiError.badRequest("limit 需为 2~50 整数");
    }
    return NextResponse.json(await chatService.getConversation(user.id, id, { before, limit }));
  }
  const scope = parseScope(sp.get("scope"));
  return NextResponse.json(await chatService.listConversations(user.id, scope === "global" ? undefined : scope));
});

const sendSchema = z.object({
  /** 不传 = 新建会话（首句前 20 字作标题） */
  conversationId: z.string().uuid().optional(),
  text: z.string().trim().min(1, "消息不能为空").max(2000, "消息最长 2000 字"),
  /** 会话域（REQ-019 FR-C1）：新会话按此落域；已有会话须与库中一致 */
  scope: z.enum(["global", "goal", "time", "people", "finance", "fitness"]).optional(),
});

/** POST /api/chat —— 发送消息，AI 工具循环查库后回答（MVP 非流式；LLM+查询总预算 60s，客户端超时需放宽） */
export const POST = withModuleSchema("ai", sendSchema, async (_req, { user, valid }) => {
  const r = await chatService.sendMessage(user.id, valid);
  return NextResponse.json(r);
});
