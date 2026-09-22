import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { getQuota } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/billing/plan —— 当前用户套餐与 AI 用量（30 天窗口）+ 自己的按模型 token 明细 */
export const GET = withAuth(async (_req, { user }) => {
  const quota = await getQuota(user.id);
  const { rows } = await pool.query(
    `select model,
            count(*)::int as calls,
            coalesce(sum(prompt_tokens), 0)::bigint as prompt,
            coalesce(sum(completion_tokens), 0)::bigint as completion,
            count(*) filter (where created_at > now() - interval '30 days')::int as calls_30d,
            coalesce(sum(prompt_tokens) filter (where created_at > now() - interval '30 days'), 0)::bigint as prompt_30d,
            coalesce(sum(completion_tokens) filter (where created_at > now() - interval '30 days'), 0)::bigint as completion_30d
     from audit_logs where user_id = $1
     group by model
     order by sum(prompt_tokens) + sum(completion_tokens) desc`,
    [user.id],
  );
  const byModel = rows.map((r) => ({
    model: r.model,
    all: { calls: Number(r.calls), promptTokens: Number(r.prompt), completionTokens: Number(r.completion) },
    d30: { calls: Number(r.calls_30d), promptTokens: Number(r.prompt_30d), completionTokens: Number(r.completion_30d) },
  }));
  return NextResponse.json({
    isAdmin: user.role === "admin",
    ...quota,
    byModel,
  });
});

/**
 * POST /api/billing/plan —— 管理员改用户套餐（内测期发放）
 * { userId?, plan: 'free'|'pro', months? }  userId 缺省=自己；pro 时 months（缺省 12）设置到期
 * 支付通道（微信/支付宝商户号、RevenueCat）接入后由支付回调调用同一逻辑
 */
export const POST = withAuth(async (req, { user }) => {
  if (user.role !== "admin") {
    throw ApiError.forbidden("仅管理员可变更套餐");
  }
  const { userId, plan, months } = (await req.json().catch(() => ({}))) as {
    userId?: string; plan?: string; months?: number;
  };
  if (plan !== "free" && plan !== "pro") {
    throw ApiError.badRequest("plan 需为 free/pro");
  }
  const target = userId || user.id;
  const expires =
    plan === "pro"
      ? new Date(Date.now() + Math.max(1, months ?? 12) * 30 * 86_400_000)
      : null;
  const { rows } = await pool.query(
    `update profiles set plan = $1, plan_expires_at = $2 where id = $3
     returning id, plan, plan_expires_at`,
    [plan, expires, target],
  );
  if (!rows[0]) throw ApiError.notFound("用户不存在");
  return NextResponse.json({ ok: true, profile: rows[0] });
});
