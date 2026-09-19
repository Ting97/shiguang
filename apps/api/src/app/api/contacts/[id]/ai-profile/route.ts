import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { chat, extractJson, hasApiKey } from "@shiguangri/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AiProfile {
  summary: string;
  likes: string[];
  dislikes: string[];
  facts: string[];
}

/**
 * POST /api/contacts/:id/ai-profile —— 基于往来记录提炼「AI 交往画像」（W10 遗留）
 * 只依据真实记录（往来时间线 + 人情账 + 档案备注），禁止编造；结果缓存于 contacts.ai_profile
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await ctx.params;
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const contact = (
    await pool.query(
      `select id, name, alias, group_tag, birthday, anniversary, importance, notes
       from contacts where id = $1 and user_id = $2`,
      [id, user.id],
    )
  ).rows[0];
  if (!contact) return NextResponse.json({ error: "联系人不存在" }, { status: 404 });

  const { rows: interactions } = await pool.query(
    `select type, summary, occurred_at from interactions
     where contact_id = $1 and user_id = $2 order by occurred_at desc nulls last limit 50`,
    [id, user.id],
  );
  const { rows: money } = await pool.query(
    `select direction, amount_cents, category, note, occurred_at from transactions
     where user_id = $2 and is_draft = false and counterparty = $1
     order by occurred_at desc limit 30`,
    [contact.name, user.id],
  );

  if (interactions.length === 0 && money.length === 0 && !contact.notes) {
    return NextResponse.json(
      { error: "还没有与 TA 的往来记录，先记几条动态或补一笔往来再来提炼" },
      { status: 400 },
    );
  }

  const lines = [
    `人物：${contact.name}${contact.alias ? `（备注名 ${contact.alias}）` : ""}，分组 ${contact.group_tag}`,
    contact.birthday ? `生日 ${contact.birthday}` : "",
    contact.notes ? `档案备注：${contact.notes}` : "",
    interactions.length
      ? `往来记录（最近 ${interactions.length} 条）：\n${interactions
          .map((i: Record<string, unknown>) => `- [${i.type}] ${i.summary ?? ""}${i.occurred_at ? `（${String(i.occurred_at).slice(0, 10)}）` : ""}`)
          .join("\n")}`
      : "",
    money.length
      ? `人情往来（最近 ${money.length} 笔）：\n${money
          .map((m: Record<string, unknown>) => `- ${m.direction === "out" ? "送出" : "收到"} ¥${(Number(m.amount_cents) / 100).toFixed(0)} ${m.note || m.category || ""}`)
          .join("\n")}`
      : "",
  ].filter(Boolean);

  const system = `你是个人经营助手，帮用户提炼与某位联系人的「交往画像」。只依据给出的真实记录归纳，**严禁编造**记录里没有的信息；记录太少就少说，每类最多 3 条。严格输出 JSON：
{
  "summary": "一句话交往风格总结（≤40字，基于记录）",
  "likes": ["TA 明显喜欢/在意的事（来自记录）"],
  "dislikes": ["TA 的忌讳/反感/雷区（来自记录，没有就空数组）"],
  "facts": ["值得记住的重要事实（如家人生日、口味、约定）"]
}`;

  let profile: AiProfile;
  try {
    const raw = await chat({
      system,
      user: lines.join("\n"),
      temperature: 0.3,
      maxTokens: 600,
      timeoutMs: 45_000,
    });
    const parsed = extractJson(raw) as Partial<AiProfile>;
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, 3) : []);
    profile = {
      summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim().slice(0, 60) : "记录还太少，多记几次再来提炼会更准",
      likes: arr(parsed.likes),
      dislikes: arr(parsed.dislikes),
      facts: arr(parsed.facts),
    };
  } catch (e) {
    return NextResponse.json({ error: `AI 提炼失败：${e instanceof Error ? e.message : e}` }, { status: 502 });
  }

  const updated = (
    await pool.query(
      `update contacts set ai_profile = $3, ai_profile_at = now() where id = $1 and user_id = $2
       returning ai_profile, ai_profile_at`,
      [id, user.id, JSON.stringify(profile)],
    )
  ).rows[0];

  return NextResponse.json({ profile: updated.ai_profile, profileAt: updated.ai_profile_at });
}
