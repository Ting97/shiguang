/**
 * chat 域服务编排（REQ-015 批次 A）：会话/消息 CRUD + 问答主链路。
 * 问答链路：配额检查 → 会话定位 → 落用户消息 → 装配 system（人设 + 当前时间/画像上下文，
 * 经 ai_prompts 纳管热更）→ chatAgent 工具循环（8 只读工具查库）→ 落助手消息 → 写审计。
 * 失败口径：用户消息保留（可重发），助手消息缺失即失败标记；quota/rate 类 GLM 错误转 503 友好文案。
 */
import { pool } from "@/server/platform/db";
import { ApiError } from "@/server/platform/http/errors";
import { activeModel, chatAgent, toCstWallClock, type AgentTurn } from "@shiguangri/ai";
import { assembleUserPrompt, getPromptBundle, writeAuditRecord, type PromptKey } from "@/server/ai";
import { toAgentTools, TOOL_LABELS, CHAT_SCOPES, type ChatScope, type ChatToolCtx } from "./tools";
import { acquireChatQuota, releaseChatQuota, getChatQuota, FREE_CHAT_CALLS_PER_DAY, type ChatQuotaInfo } from "./chat-quota";

/** 注入模型的对话历史长度上限（user+assistant 计数；更早历史丢弃——MVP 不做摘要压缩） */
const HISTORY_LIMIT = 20;

/** 会话域 → 人设 PromptKey（REQ-019 FR-C3；global 用全局 chat_assistant） */
const SCOPE_PROMPT_KEY: Record<ChatScope, PromptKey> = {
  global: "chat_assistant",
  goal: "chat_goal",
  time: "chat_time",
  people: "chat_people",
  finance: "chat_finance",
  fitness: "chat_fitness_coach",
};

/** 白名单校验（路由/服务共用）：非法值 400 */
export function parseScope(v: unknown): ChatScope {
  if (v == null || v === "") return "global";
  if (typeof v === "string" && (CHAT_SCOPES as readonly string[]).includes(v)) return v as ChatScope;
  throw ApiError.badRequest("scope 需为 global/goal/time/people/finance/fitness");
}

export interface ConversationDTO {
  id: string;
  title: string;
  scope: ChatScope;
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

/** 会话列表 + 当日配额（首屏一次拉齐）；scope 传入时只回该域会话（REQ-019 FR-C1） */
export async function listConversations(userId: string, scope?: ChatScope): Promise<{ conversations: ConversationDTO[]; quota: ChatQuotaInfo }> {
  const { rows } = await pool.query(
    `select id, title, scope, to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as updated_bj
     from chat_conversations
     where user_id = $1 and deleted_at is null and ($2::text is null or scope = $2::text)
     order by updated_at desc, id desc limit 50`,
    [userId, scope ?? null],
  );
  return {
    conversations: rows.map((r: { id: string; title: string; scope: string; updated_bj: string }) => ({
      id: r.id,
      title: r.title,
      scope: (CHAT_SCOPES as readonly string[]).includes(r.scope) ? (r.scope as ChatScope) : "global",
      updatedAt: r.updated_bj,
    })),
    quota: await getChatQuota(userId),
  };
}

/** 单会话详情（属主校验：他人/已删会话一律 404，不泄露存在性）。
 * 分页（REQ-015 追加：加快打开）：默认只回最近 6 条（3 轮），更早经 before 游标向前翻页。
 * REQ-016：响应附 proposals（本会话 A.5 确认卡：pending 在前 + 近期已决），前端渲染计划卡片 */
export async function getConversation(
  userId: string,
  conversationId: string,
  opts?: { before?: string; limit?: number },
): Promise<{
  conversation: ConversationDTO;
  messages: ChatMessageDTO[];
  hasMore: boolean;
  /** 当前页最早一条消息 id——上一页游标；无更多或空会话时 null */
  oldestId: string | null;
  proposals: ChatProposalDTO[];
}> {
  const { rows: convs } = await pool.query(
    `select id, title, scope, to_char(updated_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI') as updated_bj
     from chat_conversations where id = $1 and user_id = $2 and deleted_at is null`,
    [conversationId, userId],
  );
  if (!convs.length) throw ApiError.notFound("会话不存在");

  const limit = Math.min(Math.max(opts?.limit ?? 6, 2), 50);
  // 游标解析为 (created_at, id) 行比较——同毫秒多条也能稳定切页
  let cursorTs: string | null = null;
  if (opts?.before) {
    const { rows: anchor } = await pool.query(
      `select created_at from chat_messages
       where id = $1 and conversation_id = $2 and user_id = $3`,
      [opts.before, conversationId, userId],
    );
    if (!anchor.length) throw ApiError.badRequest("翻页游标无效");
    cursorTs = anchor[0].created_at;
  }
  const { rows } = await pool.query(
    `select id, role, content, tool_calls, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj
     from chat_messages
     where conversation_id = $1 and user_id = $2
       and ($3::timestamptz is null or (created_at, id) < ($3::timestamptz, $4::uuid))
     order by created_at desc, id desc limit $5`,
    [conversationId, userId, cursorTs, opts?.before ?? null, limit + 1],
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    conversation: {
      id: convs[0].id,
      title: convs[0].title,
      scope: (CHAT_SCOPES as readonly string[]).includes(convs[0].scope) ? (convs[0].scope as ChatScope) : "global",
      updatedAt: convs[0].updated_bj,
    },
    messages: page.map(mapMessageRow),
    hasMore,
    oldestId: page.length ? page[0].id : null,
    proposals: await listProposals(userId, conversationId),
  };
}

/** A.5 操作确认卡行（REQ-016） */
export interface ChatProposalDTO {
  id: string;
  kind: "fitness_plan";
  payload: Record<string, unknown>;
  status: "pending" | "accepted" | "dismissed";
  createdAt: string;
}

/** 本会话确认卡：pending 全量在前 + 近期已决（供前端渲染卡片与状态角标） */
async function listProposals(userId: string, conversationId: string): Promise<ChatProposalDTO[]> {
  const { rows } = await pool.query(
    `select id, kind, payload, status, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj
     from chat_proposals
     where user_id = $1 and conversation_id = $2
     order by (status = 'pending') desc, created_at desc, id desc
     limit 20`,
    [userId, conversationId],
  );
  return rows.map((r: any) => ({
    id: r.id,
    kind: r.kind,
    payload: r.payload,
    status: r.status,
    createdAt: r.created_bj,
  }));
}

/** 确认卡处置：accept 在前端成功保存业务数据（POST /api/fitness/plans）之后调用；dismiss 直接放弃。
 * 只允许 pending → 已决（幂等守卫：重复点击 409） */
export async function resolveProposal(userId: string, proposalId: string, action: "accept" | "dismiss"): Promise<void> {
  const { rowCount } = await pool.query(
    `update chat_proposals set status = $3, updated_at = now()
     where id = $1 and user_id = $2 and status = 'pending'`,
    [proposalId, userId, action === "accept" ? "accepted" : "dismissed"],
  );
  if (!rowCount) throw ApiError.conflict("确认卡不存在或已处理");
}

function mapMessageRow(r: any): ChatMessageDTO {
  return {
    id: r.id,
    role: r.role as "user" | "assistant",
    content: r.content,
    ...(Array.isArray(r.tool_calls) ? { toolCalls: r.tool_calls } : {}),
    createdAt: r.created_bj,
  };
}

export interface SendMessageResult {
  conversationId: string;
  conversationTitle: string;
  userMessage: ChatMessageDTO;
  reply: ChatMessageDTO;
  toolTrace: ChatToolTraceItem[];
  quota: ChatQuotaInfo;
  /** 本回合产生的待确认提案卡（REQ-016 A.5：助手生成计划 → 用户点卡片保存） */
  proposals: ChatProposalDTO[];
}

/** 发送消息并取得助手回答（含工具查询轨迹）；免费用户当日次数耗尽抛 402。
 * scope（REQ-019 FR-C）：新会话按此落域；传入已有会话时须与库中一致（防同一会话串域提问） */
export async function sendMessage(
  userId: string,
  input: { conversationId?: string; text: string; scope?: unknown },
): Promise<SendMessageResult> {
  const text = input.text.trim();
  if (!text || text.length > 2000) throw ApiError.badRequest("消息长度须为 1~2000 字");
  const requestedScope = parseScope(input.scope);

  // 原子占位（并发修正）：占位成功才放行，调用失败在 catch 回退占位
  const quota = await acquireChatQuota(userId);
  if (!quota.allowed) {
    throw ApiError.quota(`今日 AI 助手次数已用完（免费版每天 ${FREE_CHAT_CALLS_PER_DAY} 次），明天再来或升级 Pro`);
  }

  // 会话定位 → prompt 装配这段发生在占位之后、外层 try（LLM 调用）之前，失败不会走外层 catch
  // 回退占位——免费用户额度会被从未触达 LLM 的请求烧掉。内层包一层：失败回退占位后原样重抛
  // （404/400 等错误语义与状态码不变；不写 chat 审计——计量口径以触达 LLM 为准）
  let conversationId: string;
  let conversationTitle: string;
  let scope: ChatScope;
  let userMessage: ChatMessageDTO;
  let turns: AgentTurn[];
  let system: string;
  try {
    // 会话定位：传入 id 则校验属主；否则以首句前 20 字为标题新建
    if (input.conversationId) {
      const { rows } = await pool.query(
        `select id, title, scope from chat_conversations where id = $1 and user_id = $2 and deleted_at is null`,
        [input.conversationId, userId],
      );
      if (!rows.length) throw ApiError.notFound("会话不存在");
      conversationId = rows[0].id;
      conversationTitle = rows[0].title;
      scope = (CHAT_SCOPES as readonly string[]).includes(rows[0].scope) ? (rows[0].scope as ChatScope) : "global";
      if (input.scope != null && scope !== requestedScope) {
        throw ApiError.badRequest("会话域不匹配：请在该域助手中开新会话");
      }
    } else {
      const title = text.replace(/\s+/g, " ").slice(0, 20) || "新对话";
      const { rows } = await pool.query(
        `insert into chat_conversations (user_id, title, scope) values ($1, $2, $3) returning id, title`,
        [userId, title, requestedScope],
      );
      conversationId = rows[0].id;
      conversationTitle = rows[0].title;
      scope = requestedScope;
    }

    const { rows: insertedUser } = await pool.query(
      `insert into chat_messages (conversation_id, user_id, role, content)
       values ($1, $2, 'user', $3)
       returning id, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj`,
      [conversationId, userId, text],
    );
    userMessage = {
      id: insertedUser[0].id,
      role: "user",
      content: text,
      createdAt: insertedUser[0].created_bj,
    };

    // 对话历史（含刚落的这条）：最近 HISTORY_LIMIT 条 user/assistant 文本
    const { rows: historyRows } = await pool.query(
      `select role, content from chat_messages
       where conversation_id = $1 and user_id = $2 and role in ('user','assistant') and content <> ''
       order by created_at desc, id desc limit $3`,
      [conversationId, userId, HISTORY_LIMIT],
    );
    turns = historyRows
      .slice()
      .reverse()
      .map((r: { role: string; content: string }) => ({
        role: r.role === "assistant" ? "assistant" : "user",
        content: r.content,
      }));

    // system = 按会话域选人设（REQ-019 FR-C3，纳管热更）+ 上下文块（当前北京时间；画像注入沿用各 key 配置）
    const promptKey = SCOPE_PROMPT_KEY[scope];
    const bundle = await getPromptBundle(promptKey);
    const ctxBlock = await assembleUserPrompt(promptKey, bundle, { nowCst: toCstWallClock(new Date()) }, { userId });
    system = ctxBlock ? `${bundle.system}\n\n${ctxBlock}` : bundle.system;
  } catch (e) {
    // 失败回退占位（口径：配额只扣成功调用）后原样重抛
    await releaseChatQuota(userId, quota.dayKey).catch(() => {});
    throw e;
  }

  const startedAt = Date.now();
  let usage = { prompt_tokens: 0, completion_tokens: 0 };
  try {
    const res = await chatAgent({
      system,
      messages: turns,
      // 域助手只见本域工具 + 通用画像（FR-C2）；global 全量
      tools: toAgentTools({ userId, conversationId } satisfies ChatToolCtx, scope),
      // 5→7：健身提案流程要「查目标→查动作库→提案」3 步，模型漏传明细被拒后还需重调+总结；
      // 步数用不满时无额外开销，只防截断（实测 5 步时提案重试后正文为空）
      maxSteps: 7,
      timeoutMs: 60_000,
      onUsage: (u) => { usage = u; },
    });
    const toolTrace: ChatToolTraceItem[] = res.toolCalls.map((tc) => ({
      name: tc.name,
      label: TOOL_LABELS[tc.name] ?? tc.name,
      args: tc.args,
    }));
    // 兜底：glm-4-flash 被工具错误拒绝后偶发整轮空文本（尤其漏传计划明细被拒时），
    // 落一条可读提示避免前端空气泡
    const replyText =
      res.text.trim() ||
      "（这轮我没能组织好回复：如果是要生成训练计划，请直接告诉我明天想练力量还是跑步，我再生成计划卡片。）";
    const { rows: insertedReply } = await pool.query(
      `insert into chat_messages (conversation_id, user_id, role, content, tool_calls)
       values ($1, $2, 'assistant', $3, $4::jsonb)
       returning id, to_char(created_at at time zone 'Asia/Shanghai', 'MM-DD HH24:MI') as created_bj`,
      [conversationId, userId, replyText, JSON.stringify(toolTrace)],
    );
    await pool.query(`update chat_conversations set updated_at = now() where id = $1`, [conversationId]);
    await writeAuditRecord({
      userId,
      stage: "chat",
      model: activeModel(),
      latencyMs: Date.now() - startedAt,
      textLen: replyText.length,
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
        content: replyText,
        toolCalls: toolTrace,
        createdAt: insertedReply[0].created_bj,
      },
      toolTrace,
      quota: await getChatQuota(userId),
      proposals: await listProposals(userId, conversationId),
    };
  } catch (e) {
    // 失败回退占位（口径：配额只扣成功调用）+ 计量审计（ok=false）：用户消息已保留
    await releaseChatQuota(userId, quota.dayKey).catch(() => {});
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
    // 模型输出类失败（空内容/工具参数不合法，二十轮）：收敛为友好上游文案而非裸 500——
    // GlmError(badOutput) 的原始 detail 只进上方审计，不下发用户
    if ((e as { name?: string })?.name === "GlmError") {
      throw ApiError.upstream("AI 本次回复生成失败，请重新发送或换个说法");
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
  resolveProposal,
};
