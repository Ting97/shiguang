import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuthParams } from "@/server/platform/http/route";
import { assertUuidParam } from "@/server/platform/http/validate";
import { chat, extractJson, activeModel } from "@shiguangri/ai";
import { z } from "zod";
import { getPromptBundle, assembleUserPrompt, checkAiQuota, writeAuditRecord } from "@/server/ai";
import { loadProfileBlock } from "@/server/insight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ActionList = z.object({
  reasoning: z.string().optional(),
  actions: z.array(z.object({ title: z.string().min(1).max(30) })).min(0).max(10),
});

/**
 * POST /api/todos/:id/decompose  body: { mode?: 'append' | 'replace', hint?: string }
 * 统一拆解路由，按 id 节点类型分流（REQ-001 R3 · 插入式）：
 * - 顶层待办：生成 ≤10 个行动，追加到行动列表尾部；已有未完成行动且未传 mode → 409 {needMode}
 *   （前端弹「追加 / 重新生成」）；mode=replace 仅清空未完成行动（已完成与重复计数保留）
 * - 行动（有 parent）：细化 ≤3 个同级更小行动，插入到该行动之后（原行动保留，后续 sort 平移）
 */
export const POST = withAuthParams(async (req, { user, params }) => {
  const t0 = Date.now();
  const q = await checkAiQuota(user.id);
  if (!q.allowed) {
    return NextResponse.json(
      { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限拆解`, quota: q },
      { status: 402 },
    );
  }
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  const { mode } = (await req.json().catch(() => ({}))) as { mode?: "append" | "replace" };

  const todo = (
    await pool.query(`select * from todos where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!todo) return NextResponse.json({ error: "todo 不存在" }, { status: 404 });

  const isAction = todo.kind === "action"; // N6：行动（有父或独立）均 kind='action'
  const hasParent = !!todo.parent_todo_id;
  const isDecomposable = todo.status === "pending";
  if (!isDecomposable) return NextResponse.json({ error: "已完成的 todo 不再拆解" }, { status: 400 });

  // ---- 行动上下文（空间名/描述、父待办、已有行动清单用于去重） ----
  const space = todo.space_id
    ? (await pool.query(`select name, description from goal_spaces where id = $1`, [todo.space_id])).rows[0]
    : null;
  const parent = isAction && hasParent
    ? (await pool.query(`select title, note, due_at from todos where id = $1`, [todo.parent_todo_id])).rows[0]
    : null;
  // 去重范围：有父行动=同父兄弟；独立行动=全部独立行动；顶层 todo=其子行动
  const siblings = isAction && hasParent
    ? (
        await pool.query(
          `select id, title, status from todos
           where user_id = $1 and parent_todo_id = $2 and kind = 'action' and id <> $3
           order by sort`,
          [user.id, todo.parent_todo_id, todo.id],
        )
      ).rows
    : isAction
      ? (
          await pool.query(
            `select id, title, status from todos
             where user_id = $1 and parent_todo_id is null and kind = 'action' and id <> $2
             order by sort`,
            [user.id, todo.id],
          )
        ).rows
      : (
          await pool.query(
            `select id, title, status from todos
             where user_id = $1 and parent_todo_id = $2 and kind = 'action'
             order by sort`,
            [user.id, todo.id],
          )
        ).rows;
  const existingTitles = siblings.filter((s) => s.status === "pending").map((s) => s.title);

  // ---- 组装 prompt（3-A：system/user 模板/注入配置三件套按 DB 覆盖装配） ----
  const promptKey = isAction ? "action_decompose" : "todo_decompose";
  const bundle = await getPromptBundle(promptKey);
  const existingOn = bundle.config.inject.existingBlock;
  const cap = bundle.config.caps.existingCount;
  const listed = existingOn ? existingTitles.slice(0, cap) : [];
  const spaceCtxOn = bundle.config.inject.spaceBlock;
  const profileCtxOn = bundle.config.inject.profileBlock;
  const profileBlock = profileCtxOn ? await loadProfileBlock(user.id) : null;
  const note = todo.note || (isAction ? parent?.note : null) || null;
  const userPrompt = await assembleUserPrompt(promptKey, bundle, {
    todoBlock: `${isAction ? `所属 todo：${parent?.title ?? ""}` : `todo：${todo.title}`}${note ? `\n相关描述：${note}` : ""}`,
    spaceBlock: spaceCtxOn && space ? `所属空间：${space.name}${space.description ? `（${space.description}）` : ""}` : "",
    existingBlock: listed.length
      ? `已有行动（禁止生成语义重复项）：\n${listed.map((t) => `- ${t}`).join("\n")}`
      : existingOn
        ? "已有行动：无"
        : "",
    profileBlock: profileCtxOn && profileBlock ? `用户画像（供参考）：\n${profileBlock}` : "",
    target: isAction ? `「${todo.title}」` : "上述 todo",
    modeSuffix: mode === "replace" ? "（重新生成：只输出新的行动清单）" : "",
  }, { userId: user.id });
  const system = bundle.system;

  // ---- 调 LLM（temperature 0.3；失败走一次 repair 风格重试） ----
  let raw = "";
  let parsed = null as z.infer<typeof ActionList> | null;
  let promptTokens = 0;
  let completionTokens = 0;
  const onUsage = (u: { prompt_tokens: number; completion_tokens: number }) => {
    promptTokens += u.prompt_tokens;
    completionTokens += u.completion_tokens;
  };
  try {
    raw = await chat({ system, user: userPrompt, temperature: 0.3, maxTokens: 2000, timeoutMs: 60_000, onUsage });
    parsed = ActionList.safeParse(extractJson(raw)).data ?? null;
    if (!parsed) {
      raw = await chat({ system, user: `${userPrompt}\n\n上次的输出未通过校验，请修正后重新输出完整 JSON（结构不变，只输出 JSON）。`, temperature: 0.3, maxTokens: 2000, timeoutMs: 60_000, onUsage });
      parsed = ActionList.safeParse(extractJson(raw)).data ?? null;
    }
  } catch (e) {
    void writeAuditRecord({
      userId: user.id, entryId: null, stage: "decompose",
      model: activeModel(), engine: "decompose",
      latencyMs: Date.now() - t0, ok: false, error: String(e).slice(0, 300),
      promptTokens, completionTokens,
    });
    // 固定文案：原始错误只进服务端日志/审计，不外泄到响应
    console.warn(`[decompose] 生成失败: ${String(e).slice(0, 300)}`);
    return NextResponse.json({ error: "AI 拆解失败，请稍后再试" }, { status: 502 });
  }
  void writeAuditRecord({
    userId: user.id, entryId: null, stage: "decompose",
    model: activeModel(), engine: "decompose",
    latencyMs: Date.now() - t0, ok: true,
    promptTokens, completionTokens,
  });
  if (!parsed || parsed.actions.length === 0) {
    return NextResponse.json({ error: "AI 没有给出可用的拆解结果，请稍后再试" }, { status: 502 });
  }

  // ---- 落库（插入式 sort 定位） ----
  const limit = isAction ? 3 : 10;
  const actions = parsed.actions.slice(0, limit);
  const client = await pool.connect();
  try {
    await client.query("begin");

    let insertSort: number;
    let insertParent: string | null;
    if (isAction && hasParent) {
      // 有父行动：插入到锚点行动之后，后续同父行动 sort 平移
      await client.query(
        `update todos set sort = sort + $1
         where user_id = $2 and parent_todo_id = $3 and kind = 'action' and sort > $4`,
        [actions.length, user.id, todo.parent_todo_id, todo.sort],
      );
      insertSort = todo.sort + 1;
      insertParent = todo.parent_todo_id;
    } else if (isAction) {
      // 独立行动：产出独立行动插入其后，后续独立行动 sort 平移（顶层 todo 恒 sort=0，不受扰动）
      await client.query(
        `update todos set sort = sort + $1
         where user_id = $2 and parent_todo_id is null and kind = 'action' and sort > $3`,
        [actions.length, user.id, todo.sort],
      );
      insertSort = todo.sort + 1;
      insertParent = null;
    } else {
      // 拆顶层 todo：mode 处理已有未完成行动
      const { rows: pendingRows } = await client.query(
        `select id from todos where user_id = $1 and parent_todo_id = $2 and status = 'pending'`,
        [user.id, todo.id],
      );
      if (pendingRows.length > 0 && mode !== "append" && mode !== "replace") {
        await client.query("rollback");
        return NextResponse.json({ needMode: true, existing: pendingRows.length }, { status: 409 });
      }
      if (mode === "replace") {
        await client.query(
          `delete from todos where user_id = $1 and parent_todo_id = $2 and status = 'pending'`,
          [user.id, todo.id],
        );
      }
      const maxRow = (
        await client.query(
          `select coalesce(max(sort), 0)::int as m from todos where user_id = $1 and parent_todo_id = $2`,
          [user.id, todo.id],
        )
      ).rows[0];
      insertSort = maxRow.m + 1;
      insertParent = todo.id;
    }

    const inserted: { id: string; title: string; sort: number }[] = [];
    for (const a of actions) {
      const { rows } = await client.query(
        `insert into todos (user_id, title, source, parent_todo_id, activity_id, space_id, sort, repeat_daily, kind)
         values ($1, $2, 'ai', $3, $4, $5, $6, false, 'action') returning id, title, sort`,
        [user.id, a.title, insertParent, todo.activity_id, todo.space_id, insertSort++],
      );
      inserted.push(rows[0]);
    }
    await client.query("commit");
    return NextResponse.json({ ok: true, actions: inserted, engine: isAction ? "action-decompose" : "todo-decompose" });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("[decompose] 落库失败:", e);
    return NextResponse.json({ error: "拆解结果保存失败" }, { status: 500 });
  } finally {
    client.release();
  }
});
