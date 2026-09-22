/**
 * Jev 影子模式（REQ-003 3-C / FR-B2）：JEV_MODE=shadow 时，五域识别完成后 fire-and-forget
 * 用同一话术调 Jev 闭集问题组，与已落库的 GLM 结果逐字段比对，只写审计（stage='jev_shadow'）。
 * 用户行为零变化、零阻塞；shadow 行 model='jev-latest'，配额/用量统计口径已排除该模型。
 * 持续 ≥1 周后统计一致率：空间分类 ≥90% 且五域闭集 ≥85% 才进入接管（3-D）。
 * 3-D 起问题组单源自 packages/ai（questions/jev-sets），影子与接管同字典。
 */
import { extractClosedSetQuestions, jevAsk, type ParseResult } from "@shiguangri/ai";
import { getJevMode } from "./ai-mode";
import { writeAuditRecord } from "./audit";

const questions = extractClosedSetQuestions();

/** GLM 侧时间块开始钟点 → 时段枚举（与 PoC 评分同口径）。UTC getter +8：time.start 为 ISO 时刻串，
 *  读本地钟点会二次偏移（004 FR-D2.1 修复，宿主时区无关） */
function hourBucket(iso: string): string {
  const h = new Date(new Date(iso).getTime() + 8 * 3600_000).getUTCHours();
  if (h <= 5) return "lateNight";
  if (h <= 9) return "morning";
  if (h <= 12) return "noon";
  if (h <= 16) return "afternoon";
  if (h <= 20) return "evening";
  return "night";
}

/** 影子对照：与 GLM 落库结果逐闭集字段比对，审计一行（ok=全一致，error=差异摘要）。绝不抛错。 */
export async function jevShadowCompare(userId: string, entryId: string, rawText: string, r: ParseResult): Promise<void> {
  if ((await getJevMode()) !== "shadow") return;
  const t0 = Date.now();
  try {
    // 北京时间墙钟：+8h 后必须读 UTC getter（getHours 等读宿主机时区，CST 机器上会二次 +8）
    const nowCst = (() => {
      const d = new Date(Date.now() + 8 * 3600_000);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}（北京时间）`;
    })();
    const state = `用户随口记录了一句话（当前时间：${nowCst}）：\n「${rawText}」`;
    const res = await jevAsk(state, questions);
    const A = (k: string) => res.answers[k]?.value ?? null;
    const mismatches: string[] = [];
    const cmp = (label: string, jevVal: unknown, glmVal: unknown) => {
      if (jevVal !== glmVal) mismatches.push(`${label}:${JSON.stringify(jevVal)}≠${JSON.stringify(glmVal)}`);
    };
    cmp("schedule", A("sched_applicable") === true, r.scheduleApplicable && r.intent === "schedule");
    cmp("todo", A("todo_applicable") === true, r.intent === "todo");
    cmp("finance", A("fin_applicable") === true, r.finance.hasAmount);
    cmp("mood", A("mood_applicable") === true, !!r.mood.label);
    cmp("diet", A("diet_applicable") === true, r.diet.applicable);
    cmp("people", A("people_applicable") === true, r.people.length > 0);
    cmp("activity", A("activity"), r.activity);
    cmp("record_type", A("record_type"), r.intent === "todo" ? "future" : "past");
    if (r.finance.hasAmount) {
      cmp("fin_direction", A("fin_direction") === "income" ? "in" : A("fin_direction"), r.finance.direction);
      cmp("fin_category", A("fin_category"), r.finance.category);
    }
    if (r.diet.applicable) cmp("diet_meal", A("diet_meal"), r.diet.meal);
    if (r.scheduleApplicable && r.time?.start) cmp("period", A("period"), hourBucket(r.time.start));
    await writeAuditRecord({
      userId, entryId, stage: "jev_shadow",
      model: process.env.JEV_MODEL ?? "jev-latest", engine: "jev-shadow",
      latencyMs: Date.now() - t0, ok: mismatches.length === 0,
      error: mismatches.length ? mismatches.slice(0, 6).join("; ") : undefined,
    });
  } catch (e) {
    // 影子失败照记审计（ok=false），主流程无感知
    await writeAuditRecord({
      userId, entryId, stage: "jev_shadow",
      model: process.env.JEV_MODEL ?? "jev-latest", engine: "jev-shadow",
      latencyMs: Date.now() - t0, ok: false, error: String(e).slice(0, 300),
    });
  }
}
