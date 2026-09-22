import { NextResponse } from "next/server";
import { hasApiKey } from "@shiguangri/ai";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { acquireGeneration, consumeGeneration, getOrGenerateReview, ReviewGateError } from "@/server/insight";
import { checkAiQuota, getPromptBundle } from "@/server/ai";
import { chatReviewJson } from "@/server/insight/review-input";
import { buildReviewCtx } from "@/server/insight/review-ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YEAR_RE = /^\d{4}$/;

interface YearReview {
  summary: string;
  sections?: { title: string; text: string }[];
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/year {year} —— AI 年报（Phase 4 复盘引擎）
 * year 为 YYYY；聚合全年时间/待办/收支/人际/心情事实 → LLM 解读，不落库即时生成。
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
  const { year, refresh } = (await req.json().catch(() => ({}))) as { year?: string; refresh?: boolean };
  if (!year || !YEAR_RE.test(year)) {
    throw ApiError.badRequest("year 需为 YYYY");
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const bundle = await getPromptBundle("review_year");
  const built = await buildReviewCtx(user.id, "year", { year }, bundle);
  const { from, to, latest } = built;

  let result;
  try {
    result = await getOrGenerateReview(user.id, "year", year, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      await acquireGeneration(user.id, "year", year, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<YearReview>>({
        system: bundle.system,
        user: built.userPrompt,
        maxTokens: 4000,
        timeoutMs: 90_000,
        onUsage: capture,
      });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 48)).filter(Boolean).slice(0, n) : []);
      const sections = Array.isArray(parsed.sections)
        ? parsed.sections
            .filter((s) => s && typeof (s as { title?: unknown }).title === "string" && typeof (s as { text?: unknown }).text === "string")
            .slice(0, 5)
            .map((s) => ({ title: String(s.title).slice(0, 12), text: String(s.text).slice(0, 300) }))
        : [];
      await consumeGeneration(user.id, "year", year);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 220)
            : "这一年记录还很少，多记几天再来复盘会更有料",
        sections,
        highlights: arr(parsed.highlights, 5),
        suggestions: arr(parsed.suggestions, 3),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
});
