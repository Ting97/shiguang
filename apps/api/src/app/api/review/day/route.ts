import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasApiKey } from "@shiguangri/ai";
import { getOrGenerateReview } from "@/lib/review-cache";
import { checkAiQuota } from "@/lib/quota";
import { acquireGeneration, consumeGeneration, ReviewGateError } from "@/lib/review-quota";
import { getPromptBundle } from "@/lib/prompts";
import { chatReviewJson } from "@/lib/review-input";
import { buildReviewCtx } from "@/lib/review-ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DayReview {
  summary: string;
  highlights: string[];
  suggestions: string[];
}

/**
 * POST /api/review/day {date} —— AI 日小结（Phase 4 复盘引擎 MVP）
 * 聚合当天时间/待办/收支/人际/心情事实 → LLM 归因解读；只依据真实记录，不落库（每次即时生成）。
 * 输入装配走 review-ctx 共享路径（3-A：注入开关/明细上限可配，与 /admin 预览同源）。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
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
    return NextResponse.json({ error: "date 需为 YYYY-MM-DD" }, { status: 400 });
  }
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const bundle = await getPromptBundle("review_day");
  const built = await buildReviewCtx(user.id, "day", { date }, bundle);
  const { latest } = built;

  let result;
  try {
    result = await getOrGenerateReview(user.id, "day", date, refresh === true, latest ? new Date(latest) : null, async (capture) => {
      await acquireGeneration(user.id, "day", date, latest ? new Date(latest) : null);
      const parsed = await chatReviewJson<Partial<DayReview>>({
        system: bundle.system,
        user: built.userPrompt,
        maxTokens: 700,
        timeoutMs: 45_000,
        onUsage: capture,
      });
    const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 30)).filter(Boolean).slice(0, n) : []);
      await consumeGeneration(user.id, "day", date);
      return {
        summary:
          typeof parsed.summary === "string" && parsed.summary.trim()
            ? parsed.summary.trim().slice(0, 80)
            : "这一天记录还很少，多记几句再来复盘会更有料",
        highlights: arr(parsed.highlights, 2),
        suggestions: arr(parsed.suggestions, 2),
      };
    });
  } catch (e) {
    if (e instanceof ReviewGateError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "AI 解读失败，请稍后重试" }, { status: 502 });
  }
  const { review, cached, generatedAt } = result;

  return NextResponse.json({ review, cached, generatedAt, facts: { timeParts: built.summary.timeParts, todoDone: built.summary.todoDone } });
}
