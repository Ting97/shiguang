import { NextResponse } from "next/server";
import { pool, DEV_USER_ID } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Usage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

/** GET /api/tokens/usage —— 管理员查看自己与被邀请人的 GLM token 消耗（全部累计 + 近 30 天） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.id !== DEV_USER_ID) {
    return NextResponse.json({ error: "仅管理员可查看消耗" }, { status: 403 });
  }

  // 一个聚合同时出两个时间窗（近 30 天 / 全部累计）；parse/review/asr 全阶段
  const { rows: selfRows } = await pool.query(
    `select count(*)::int as calls,
            coalesce(sum(prompt_tokens), 0)::bigint as prompt,
            coalesce(sum(completion_tokens), 0)::bigint as completion,
            count(*) filter (where created_at > now() - interval '30 days')::int as calls_30d,
            coalesce(sum(prompt_tokens) filter (where created_at > now() - interval '30 days'), 0)::bigint as prompt_30d,
            coalesce(sum(completion_tokens) filter (where created_at > now() - interval '30 days'), 0)::bigint as completion_30d
     from audit_logs where user_id = $1`,
    [user.id],
  );
  const s = selfRows[0];
  const self: { all: Usage; d30: Usage } = {
    all: { calls: Number(s.calls), promptTokens: Number(s.prompt), completionTokens: Number(s.completion) },
    d30: { calls: Number(s.calls_30d), promptTokens: Number(s.prompt_30d), completionTokens: Number(s.completion_30d) },
  };

  const { rows: inviteeRows } = await pool.query(
    `select p.id, p.nickname, p.phone, p.created_at,
            count(a.id)::int as calls,
            coalesce(sum(a.prompt_tokens), 0)::bigint as prompt,
            coalesce(sum(a.completion_tokens), 0)::bigint as completion,
            count(a.id) filter (where a.created_at > now() - interval '30 days')::int as calls_30d,
            coalesce(sum(a.prompt_tokens) filter (where a.created_at > now() - interval '30 days'), 0)::bigint as prompt_30d,
            coalesce(sum(a.completion_tokens) filter (where a.created_at > now() - interval '30 days'), 0)::bigint as completion_30d
     from invite_codes i
     join profiles p on p.id = i.used_by
     left join audit_logs a on a.user_id = p.id
     where i.created_by = $1 and i.used_by is not null
     group by p.id
     order by sum(a.prompt_tokens) + sum(a.completion_tokens) desc nulls last, p.created_at desc`,
    [user.id],
  );
  const invitees = inviteeRows.map((r) => ({
    id: r.id,
    nickname: r.nickname ?? "未命名",
    phoneTail: r.phone ? r.phone.slice(-4) : null,
    createdAt: r.created_at,
    all: { calls: Number(r.calls), promptTokens: Number(r.prompt), completionTokens: Number(r.completion) },
    d30: { calls: Number(r.calls_30d), promptTokens: Number(r.prompt_30d), completionTokens: Number(r.completion_30d) },
  }));

  const { rows: modelRows } = await pool.query(
    `select model,
            count(*)::int as calls,
            coalesce(sum(prompt_tokens), 0)::bigint as prompt,
            coalesce(sum(completion_tokens), 0)::bigint as completion,
            count(*) filter (where created_at > now() - interval '30 days')::int as calls_30d,
            coalesce(sum(prompt_tokens) filter (where created_at > now() - interval '30 days'), 0)::bigint as prompt_30d,
            coalesce(sum(completion_tokens) filter (where created_at > now() - interval '30 days'), 0)::bigint as completion_30d
     from audit_logs
     where user_id = $1
        or user_id in (select used_by from invite_codes where created_by = $1 and used_by is not null)
     group by model
     order by sum(prompt_tokens) + sum(completion_tokens) desc`,
    [user.id],
  );
  const byModel = modelRows.map((r) => ({
    // 纯离线规则兜底（未调用 LLM）的审计行没有模型名，显示成可读标签而不是空白
    model: r.model || "(离线规则·无模型)",
    all: { calls: Number(r.calls), promptTokens: Number(r.prompt), completionTokens: Number(r.completion) },
    d30: { calls: Number(r.calls_30d), promptTokens: Number(r.prompt_30d), completionTokens: Number(r.completion_30d) },
  }));

  return NextResponse.json({ self, invitees, byModel });
}
