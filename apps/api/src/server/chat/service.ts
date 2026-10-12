/**
 * chat 域服务编排（REQ-015 批次 A）：会话/消息 CRUD + 问答主链路。
 * 问答链路：配额检查 → 会话定位 → 落用户消息 → 装配 system（人设 + 当前时间/画像上下文，
 * 经 ai_prompts 纳管热更）→ chatAgent 工具循环（8 只读工具查库）→ 落助手消息 → 写审计。
 * 失败口径：用户消息保留（可重发），助手消息缺失即失败标记；quota/rate 类 GLM 错误转 503 友好文案。
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { activeModel, chatAgent, toCstWallClock, type AgentTurn } from "@shiguangri/ai";
import { assembleUserPrompt, getPromptBundle, writeAuditRecord } from "@/server/ai";
import { toAgentTools, TOOL_LABELS, type ChatToolCtx } from "./tools";
import { checkChatQuota, getChatQuota, FREE_CHAT_CALLS_PER_DAY, type ChatQuotaInfo } from "./chat-quota";

/** 注入模型的对话历史长度上限（user+assistant 计数；更早历史丢弃——MVP 不做摘要压缩） */
const HISTORY_LIMIT = 20;

export interface ConversationDTO {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ChatMessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** assistant 行的工具调用轨迹（[{name,args}]，展示用） */
  toolCalls?: Array<{ name: string; args: unknown }>;
  createdAt: string;
}

export interface ChatToolTraceItem {
  name: string;
  /** 中文摘要（前端「已查询：收支流水」展示） */
  label: string;
  args: unknown;
}

/** 会话列表 + 当日配额（首屏一次拉齐） */
export async function listConversations(userId: string): Promise<{ conversations: ConversationDTO[]; quota: ChatQuotaInfo }> {
  const { rows } = await pool.query(
    `select id, title, to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as updated_bj
     from chat_conversations
     where user_id = $1 and deleted_at is null
     order by updated_at desc limit 50`,
    [userId],
  );
  return {
    conversations: rows.map((r: { id: string; title: string; updated_bj: string }) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updated_bj,
    })),
    quota: await getChatQuota(userId),
  };
}

/** 单会话详情（属主校验：他人/已删会话一律 404，不泄露存在性） */
export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<{ conversation: ConversationDTO; messages: ChatMessageDTO[] }> {
  const { rows: convs } = await pool.query(
    `select id, title, to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as updated_bj
     from chat_conversations where id = $1 and user_id = $2 and deleted_at is null`,
    [conversationId, userId],
  );
  if (!convs.length) throw ApiError.notFound("会话不存在");
  const { rows } = await pool.query(
    `select id, role, content, tool_calls, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj
     from chat_messages where conversation_id = $1 and user_id = $2
     order by created_at asc limit 200`,
    [conversationId, userId],
  );
  return {
    conversation: { id: convs[0].id, title: convs[0].title, updatedAt: convs[0].updated_bj },
    messages: rows.map((r: any) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      ...(Array.isArray(r.tool_calls) ? { toolCalls: r.tool_calls } : {}),
      createdAt: r.created_bj,
    })),
  };
}

export interface SendMessageResult {
  conversationId: string;
  conversationTitle: string;
  userMessage: ChatMessageDTO;
  reply: ChatMessageDTO;
  toolTrace: ChatToolTraceItem[];
  quota: ChatQuotaInfo;
}

/** 发送消息并取得助手回答（含工具查询轨迹）；免费用户当日次数耗尽抛 402 */
export async function sendMessage(
  userId: string,
  input: { conversationId?: string; text: string },
): Promise<SendMessageResult> {
  const text = input.text.trim();
  if (!text || text.length > 2000) throw ApiError.badRequest("消息长度须为 1~2000 字");

  const quotaCheck = await checkChatQuota(userId);
  if (!quotaCheck.allowed) {
    throw ApiError.quota(`今日 AI 助手次数已用完（免费版每天 ${FREE_CHAT_CALLS_PER_DAY} 次），明天再来或升级 Pro`);
  }

  // 会话定位：传入 id 则校验属主；否则以首句前 20 字为标题新建
  let conversationId: string;
  let conversationTitle: string;
  if (input.conversationId) {
    const { rows } = await pool.query(
      `select id, title from chat_conversations where id = $1 and user_id = $2 and deleted_at is null`,
      [input.conversationId, userId],
    );
    if (!rows.length) throw ApiError.notFound("会话不存在");
    conversationId = rows[0].id;
    conversationTitle = rows[0].title;
  } else {
    const title = text.replace(/\s+/g, " ").slice(0, 20) || "新对话";
    const { rows } = await pool.query(
      `insert into chat_conversations (user_id, title) values ($1, $2) returning id, title`,
      [userId, title],
    );
    conversationId = rows[0].id;
    conversationTitle = rows[0].title;
  }

  const { rows: insertedUser } = await pool.query(
    `insert into chat_messages (conversation_id, user_id, role, content)
     values ($1, $2, 'user', $3)
     returning id, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj`,
    [conversationId, userId, text],
  );
  const userMessage: ChatMessageDTO = {
    id: insertedUser[0].id,
    role: "user",
    content: text,
    createdAt: insertedUser[0].created_bj,
  };

  // 对话历史（含刚落的这条）：最近 HISTORY_LIMIT 条 user/assistant 文本
  const { rows: historyRows } = await pool.query(
    `select role, content from chat_messages
     where conversation_id = $1 and user_id = $2 and role in ('user','assistant') and content <> ''
     order by created_at desc limit $3`,
    [conversationId, userId, HISTORY_LIMIT],
  );
  const turns: AgentTurn[] = historyRows
    .slice()
    .reverse()
    .map((r: { role: string; content: string }) => ({
      role: r.role === "assistant" ? "assistant" : "user",
      content: r.content,
    }));

  // system = 纳管的人设 + 上下文块（当前北京时间；画像数据集可经 ai_prompts context_config 配置注入）
  const bundle = await getPromptBundle("chat_assistant");
  const ctxBlock = await assembleUserPrompt("chat_assistant", bundle, { nowCst: toCstWallClock(new Date()) }, { userId });
  const system = ctxBlock ? `${bundle.system}\n\n${ctxBlock}` : bundle.system;

  const startedAt = Date.now();
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  try {
    const res = await chatAgent({
      system,
      messages: turns,
      tools: toAgentTools({ userId } satisfies ChatToolCtx),
      maxSteps: 5,
      timeoutMs: 60_000,
      onUsage: (u) => { usage = u; },
    });
    const toolTrace: ChatToolTraceItem[] = res.toolCalls.map((tc) => ({
      name: tc.name,
      label: TOOL_LABELS[tc.name] ?? tc.name,
      args: tc.args,
    }));
    const { rows: insertedReply } = await pool.query(
      `insert into chat_messages (conversation_id, user_id, role, content, tool_calls)
       values ($1, $2, 'assistant', $3, $4::jsonb)
       returning id, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj`,
      [conversationId, userId, res.text, JSON.stringify(toolTrace)],
    );
    await pool.query(`update chat_conversations set updated_at = now() where id = $1`, [conversationId]);
    await writeAuditRecord({
      userId,
      stage: "chat",
      model: activeModel(),
      latencyMs: Date.now() - startedAt,
      textLen: res.text.length,
      ok: true,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
    return {
      conversationId,
      conversationTitle,
      userMessage,
      reply: {
        id: insertedReply[0].id,
        role: "assistant",
        content: res.text,
        toolCalls: toolTrace,
        createdAt: insertedReply[0].created_bj,
      },
      toolTrace,
      quota: await getChatQuota(userId),
    };
  } catch (e) {
    // 失败也计量（ok=false）：用户消息已保留，配额只扣成功调用（口径与 ai 域一致）
    await writeAuditRecord({
      userId,
      stage: "chat",
      model: activeModel(),
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: String(e).slice(0, 200),
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
    const msg = String((e as Error)?.message ?? e);
    if (/额度熔断|quota|429|限流/.test(msg)) {
      throw ApiError.upstream("AI 服务暂时不可用（限流/额度），请稍后再试");
    }
    throw e;
  }
}

/** 会话改名 */
export async function renameConversation(userId: string, conversationId: string, title: string): Promise<void> {
  const t = title.trim();
  if (!t || t.length > 30) throw ApiError.badRequest("标题长度须为 1~30 字");
  const { rowCount } = await pool.query(
    `update chat_conversations set title = $3, updated_at = now()
     where id = $1 and user_id = $2 and deleted_at is null`,
    [conversationId, userId, t],
  );
  if (!rowCount) throw ApiError.notFound("会话不存在");
}

/** 会话软删（历史保留审计追溯，列表不再显示） */
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `update chat_conversations set deleted_at = now()
     where id = $1 and user_id = $2 and deleted_at is null`,
    [conversationId, userId],
  );
  if (!rowCount) throw ApiError.notFound("会话不存在");
}

/** 路由统一服务出口（路由文件只做 解析入参 → 调 service → 返回） */
export const chatService = {
  listConversations,
  getConversation,
  sendMessage,
  renameConversation,
  deleteConversation,
};
