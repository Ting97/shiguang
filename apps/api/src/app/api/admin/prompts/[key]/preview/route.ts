import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { ACTIVITY_NAMES, toCstWallClock } from "@shiguangri/ai";
import { PROMPT_KEYS, getPromptBundle, assembleUserPrompt, getPrompt, type PromptKey } from "@/server/ai/prompts";
import { writeAuditRecord } from "@/server/ai/audit";
import { listContactNames } from "@/server/timeline/analyze";
import { loadProfileBlock } from "@/server/insight/review-input";
import { buildReviewCtx, type ReviewKind } from "@/server/insight/review-ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/prompts/[key]/preview {sample?, period?} —— 装配预览（REQ-003 FR-1.5）
 * 按「当前生效三件套」走与线上同一条装配逻辑，返回最终 user 输入全文。
 * 不调 LLM、零 token；结果不落库；audit 仅记 stage='prompt_preview' 计数，不记内容。
 * sample 缺省时取管理员最近真实数据；period 供复盘类指定期间（日/周 YYYY-MM-DD、月 YYYY-MM、年 YYYY）。
 */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const startedAt = Date.now();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });

  const { key } = await ctx.params;
  if (!PROMPT_KEYS.includes(key as PromptKey)) {
    return NextResponse.json({ error: "未知的 prompt key" }, { status: 404 });
  }
  const { sample, period } = (await req.json().catch(() => ({}))) as { sample?: string; period?: string };
  const bundle = await getPromptBundle(key as PromptKey);
  const cfg = bundle.config;
  const sampleText = sample?.trim() || null;

  const latestEntry = async (): Promise<string | null> => {
    const { rows } = await pool.query(
      `select raw_text from entries where user_id = $1 order by created_at desc limit 1`,
      [user.id],
    );
    return rows[0]?.raw_text ?? null;
  };

  let userPrompt = "";
  let ctxOut: Record<string, string> = {};

  if (key === "extract_full" || key.startsWith("extract_domain_")) {
    const contactsOn = cfg.inject.contactList ?? false;
    const contactNames = contactsOn ? await listContactNames(user.id, cfg.caps.contactCount ?? 100) : [];
    const catList =
      key === "extract_full" && cfg.inject.catList
        ? (Object.keys(ACTIVITY_NAMES) as (keyof typeof ACTIVITY_NAMES)[])
            .slice(0, cfg.caps.catCount ?? 50)
            .map((k) => `${k}=${ACTIVITY_NAMES[k]}`)
            .join("、")
        : "";
    const contactList =
      contactsOn && contactNames.length
        ? `\n已有联系人（人物识别时称呼对齐到名单原文）：${contactNames.join("、")}`
        : "";
    const text = sampleText ?? (await latestEntry()) ?? "（管理员名下暂无动态，可粘贴样例话术）";
    ctxOut = { nowCst: toCstWallClock(new Date()), catList, contactList, text };
    userPrompt = assembleUserPrompt(key as PromptKey, bundle, ctxOut);
  } else if (key.startsWith("review_")) {
    const kind = key.slice("review_".length) as ReviewKind;
    const built = await buildReviewCtx(
      user.id,
      kind,
      {
        date: kind === "day" || kind === "week" ? period || undefined : undefined,
        month: kind === "month" ? period || undefined : undefined,
        year: kind === "year" ? period || undefined : undefined,
      },
      bundle,
    );
    ctxOut = built.ctx;
    userPrompt = built.userPrompt;
  } else if (key === "trade_review_week") {
    // 交易周报预览（QA 验收修复：原落入 prompt_optimizer 兜底导致模板/占位符错配返回原始模板）
    const mondayOf = (dateStr: string) => {
      const d = new Date(`${dateStr}T00:00:00Z`);
      return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    };
    const addDays = (dateStr: string, n: number) =>
      new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const from = mondayOf(period && /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
    const to = addDays(from, 6);
    const yuan = (cents: number) => `¥${(cents / 100).toFixed(0)}`;

    const agg = (
      await pool.query(
        `select coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
                coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out,
                count(*)::int as n
         from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date`,
        [user.id, "Asia/Shanghai", from, to],
      )
    ).rows[0];
    const prev = (
      await pool.query(
        `select coalesce(sum(case when direction = 'in' then amount_cents else 0 end), 0)::bigint as inc,
                coalesce(sum(case when direction = 'out' then amount_cents else 0 end), 0)::bigint as out
         from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date`,
        [user.id, "Asia/Shanghai", addDays(from, -7), addDays(from, -1)],
      )
    ).rows[0];
    const cats = (
      await pool.query(
        `select category, sum(case when direction = 'out' then amount_cents else 0 end)::bigint as cents
         from transactions
         where user_id = $1 and is_draft = false
           and (occurred_at at time zone $2)::date between $3::date and $4::date
         group by category order by cents desc limit 5`,
        [user.id, "Asia/Shanghai", from, to],
      )
    ).rows;
    const momPct = (cur: number, base: number) =>
      base > 0 ? `${cur >= base ? "+" : ""}${Math.round(((cur - base) / base) * 100)}%` : "—";
    const facts = [
      `交易周报 · 本周 ${from} ~ ${to}（周一至周日）`,
      `总支出 ${yuan(Number(agg.out))}（上周 ${yuan(Number(prev.out))}，环比 ${momPct(Number(agg.out), Number(prev.out))}）`,
      `总收入 ${yuan(Number(agg.inc))}（上周 ${yuan(Number(prev.inc))}，环比 ${momPct(Number(agg.inc), Number(prev.inc))}）`,
      `笔数：共 ${agg.n} 笔`,
      ...(cats.length ? [`支出分类 Top：${cats.map((c) => `${c.category} ${yuan(Number(c.cents))}`).join("、")}`] : []),
    ].join("\n");

    let txDetail = "";
    if (cfg.inject.txDetail && cfg.caps.txCap !== 0) {
      const rows = (
        await pool.query(
          `select to_char((occurred_at at time zone $2)::date, 'MM-DD') as d, direction, amount_cents, category, counterparty, note
           from transactions
           where user_id = $1 and is_draft = false
             and (occurred_at at time zone $2)::date between $3::date and $4::date
           order by occurred_at
           limit $5`,
          [user.id, "Asia/Shanghai", from, to, cfg.caps.txCap],
        )
      ).rows;
      const total = (
        await pool.query(
          `select count(*)::int as n from transactions
           where user_id = $1 and is_draft = false
             and (occurred_at at time zone $2)::date between $3::date and $4::date`,
          [user.id, "Asia/Shanghai", from, to],
        )
      ).rows[0].n;
      const lines = rows.map(
        (r) =>
          `${r.d} ${r.direction === "out" ? "-" : "+"}${yuan(Number(r.amount_cents))} ${r.category}` +
          `${r.counterparty ? ` ${r.counterparty}` : ""}${r.note ? `（${r.note}）` : ""}`,
      );
      if (total > rows.length) lines.push(`（另有 ${total - rows.length} 条流水未展示）`);
      txDetail = lines.length > 0 ? `本周流水（时间升序）：\n${lines.join("\n")}` : "本周无流水明细。";
    }
    ctxOut = { facts, txDetail };
    userPrompt = assembleUserPrompt(key as PromptKey, bundle, ctxOut);
  } else if (key === "todo_decompose" || key === "action_decompose") {
    const isAction = key === "action_decompose";
    const todo = (
      await pool.query(
        isAction
          ? `select id, title, note, space_id, parent_todo_id from todos where user_id = $1 and kind = 'action' and status = 'pending' order by created_at desc limit 1`
          : `select id, title, note, space_id from todos where user_id = $1 and parent_todo_id is null and status = 'pending' order by created_at desc limit 1`,
        [user.id],
      )
    ).rows[0];
    const title = todo?.title ?? sampleText ?? "（示例）整理书桌并归位物品";
    const note = todo?.note ?? null;
    const space = todo?.space_id
      ? (await pool.query(`select name, description from goal_spaces where id = $1`, [todo.space_id])).rows[0]
      : null;
    const parent =
      isAction && todo?.parent_todo_id
        ? (await pool.query(`select title, note from todos where id = $1`, [todo.parent_todo_id])).rows[0]
        : null;
    // 去重清单口径与拆解路由一致（按同父兄弟 / 独立行动全体 / 顶层 todo 的子行动）
    const existingTitles = todo
      ? isAction
        ? todo.parent_todo_id
          ? (
              await pool.query(
                `select title from todos where user_id = $1 and parent_todo_id = $2 and kind = 'action' and id <> $3 and status = 'pending' order by sort`,
                [user.id, todo.parent_todo_id, todo.id],
              )
            ).rows.map((r) => r.title)
          : (
              await pool.query(
                `select title from todos where user_id = $1 and parent_todo_id is null and kind = 'action' and id <> $2 and status = 'pending' order by sort`,
                [user.id, todo.id],
              )
            ).rows.map((r) => r.title)
        : (
            await pool.query(
              `select title from todos where user_id = $1 and parent_todo_id = $2 and kind = 'action' and status = 'pending' order by sort`,
              [user.id, todo.id],
            )
          ).rows.map((r) => r.title)
      : [];
    const listed = cfg.inject.existingBlock ? existingTitles.slice(0, cfg.caps.existingCount ?? 30) : [];
    const profile = cfg.inject.profileBlock ? await loadProfileBlock(user.id) : null;
    ctxOut = {
      todoBlock: `${isAction ? `所属 todo：${parent?.title ?? ""}` : `todo：${title}`}${note || (isAction ? parent?.note : null) ? `\n相关描述：${note || parent?.note}` : ""}`,
      spaceBlock: cfg.inject.spaceBlock && space ? `所属空间：${space.name}${space.description ? `（${space.description}）` : ""}` : "",
      existingBlock: listed.length
        ? `已有行动（禁止生成语义重复项）：\n${listed.map((t) => `- ${t}`).join("\n")}`
        : cfg.inject.existingBlock
          ? "已有行动：无"
          : "",
      profileBlock: profile ? `用户画像（供参考）：\n${profile}` : "",
      target: isAction ? `「${title}」` : "上述 todo",
      modeSuffix: "",
    };
    userPrompt = assembleUserPrompt(key as PromptKey, bundle, ctxOut);
  } else if (key === "space_classify") {
    const { rows: spaces } = await pool.query(
      `select id, name, description from goal_spaces where user_id = $1 and status = 'active' order by sort limit ${cfg.caps.spaceCount ?? 20}`,
      [user.id],
    );
    const candidates = spaces
      .map((s) => `- ${s.id}：${s.name}${s.description ? `（${s.description}）` : ""}`)
      .join("\n");
    const text = (sampleText ?? (await latestEntry()) ?? "（示例）今天背了两百个单词").slice(0, 500);
    ctxOut = { candidates, text };
    userPrompt = assembleUserPrompt("space_classify", bundle, ctxOut);
  } else {
    // prompt_optimizer：current 为管理员粘贴的目标 prompt（缺省取当前生效的 system）
    const contract =
      "【必须保留的契约约束】\n保持原文中的输出 JSON 结构、字段名、枚举值与占位符完全不变。";
    ctxOut = {
      purpose: `示例（key=${key}）——「拾光」系统的 AI 提示词`,
      contract,
      current: sampleText ?? (await getPrompt(key as PromptKey)),
      intent: "（无，按专家判断全面优化）",
    };
    userPrompt = assembleUserPrompt("prompt_optimizer", bundle, ctxOut);
  }

  void writeAuditRecord({
    userId: user.id, entryId: null, stage: "prompt_preview",
    model: null, engine: "prompt-preview",
    latencyMs: Date.now() - startedAt, ok: true,
  });
  return NextResponse.json({ ok: true, userPrompt, ctx: ctxOut, config: bundle.config });
}
