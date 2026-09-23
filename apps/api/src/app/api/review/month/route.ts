import { NextResponse } from "next/server";
import { hasApiKey } from "@shiguangri/ai";
import { withAuth } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { isValidYearMonth } from "@/server/platform/http/validate";
import { acquireGeneration, consumeGeneration, getOrGenerateReview, ReviewGateError } from "@/server/insight";
import { checkAiQuota, getPromptBundle } from "@/server/ai";
import { chatReviewJson, updateProfileFromReview } from "@/server/insight";
import { buildReviewCtx } from "@/server/insight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MonthReview {
  summary: string;
  sections?: { title: string; text: string }[];
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/month {month} —— AI 月报（Phase 4 复盘引擎）
 * month 为 YYYY-MM；聚合本月时间/待办/收支/人际/心情事实 → LLM 解读，不落库即时生成。
 * 输入装配走 review-ctx 共享路径（3-A：注入开关/明细上限可配，与 /admin 预览同源）。
 */
export const POST = withAuth(async (req, { user }) => {
  const { month, refresh } = (await req.json().catch(() => ({}))) as { month?: string; refresh?: boolean };
  // 形状校验放行 2025-13 → 查询永不命中/算错周期：月份需在 01-12
  if (!month || !isValidYearMonth(month)) {
    throw ApiError.badRequest("month 需为 YYYY-MM（月份 01-12）");
  }

  const bundle = await getPromptBundle("review_month");
  const built = await buildReviewCtx(user.id, "month", { month }, bundle);
  const { from, to, latest, userPrompt } = built;

  let result;
  try {
    result = await getOrGenerateReview(user.id, "month", month, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      // 额度/KEY 门禁仅校验于真正要生成时——缓存命中零成本秒回，配额用尽的用户也能读到已生成的复盘
      if (user.role !== "admin") {
        const q = await checkAiQuota(user.id);
        if (!q.allowed) {
          throw new ReviewGateError(`AI 免费额度已用完（30 天内 ${q.used}/${q.limit} 次）·升级 Pro 解锁无限复盘`);
        }
      }
      if (!hasApiKey()) throw new ReviewGateError("未配置 AI 服务");
      await acquireGeneration(user.id, "month", month, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<MonthReview>>({
        system: bundle.system,
        user: userPrompt,
        maxTokens: 2500,
        timeoutMs: 60_000,
        onUsage: capture,
      });
      const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 40)).filter(Boolean).slice(0, n) : []);
      const sections = Array.isArray(parsed.sections)
        ? parsed.sections
            .filter((s) => s && typeof (s as { title?: unknown }).title === "string" && typeof (s as { text?: unknown }).text === "string")
            .slice(0, 4)
            .map((s) => ({ title: String(s.title).slice(0, 12), text: String(s.text).slice(0, 220) }))
        : [];
      await consumeGeneration(user.id, "month", month);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 160)
            : "这个月记录还很少，多记几天再来复盘会更有料",
        sections,
        highlights: arr(parsed.highlights, 4),
        suggestions: arr(parsed.suggestions, 3),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  // ---- 画像更新（越用越懂用户）：月报生成成功后合并记忆，异步不阻塞响应 ----
  if (!cached) {
    const reviewText = JSON.stringify(review);
    void updateProfileFromReview(user.id, `${month}月`, userPrompt, reviewText);
  }

  return NextResponse.json({ review, cached, generatedAt, range: { from, to } });
});
