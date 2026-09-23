import { NextResponse } from "next/server";
import { hasApiKey } from "@shiguangri/ai";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { acquireGeneration, consumeGeneration, getOrGenerateReview, ReviewGateError } from "@/server/insight";
import { checkAiQuota, getPromptBundle } from "@/server/ai";
import { chatReviewJson } from "@/server/insight";
import { buildReviewCtx } from "@/server/insight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface WeekReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/week {date} —— AI 周报（Phase 4 复盘引擎）
 * date 为该周任一天；聚合本周时间/待办/收支/人际/心情事实 → LLM 解读，不落库即时生成。
 * 输入装配走 review-ctx 共享路径（3-A：注入开关/明细上限可配，与 /admin 预览同源）。
 */
export const POST = withAuth(async (req, { user }) => {
  if (user.role !== "admin") {
    const q = await checkAiQuota(user.id);
    if (!q.allowed) {
      return NextResponse.json(
        { error: `AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`, quota: q },
        { status: 402 },
      );
    }
  }
  const { date, refresh } = (await req.json().catch(() => ({}))) as { date?: string; refresh?: boolean };
  if (!date || !DATE_RE.test(date)) {
    throw ApiError.badRequest("date 需为 YYYY-MM-DD");
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const bundle = await getPromptBundle("review_week");
  const built = await buildReviewCtx(user.id, "week", { date }, bundle);
  const { from, to, latest } = built;

  let result;
  try {
    result = await getOrGenerateReview(user.id, "week", from, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      await acquireGeneration(user.id, "week", from, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<WeekReview>>({
        system: bundle.system,
        user: built.userPrompt,
        maxTokens: 1300,
        timeoutMs: 45_000,
        onUsage: capture,
      });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 34)).filter(Boolean).slice(0, n) : []);
      await consumeGeneration(user.id, "week", from);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 150)
            : "这一周记录还很少，多记几天再来复盘会更有料",
        highlights: arr(parsed.highlights, 3),
        suggestions: arr(parsed.suggestions, 2),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
});
