/**
 * Jev（TypeSafe System One）客户端（REQ-003 B / 02 §7.1）：闭集判断专用第二模型。
 * 不生成文本——对输入 state 一次并行回答 choice/score/noul 三原语问题，返回类型化答案 + 校准概率。
 *
 * env（仅服务器/本地 .env，永不入库）：
 *   TYPESAFE_API_KEY    访问密钥
 *   TYPESAFE_BASE_URL   默认 https://api.typesafe.ai
 *   JEV_MODEL           默认 jev-latest
 *   JEV_MODE            off | shadow | on（默认 off；一键回退开关）
 *
 * 失败抛 JevError（network/timeout/auth/rate/badResponse）——调用方决定降级，不内置熔断。
 */
import { z } from "zod";

export type JevMode = "off" | "shadow" | "on";

export function jevMode(): JevMode {
  const m = (process.env.JEV_MODE ?? "off").toLowerCase();
  return m === "shadow" ? "shadow" : m === "on" ? "on" : "off";
}

export function jevEnabled(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY) && jevMode() !== "off";
}

// ---------- 三原语问题构造（criteria 即闭集契约） ----------

export const qChoice = (instructions: string, criteria: Record<string, string>) =>
  ({ type: "choice" as const, instructions, criteria });
export const qScore = (instructions: string, criteria: string[]) =>
  ({ type: "score" as const, instructions, criteria });
export const qNoul = (instructions: string) =>
  ({ type: "noul" as const, instructions });

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string };

export type JevQuestions = Record<string, JevQuestion>;

/** 单题答案：choice=选项 key；score=选项下标；noul=「是」的概率（0~1 浮点，非布尔）；概率分布（校准）与置信度可选 */
const answerSchema = z
  .object({
    choice: z.string().nullish(),
    score: z.number().nullish(),
    noul: z.number().min(0).max(1).nullish(),
    confidence: z.number().nullish(),
    probabilities: z.record(z.string(), z.number()).nullish(),
    answer: z.unknown().nullish(), // 容错：部分实现把答案放 answer 字段
  })
  .passthrough();

const responseSchema = z.object({
  model: z.string().nullish(),
  answers: z.record(z.string(), answerSchema),
  usage: z.unknown().nullish(),
});

export interface JevAnswers {
  /** 每题规范化答案：choice=选项 key；score=选项 key（按 criteria 下标还原）；noul=布尔 */
  answers: Record<string, { value: string | boolean | number | null; confidence: number | null; probabilities: Record<string, number> | null }>;
  model: string | null;
  raw: unknown;
}

export class JevError extends Error {
  constructor(public kind: "network" | "timeout" | "auth" | "rate" | "badResponse", message: string) {
    super(`[jev:${kind}] ${message}`);
    this.name = "JevError";
  }
}

const TIMEOUT_MS = 5_000;
const RETRIES = 2;

/** 一次调用并行回答多题（加问不增延迟）。失败抛 JevError，由调用方降级。 */
export async function jevAsk(state: string, questions: JevQuestions): Promise<JevAnswers> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new JevError("auth", "缺少 TYPESAFE_API_KEY");
  const base = process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai";
  const model = process.env.JEV_MODEL ?? "jev-latest";
  const body = JSON.stringify({ state, model, questions });

  let lastErr: JevError | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/v1/systemone`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) throw new JevError("auth", `HTTP ${res.status}`);
      if (res.status === 429) throw new JevError("rate", "HTTP 429");
      if (!res.ok) throw new JevError("network", `HTTP ${res.status}`);
      const json = responseSchema.safeParse(await res.json().catch(() => null));
      if (!json.success || !json.data.answers) {
        throw new JevError("badResponse", "响应结构不符合契约");
      }
      return normalize(json.data, questions);
    } catch (e) {
      if (e instanceof JevError) {
        // auth/参数类错误重试无意义，直接抛
        if (e.kind === "auth" || e.kind === "badResponse") throw e;
        lastErr = e;
      } else if (e instanceof Error && e.name === "AbortError") {
        lastErr = new JevError("timeout", `超过 ${TIMEOUT_MS}ms`);
      } else {
        lastErr = new JevError("network", String(e).slice(0, 160));
      }
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new JevError("network", "未知失败");
}

/** 规范化答案：choice/score 还原为选项 key，noul 还原为布尔；置信度取 confidence 或概率差 */
function normalize(
  data: z.infer<typeof responseSchema>,
  questions: JevQuestions,
): JevAnswers {
  const answers: JevAnswers["answers"] = {};
  for (const [qKey, q] of Object.entries(questions)) {
    const a = data.answers[qKey] ?? {};
    const probabilities = (a.probabilities ?? null) as Record<string, number> | null;
    const confidence = a.confidence ?? null;
    if (q.type === "choice") {
      const value = (a.choice ?? (typeof a.answer === "string" ? a.answer : null)) ?? null;
      answers[qKey] = { value, confidence, probabilities };
    } else if (q.type === "score") {
      const idx = typeof a.score === "number" ? a.score : null;
      const value = idx != null ? (q.criteria[idx] ?? (q.criteria[idx - 1] ?? idx)) : null;
      answers[qKey] = { value, confidence, probabilities };
    } else {
      // 实测契约（jev-1.13.0）：noul 返回「是」的概率浮点（如 0.99）；value 按阈值 0.5 归一为布尔，
      // 概率原值放进 probabilities.true/false 供调用方自设阈值（校准概率是 Jev 的核心价值）
      const p = typeof a.noul === "number" ? a.noul : null;
      const value = p === null ? null : p >= 0.5;
      answers[qKey] = {
        value,
        confidence,
        probabilities: p === null ? probabilities : { true: p, false: 1 - p },
      };
    }
  }
  return { answers, model: data.model ?? null, raw: data };
}
