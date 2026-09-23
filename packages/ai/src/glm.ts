/**
 * GLM 客户端 —— OpenAI 兼容协议（智谱开放平台）
 * 环境变量：ZHIPUAI_API_KEY / ZHIPUAI_BASE_URL / GLM_MODEL / GLM_TRANSPORT
 * 传输层（REQ-004 FR-D1 / 4-E）：
 *   GLM_TRANSPORT=sdk     Vercel AI SDK（@ai-sdk/openai-compatible）——默认。重试/降级/熔断为策略层保留，
 *                         GLM 私有扩展（thinking/reasoning_effort/max_tokens）经 body 补丁 fetch 注入。
 *                         切换前经 poc-20 实测对照（SDK 78% ≥ legacy 67%，同参同模型）。
 *   GLM_TRANSPORT=legacy  自研 fetch 实现（等价回退开关，保留一个版本周期）
 */
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError } from "@ai-sdk/provider";

/** GLM 连接默认值——全仓唯一来源（apps/api config / PoC 报告均引用此处，REQ-004 AC-3） */
export const GLM_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export const GLM_DEFAULT_MODEL = "glm-5.3-flash";
const DEFAULT_BASE_URL = GLM_DEFAULT_BASE_URL;
const DEFAULT_MODEL = GLM_DEFAULT_MODEL;

/** 传输层选择：sdk = Vercel AI SDK（默认）；legacy = 自研 fetch（等价回退开关，GLM_TRANSPORT=legacy） */
export function glmTransport(): "sdk" | "legacy" {
  const t = (process.env.GLM_TRANSPORT ?? "sdk").toLowerCase();
  return t === "legacy" ? "legacy" : "sdk";
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ZHIPUAI_API_KEY);
}

/** GLM 失败分类：上层据此决定降级策略（quota 触发熔断，其余正常降级规则引擎） */
export type GlmErrorKind = "quota" | "auth" | "rate" | "server" | "network" | "timeout" | "badOutput";

export class GlmError extends Error {
  kind: GlmErrorKind;
  constructor(kind: GlmErrorKind, message: string) {
    super(message);
    this.name = "GlmError";
    this.kind = kind;
  }
}

/** 从智谱响应体/错误串解析业务错误码 → 失败分类（1113 资源包耗尽、1302 余额不足、1002/401 鉴权…） */
export function classifyGlmFailure(status: number | null, bodyText: string): GlmErrorKind {
  const code = bodyText.match(/"code"\s*:\s*"?(\d{3,4})"?/)?.[1] ?? "";
  if (["1113", "1302", "1301"].includes(code)) return "quota"; // 资源包用尽/欠费/并发超限
  if (code === "429" || status === 429) return "rate";
  if (["1000", "1001", "1002", "1003", "1005", "1006", "401"].includes(code) || status === 401 || status === 403) return "auth";
  if (status !== null && status >= 500) return "server";
  return "network";
}

// ---- 额度熔断：quota 类失败后 5 分钟内直接走规则，避免反复请求已欠费接口 ----
let quotaTrippedAt = 0;
const QUOTA_COOLDOWN_MS = 5 * 60_000;

/** 额度熔断是否生效中 */
export function isQuotaTripped(): boolean {
  return quotaTrippedAt > 0 && Date.now() - quotaTrippedAt < QUOTA_COOLDOWN_MS;
}

export function tripQuotaBreaker(): void {
  quotaTrippedAt = Date.now();
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface ChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 思考模式（GLM-4.5+ 混合思考模型有效）；默认关闭——抽取类任务开思考会拖慢响应且推理 token 占用 max_tokens */
  thinking?: boolean;
  /** 成功响应后回调 token 用量（重试时以最后一次为准），供审计/成本核算 */
  onUsage?: (usage: ChatUsage) => void;
  /** 思考强度（仅 GLM-5.3 系列生效，仅支持 low/high/max）；解析类任务默认 low */
  reasoningEffort?: "low" | "high" | "max";
}

/** 单轮对话，返回文本内容。timeoutMs 是所有重试的总预算（默认 30s）；429/5xx/超时/网络异常均重试；429 耗尽后降级 GLM_FALLBACK_MODEL */
export async function chat(opts: ChatOptions): Promise<string> {
  const key = process.env.ZHIPUAI_API_KEY;
  if (!key) throw new GlmError("auth", "缺少 ZHIPUAI_API_KEY（复制 .env.example 为 .env 并填入）");
  const base = process.env.ZHIPUAI_BASE_URL ?? DEFAULT_BASE_URL;
  const model = process.env.GLM_MODEL ?? DEFAULT_MODEL;
  const fallback = process.env.GLM_FALLBACK_MODEL || "glm-4-flash";

  const body: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 1024,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  // thinking 字段是智谱扩展：只发给智谱端点，避免换 OpenAI 兼容端点时报未知字段
  if (base.includes("bigmodel.cn")) {
    if (/glm-5\./i.test(model)) {
      // GLM-5.3 系列始终思考：不支持 thinking.type=disabled（报 1210）。
      // 官方迁移方案 = thinking enabled + reasoning_effort 控制思考强度（解析类任务用 low）；
      // 思考会占用输出 token，默认上限提升到 4096 防止 content 被截断。
      body.thinking = { type: "enabled" };
      body.reasoning_effort = opts.reasoningEffort ?? "low";
      if (!opts.maxTokens) body.max_tokens = 4096;
    } else {
      body.thinking = { type: opts.thinking ? "enabled" : "disabled" };
    }
  }

  // 免费档高峰拥塞有两种形态：秒回 429、连接挂起——都按总预算重试，超预算即失败（上层降级规则引擎）
  const chatOnce = glmTransport() === "sdk"
    ? (m: string, deadline: number) => sdkOnce(m, deadline, opts)
    : (m: string, deadline: number) => legacyOnce(m, deadline, opts, body);

  async function legacyOnce(m: string, deadline: number, opts: ChatOptions, body: Record<string, unknown>): Promise<string> {
    const maxAttempts = 5;
    let lastErr: Error = new Error(`GLM(${m}) 未响应`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remainMs = deadline - Date.now();
      if (remainMs <= 0) break;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), remainMs);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ ...body, model: m }),
          signal: ctl.signal,
        });
        if (res.ok) {
          const json = (await res.json()) as any;
          const u = json.usage;
          if (opts.onUsage && u) {
            opts.onUsage({
              prompt_tokens: Number(u.prompt_tokens ?? 0),
              completion_tokens: Number(u.completion_tokens ?? 0),
            });
          }
          const content = String(json.choices?.[0]?.message?.content ?? "");
          if (content) return content;
          // 思考模型兜底：max_tokens 被思考耗尽时 content 可能为空，思考文本里通常已有答案 JSON
          const reasoning = String(json.choices?.[0]?.message?.reasoning_content ?? "");
          if (reasoning) return reasoning;
          return "";
        }
        const errBody = (await res.text()).slice(0, 300);
        const httpErr = new GlmError(classifyGlmFailure(res.status, errBody), `GLM(${m}) HTTP ${res.status}: ${errBody}`);
        lastErr = httpErr;
        if (httpErr.kind !== "rate" && httpErr.kind !== "server") throw httpErr; // 参数/鉴权/额度错误重试无意义
      } catch (e) {
        if (e instanceof GlmError) throw e;
        if (e instanceof Error && e.name === "AbortError") {
          // 总预算内的等待已耗尽（挂起的连接被掐断）——继续重试只会再超时
          lastErr = new GlmError("timeout", `GLM(${m}) 响应超时（预算耗尽）`);
          break;
        }
        lastErr = e instanceof Error ? e : new GlmError("network", String(e)); // 网络瞬断等其他异常：可重试
      } finally {
        clearTimeout(timer);
      }
      if (attempt < maxAttempts) {
        const waitMs = Math.min(1500 * 2 ** (attempt - 1), deadline - Date.now());
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  try {
    return await chatOnce(model, deadline);
  } catch (e) {
    if (e instanceof GlmError && e.kind === "quota") tripQuotaBreaker();
    if (fallback && fallback !== model && e instanceof GlmError && e.kind === "rate" && deadline - Date.now() > 5_000) {
      console.warn(`[ai] ${model} 持续限流，降级 ${fallback} 兜底`);
      return await chatOnce(fallback, deadline);
    }
    throw e;
  }
}

/** 从模型输出中剥出 JSON（容忍 markdown 代码围栏/前后废话） */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.search(/[{[]/);
  if (start === -1) throw new Error("输出中无 JSON");
  // 括号配平截取第一个完整 JSON 值：模型常在 JSON 后补话（"以上是结果"），
  // 旧实现切到串尾导致 JSON.parse 必炸、白白多烧一次修复重问
  return JSON.parse(body.slice(start, jsonBodyEnd(body, start)));
}

/** 从 start 起扫描至括号配平处，返回完整 JSON 的结束下标（字符串字面量内的括号/转义不参与配平；未配平则退回串尾，交由 JSON.parse 报错） */
function jsonBodyEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return s.length;
}

/** ASR 模型名：优先 GLM_ASR_MODEL 环境变量，缺省 glm-asr */
export function asrModel(): string {
  return process.env.GLM_ASR_MODEL ?? "glm-asr-2512";
}

/** 当前生效的对话模型名（供审计记录 model 字段，与 chat() 的取值逻辑一致） */
export function activeModel(): string {
  return process.env.GLM_MODEL ?? DEFAULT_MODEL;
}

export interface TranscribeOptions {
  /** 音频二进制 */
  data: Buffer;
  /** 文件名（扩展名用于服务端识别格式，如 voice.webm / voice.wav / voice.mp3） */
  filename: string;
  /** MIME 类型（如 audio/webm） */
  contentType?: string;
  timeoutMs?: number;
  /** 成功响应后回调 token 用量（ASR 只计输出，prompt 恒 0），供审计/成本核算 */
  onUsage?: (usage: ChatUsage) => void;
}

/** 语音转文字：POST /paas/v4/audio/transcriptions（OpenAI 兼容），返回转写文本。
 * 4-E（FR-D2.4）：2 次重试 + 总预算控制（timeoutMs 为单次上限，重试共用该预算的一半粒度）。 */
export async function transcribeAudio(opts: TranscribeOptions): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await transcribeOnce(opts);
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /HTTP 4(0[13]|0[04])/.test(e.message)) throw e; // 鉴权/参数类不重试
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function transcribeOnce(opts: TranscribeOptions): Promise<string> {
  const key = process.env.ZHIPUAI_API_KEY;
  if (!key) throw new GlmError("auth", "缺少 ZHIPUAI_API_KEY（复制 .env.example 为 .env 并填入）");
  const base = process.env.ZHIPUAI_BASE_URL ?? DEFAULT_BASE_URL;
  const form = new FormData();
  form.append("model", asrModel());
  form.append("file", new Blob([new Uint8Array(opts.data)], { type: opts.contentType ?? "audio/webm" }), opts.filename);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error("GLM-ASR HTTP " + res.status + ": " + text.slice(0, 300));
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { throw new Error("GLM-ASR 响应非 JSON：" + text.slice(0, 120)); }
    // usage 字段各版本不一（tokens / completion_tokens / total_tokens）：有啥取啥，全部记入 completion（ASR 只计输出）
    const u = parsed.usage;
    const outTokens = Number(u?.completion_tokens ?? u?.tokens ?? u?.total_tokens ?? 0) || 0;
    if (opts.onUsage) opts.onUsage({ prompt_tokens: 0, completion_tokens: outTokens });
    return String(parsed.text ?? "").trim();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("GLM-ASR 转写超时");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** SDK 单次调用（Vercel AI SDK）：GLM 私有扩展经 body 补丁 fetch 注入；结构化错误 → GlmError 分类 */
async function sdkOnce(m: string, deadline: number, opts: ChatOptions): Promise<string> {
  const key = process.env.ZHIPUAI_API_KEY as string;
  const base = process.env.ZHIPUAI_BASE_URL ?? DEFAULT_BASE_URL;
  const extensions = (model: string): Record<string, unknown> => {
    const ext: Record<string, unknown> = {};
    if (base.includes("bigmodel.cn")) {
      if (/glm-5\./i.test(model)) {
        // GLM-5.3 始终思考：thinking enabled + reasoning_effort 控强度；思考占输出 token，上限提至 4096
        ext.thinking = { type: "enabled" };
        ext.reasoning_effort = opts.reasoningEffort ?? "low";
      } else {
        ext.thinking = { type: opts.thinking ? "enabled" : "disabled" };
      }
    }
    return ext;
  };
  const provider = createOpenAICompatible({
    name: "glm",
    baseURL: base,
    apiKey: key,
    fetch: async (input: any, init: any) => {
      if (init?.body && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body);
          const target = typeof parsed.model === "string" ? parsed.model : m;
          if (!opts.maxTokens && /glm-5\./i.test(target)) parsed.max_tokens = 4096;
          Object.assign(parsed, extensions(target));
          init = { ...init, body: JSON.stringify(parsed) };
        } catch {
          /* 非 JSON body 原样透传 */
        }
      }
      return fetch(input, init);
    },
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, deadline - Date.now()));
  try {
    const { text, usage } = await generateText({
      model: provider.chatModel(m),
      system: opts.system,
      prompt: opts.user,
      temperature: opts.temperature ?? 0.1,
      maxTokens: opts.maxTokens ?? 1024,
      abortSignal: ctl.signal,
    });
    if (opts.onUsage && usage) {
      opts.onUsage({
        prompt_tokens: Number(usage.promptTokens ?? 0),
        completion_tokens: Number(usage.completionTokens ?? 0),
      });
    }
    return text ?? "";
  } catch (e) {
    if (APICallError.isInstance(e)) {
      const status = e.statusCode ?? null;
      throw new GlmError(classifyGlmFailure(status, e.message), `GLM(${m}) HTTP ${status ?? "?"}: ${String(e.message).slice(0, 200)}`);
    }
    if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) {
      throw new GlmError("timeout", `GLM(${m}) 响应超时（预算耗尽）`);
    }
    throw e instanceof Error ? e : new GlmError("network", String(e));
  } finally {
    clearTimeout(timer);
  }
}
