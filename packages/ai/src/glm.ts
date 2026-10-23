/**
 * GLM 客户端 —— OpenAI 兼容协议（智谱开放平台）
 * 环境变量：ZHIPUAI_API_KEY / ZHIPUAI_BASE_URL / GLM_MODEL / GLM_TRANSPORT
 * 传输层（REQ-004 FR-D1 / 4-E）：
 *   GLM_TRANSPORT=sdk     Vercel AI SDK（@ai-sdk/openai-compatible）——默认。重试/降级/熔断为策略层保留，
 *                         GLM 私有扩展（thinking/reasoning_effort/max_tokens）经 body 补丁 fetch 注入。
 *                         切换前经 poc-20 实测对照（SDK 78% ≥ legacy 67%，同参同模型）。
 *   GLM_TRANSPORT=legacy  自研 fetch 实现（等价回退开关，保留一个版本周期）
 */
import { generateText, tool, InvalidToolArgumentsError, type CoreMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError } from "@ai-sdk/provider";
import type { z } from "zod";

/** GLM 连接默认值——全仓唯一来源（apps/api config / PoC 报告均引用此处，REQ-004 AC-3） */
export const GLM_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export const GLM_DEFAULT_MODEL = "glm-5.3-flash";
/** 视觉模型默认值（REQ-020：健身课表截图等图片识别走 GLM_VISION_MODEL） */
export const GLM_DEFAULT_VISION_MODEL = "glm-4.5v";
const DEFAULT_BASE_URL = GLM_DEFAULT_BASE_URL;
const DEFAULT_MODEL = GLM_DEFAULT_MODEL;

/** 随消息附带的图片（OpenAI 兼容 image_url 载荷） */
export interface ChatImage {
  /** 图片 MIME（image/jpeg | image/png | image/webp | image/gif） */
  mimeType: string;
  /** 不含 data: 前缀的 base64 载荷 */
  base64: string;
}

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
  // 1113 资源包耗尽 / 1302 余额不足是持久欠费 → quota（触发 5 分钟全局熔断止血）；
  // 1301 并发超限是瞬时限流，与 429 同性质 → rate（重试+降级模型），归 quota 会让高峰期全站误熔断 5 分钟
  if (["1113", "1302"].includes(code)) return "quota";
  if (code === "1301") return "rate";
  if (code === "429" || status === 429) return "rate";
  if (["1000", "1001", "1002", "1003", "1005", "1006", "401"].includes(code) || status === 401 || status === 403) return "auth";
  if (status !== null && status >= 500) return "server";
  // 其余 4xx（如 1210 参数错且未带可识别业务码）：重试无意义——归 network 会被 chatAgent
  // 的重试集合（rate/server/network）白烧一次上游调用
  if (status !== null && status >= 400) return "badOutput";
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
  /** 附图（非空时整次调用改走视觉模型 GLM_VISION_MODEL；限流降级不切文本兜底模型——文本模型不收图） */
  images?: ChatImage[];
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

/** 本次调用的对话模型：带图走视觉模型（GLM_VISION_MODEL），否则主模型 */
function chatModelOf(opts: ChatOptions): string {
  if (opts.images?.length) return process.env.GLM_VISION_MODEL || GLM_DEFAULT_VISION_MODEL;
  return process.env.GLM_MODEL ?? DEFAULT_MODEL;
}

/** 视觉调用当前生效的模型名（供审计 model 字段，与 chatModelOf 带图分支一致） */
export function activeVisionModel(): string {
  return process.env.GLM_VISION_MODEL || GLM_DEFAULT_VISION_MODEL;
}

/** 多模态 user content：纯文本给 string；带图给 OpenAI 兼容的 image_url 数组（legacy 直发，SDK 侧转换） */
type MultimodalPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
function userContentOf(opts: ChatOptions): string | MultimodalPart[] {
  if (!opts.images?.length) return opts.user;
  return [
    { type: "text", text: opts.user },
    ...opts.images.map((img) => ({ type: "image_url" as const, image_url: { url: `data:${img.mimeType};base64,${img.base64}` } })),
  ];
}

/** GLM 私有扩展（thinking/reasoning_effort/max_tokens 提升）按目标模型计算：
 * 只发给智谱端点（换 OpenAI 兼容端点会报未知字段）；legacy/sdk 两传输共用，保证降级模型不继承主模型的 5.x 扩展 */
function glmExtensions(m: string, base: string, opts: ChatOptions): Record<string, unknown> {
  if (!base.includes("bigmodel.cn")) return {};
  if (/glm-5\./i.test(m)) {
    // GLM-5.3 系列始终思考：不支持 thinking.type=disabled（报 1210）。
    // 官方迁移方案 = thinking enabled + reasoning_effort 控制思考强度（解析类任务用 low）；
    // 思考会占用输出 token，未显式指定上限时提升到 4096 防止 content 被截断。
    const ext: Record<string, unknown> = { thinking: { type: "enabled" }, reasoning_effort: opts.reasoningEffort ?? "low" };
    if (!opts.maxTokens) ext.max_tokens = 4096;
    return ext;
  }
  return { thinking: { type: opts.thinking ? "enabled" : "disabled" } };
}

/** 单轮对话，返回文本内容。timeoutMs 是所有重试的总预算（默认 30s）；429/5xx/超时/网络异常均重试；429 耗尽后降级 GLM_FALLBACK_MODEL */
export async function chat(opts: ChatOptions): Promise<string> {
  // 熔断为传输层不变量：所有入口（直调 chat 的 admin/拆解/画像/复盘输入等）在欠费冷却期内统一短路，
  // 不依赖各调用方自觉检查（parse/chatAgent 各自把门只护住了自己那条链）
  if (isQuotaTripped()) throw new GlmError("quota", "额度熔断生效中（5 分钟后自动恢复）");
  const key = process.env.ZHIPUAI_API_KEY;
  if (!key) throw new GlmError("auth", "缺少 ZHIPUAI_API_KEY（复制 .env.example 为 .env 并填入）");
  const base = process.env.ZHIPUAI_BASE_URL ?? DEFAULT_BASE_URL;
  const model = chatModelOf(opts);
  const fallback = process.env.GLM_FALLBACK_MODEL || "glm-4-flash";
  const userContent = userContentOf(opts);

  // GLM 私有扩展不再在顶层按主模型一次性构建：legacy 降级到 fallback 模型时必须按目标模型
  // 重算（glm-5.3 的 thinking enabled 发给 glm-4-flash 会报 1210，把限流降级通道本身打挂）
  const body: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 1024,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: userContent },
    ],
  };

  // 免费档高峰拥塞有两种形态：秒回 429、连接挂起——都按总预算重试，超预算即失败（上层降级规则引擎）。
  // legacy 与 sdk 共用同一套 attempt 循环（次数/退避/可重试判定一致），差异只在单次传输实现。
  // SDK provider 按 chat() 调用构建一次复用（旧版每次尝试重建——重试+降级模型一个预算内最多白建 10 次）；
  // AbortSignal 仍由 sdkOnce 每次尝试新建。fetch 补丁行为不变（扩展按请求体实际 model 现算，见 createSdkProvider）。
  let sdkProvider: ReturnType<typeof createSdkProvider> | undefined;
  const sdkProviderOnce = () => (sdkProvider ??= createSdkProvider(base, key, opts));
  const chatOnce = glmTransport() === "sdk"
    ? (m: string, deadline: number) => chatWithRetry(m, deadline, () => sdkOnce(m, deadline, opts, sdkProviderOnce()))
    : (m: string, deadline: number) => chatWithRetry(m, deadline, () => legacyOnce(m, deadline, opts, body));

  /** 重试驱动（legacy/sdk 共用）：总尝试 5 次，指数退避 1500ms*2^n（不超剩余预算）。
   * 可重试：HTTP 429/5xx、网络瞬断、空输出（content 与 reasoning 均空，max_tokens 被思考耗尽）；
   * 立即抛：quota/auth/参数类 GlmError（重试无意义）；超时（预算耗尽）即停不再重试。 */
  async function chatWithRetry(m: string, deadline: number, once: () => Promise<string>): Promise<string> {
    const maxAttempts = 5;
    let lastErr: Error = new Error(`GLM(${m}) 未响应`);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const remainMs = deadline - Date.now();
      if (remainMs <= 0) break;
      try {
        const content = await once();
        if (content) return content;
        // content 与 reasoning 均空 → 视为可重试失败，重试耗尽后按现有错误路径抛
        lastErr = new GlmError("badOutput", `GLM(${m}) 返回空内容`);
      } catch (e) {
        if (e instanceof GlmError) {
          // network 须重试（与注释/文档口径一致）：SDK 传输下 Node 网络瞬断被 @ai-sdk 包成
          // 无 statusCode 的 APICallError → classifySdkError 判 network——旧版直抛只剩 SDK 内部
          // maxRetries=2 兜底，外层 5 次预算/退避策略对网络类失效（chatAgent 的工具重试集合则包含 network）
          if (e.kind !== "rate" && e.kind !== "server" && e.kind !== "network") throw e; // 参数/鉴权/额度错误重试无意义
          lastErr = e;
        } else if (e instanceof Error && e.name === "AbortError") {
          // 总预算内的等待已耗尽（挂起的连接被掐断）——继续重试只会再超时
          lastErr = new GlmError("timeout", `GLM(${m}) 响应超时（预算耗尽）`);
          break;
        } else {
          lastErr = e instanceof Error ? e : new GlmError("network", String(e)); // 网络瞬断等其他异常：可重试
        }
      }
      if (attempt < maxAttempts) {
        const waitMs = Math.min(1500 * 2 ** (attempt - 1), deadline - Date.now());
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** legacy 单次传输：一次 fetch；res.ok 时返回 content/reasoning（可能为空串=失败信号，由重试驱动接手）；
   * 非 2xx 抛 GlmError（rate/server 由重试驱动接手，其余立即失败）。扩展按目标模型重算（与 sdkOnce 对齐） */
  async function legacyOnce(m: string, deadline: number, opts: ChatOptions, body: Record<string, unknown>): Promise<string> {
    const remainMs = deadline - Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Math.max(0, remainMs));
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...body, model: m, ...glmExtensions(m, base, opts) }),
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
        return String(json.choices?.[0]?.message?.reasoning_content ?? "");
      }
      const errBody = (await res.text()).slice(0, 300);
      throw new GlmError(classifyGlmFailure(res.status, errBody), `GLM(${m}) HTTP ${res.status}: ${errBody}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  try {
    return await chatOnce(model, deadline);
  } catch (e) {
    if (e instanceof GlmError && e.kind === "quota") tripQuotaBreaker();
    // 带图调用不切文本兜底模型（glm-4-flash 不收 image_url，切了必失败）——限流耗尽照常报错
    if (fallback && fallback !== model && !opts.images?.length && e instanceof GlmError && e.kind === "rate" && deadline - Date.now() > 5_000) {
      console.warn(`[ai] ${model} 持续限流，降级 ${fallback} 兜底`);
      return await chatOnce(fallback, deadline);
    }
    throw e;
  }
}

/** 从模型输出中剥出 JSON（容忍 markdown 代码围栏/前后废话） */
export function extractJson(raw: string): unknown {
  // 模型偶发输出多个围栏（先一段废话/示例围栏、真 JSON 在后面）：非贪婪只取第一个会拿错体。
  // 扫描全部 ``` 围栏体，逐个尝试「括号配平 + JSON.parse」，取第一个成功者
  const bodies: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  for (let fm = fenceRe.exec(raw); fm !== null; fm = fenceRe.exec(raw)) bodies.push(fm[1]);
  // 无围栏或全部围栏体失败 → 对原文做同款解析（未配平仍由 JSON.parse 报错）
  bodies.push(raw);
  let parseErr: unknown;
  for (const body of bodies) {
    const start = body.search(/[{[]/);
    if (start === -1) continue;
    try {
      return JSON.parse(body.slice(start, jsonBodyEnd(body, start)));
    } catch (e) {
      parseErr = e;
    }
  }
  if (parseErr === undefined) throw new Error("输出中无 JSON");
  throw parseErr instanceof Error ? parseErr : new Error("输出中无 JSON");
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
 * 4-E（FR-D2.4）：2 次重试 + 总预算控制（预算按 deadline 贯穿各次尝试，单次超时取剩余而非固定 30s）；
 * 鉴权/参数类与超时（AbortError→转写超时）立即失败不重试——
 * 超时重试会把单次 30s 拖成 ~90s，与 chat()「预算耗尽即停」语义一致。 */
export async function transcribeAudio(opts: TranscribeOptions): Promise<string> {
  // 熔断传输层不变量（与 chat() 同口径）：欠费冷却期内直接短路，不再白打上游 3 次
  if (isQuotaTripped()) throw new GlmError("quota", "额度熔断生效中（5 分钟后自动恢复）");
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000) * 3; // 总预算 = 单次默认时长的 3 倍（与最多 3 次尝试对齐）
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const remainMs = deadline - Date.now();
    if (remainMs <= 0 && attempt > 1) break; // 预算耗尽即停（首次必须至少尝试，避免 0 预算永远转写失败）
    try {
      return await transcribeOnce({ ...opts, timeoutMs: remainMs > 0 ? remainMs : opts.timeoutMs });
    } catch (e) {
      lastErr = e;
      if (e instanceof GlmError && e.kind === "auth") throw e; // 缺 Key：重试无意义（旧版文案不含 HTTP 4xx 会被白重试 3 次）
      if (e instanceof GlmError && (e.kind === "quota" || e.kind === "badOutput")) throw e; // 欠费：熔断已触发；参数类 4xx：重试只会重复失败
      if (e instanceof Error && /HTTP 4(0[13]|0[04])/.test(e.message)) throw e; // 鉴权/参数类不重试
      if (e instanceof Error && /转写超时/.test(e.message)) throw e; // 单次预算已耗尽，重试只会再超时
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
    if (!res.ok) {
      // 与 chat() 同口径分类：quota 类（欠费/配额尽）触发熔断，转写调用方收到 GlmError("quota")
      // 后熔断期内直接短路——旧版裸 Error 不熔断，欠费期每条语音仍白打 3 次上游
      const kind = classifyGlmFailure(res.status, text);
      if (kind === "quota") tripQuotaBreaker();
      throw new GlmError(kind, "GLM-ASR HTTP " + res.status + ": " + text.slice(0, 300));
    }
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

/** SDK provider（Vercel AI SDK）构建：chat() 顶层每调用一次，全部尝试（主模型重试+降级模型）复用。
 * GLM 私有扩展经 body 补丁 fetch 注入——扩展按请求体里的实际 model 现算（generateText 恒带 model 字段，
 * 与旧版「逐次构建、兜底取本次尝试的 m」在线上行为等价），保证降级模型不继承主模型的 5.x 扩展；
 * AbortSignal 不在此构建——由 sdkOnce 每次尝试新建（重试/超时各自独立）。 */
function createSdkProvider(base: string, key: string, opts: ChatOptions) {
  return createOpenAICompatible({
    name: "glm",
    baseURL: base,
    apiKey: key,
    fetch: async (input: any, init: any) => {
      if (init?.body && typeof init.body === "string") {
        try {
          const parsed = JSON.parse(init.body);
          if (typeof parsed.model === "string") {
            Object.assign(parsed, glmExtensions(parsed.model, base, opts));
            init = { ...init, body: JSON.stringify(parsed) };
          }
        } catch {
          /* 非 JSON body 原样透传 */
        }
      }
      return fetch(input, init);
    },
  });
}

/** SDK 单次调用（Vercel AI SDK）：provider 由 chat() 复用传入；结构化错误 → GlmError 分类。
 * 带图时 user 转多模态 messages（image part 传 data URL，openai-compatible 层自动映射 image_url） */
async function sdkOnce(
  m: string,
  deadline: number,
  opts: ChatOptions,
  provider: ReturnType<typeof createSdkProvider>,
): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, deadline - Date.now()));
  try {
    const messages = opts.images?.length
      ? [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: opts.user },
              ...opts.images.map((img) => ({ type: "image" as const, image: `data:${img.mimeType};base64,${img.base64}` })),
            ],
          },
        ]
      : undefined;
    const { text, reasoning, usage } = await generateText({
      model: provider.chatModel(m),
      system: opts.system,
      ...(messages ? { messages } : { prompt: opts.user }),
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
    // 思考模型兜底（与 legacy 对齐）：max_tokens 被思考耗尽时 text 可能为空，思考文本里通常已有答案 JSON
    return text || reasoning || "";
  } catch (e) {
    throw classifySdkError(e, m);
  } finally {
    clearTimeout(timer);
  }
}

/** SDK 异常 → GlmError 分类（chat 单轮与 chatAgent 共用）。
 * 分类依据必须是原始响应体（业务码在其中）：e.message 只有智谱的业务文案，
 * 拿它分类会让 1113/1302 永远落不进 quota → 熔断成为死代码 */
function classifySdkError(e: unknown, m: string): Error {
  if (APICallError.isInstance(e)) {
    const status = e.statusCode ?? null;
    const bodyText = typeof (e as { responseBody?: unknown }).responseBody === "string"
      ? (e as { responseBody: string }).responseBody
      : e.message;
    return new GlmError(classifyGlmFailure(status, bodyText), `GLM(${m}) HTTP ${status ?? "?"}: ${String(e.message).slice(0, 200)}`);
  }
  if (e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message))) {
    return new GlmError("timeout", `GLM(${m}) 响应超时（预算耗尽）`);
  }
  return e instanceof Error ? e : new GlmError("network", String(e));
}

// ---- 对话助手 agent 循环（REQ-015 批次 A）：多轮对话 + 工具调用，AI SDK maxSteps 驱动 ----

/** 喂给模型的历史轮次（DB 落库消息的瘦身形态：只回放 user/assistant 文本，工具轨迹已凝结在助手回答里） */
export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

/** 协议无关工具规格：api 层注册（SQL/查询实现），本包只负责转成 AI SDK tool；
 * name/description/zod 参数契约 + execute 与 MCP registerTool 同构——批次 D 包 MCP 端点可零改动复用 */
export interface AgentToolSpec {
  name: string;
  description: string;
  parameters: z.ZodType<Record<string, unknown>>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ChatAgentOptions {
  system: string;
  messages: AgentTurn[];
  tools: AgentToolSpec[];
  /** 单次问答允许的最大模型轮数（工具调用循环上限）；默认 5 */
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  /** 整个 agent 循环（含全部工具往返）的总预算；默认 60s */
  timeoutMs?: number;
  onUsage?: (usage: ChatUsage) => void;
}

export interface ChatAgentResult {
  /** 助手的最终回答（工具循环结束后的文本） */
  text: string;
  /** 本轮发生的工具调用轨迹 [{name, args}]——前端「已查询…」提示与审计用 */
  toolCalls: Array<{ name: string; args: unknown }>;
}

/** 对话助手：带工具调用的多轮循环。与 chat()（单轮抽取）分立——消息形态、预算、错误策略都不同：
 * 工具循环单次 LLM 调用会有 1+ 步，总预算默认 60s；rate/server/network 失败整循环重试一次
 * （工具约定只读幂等，重跑安全）；quota 触发全局熔断与 chat() 同口径。 */
export async function chatAgent(opts: ChatAgentOptions): Promise<ChatAgentResult> {
  const key = process.env.ZHIPUAI_API_KEY;
  if (!key) throw new GlmError("auth", "缺少 ZHIPUAI_API_KEY（复制 .env.example 为 .env 并填入）");
  if (isQuotaTripped()) throw new GlmError("quota", "额度熔断生效中（5 分钟后自动恢复）");
  const base = process.env.ZHIPUAI_BASE_URL ?? DEFAULT_BASE_URL;
  const model = process.env.GLM_MODEL ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? 2048;

  const provider = createSdkProvider(base, key, {
    // glmExtensions 据此拼 thinking/reasoning_effort：助手对话与抽取同样 low；显式给 maxTokens 则不再补 4096
    system: "",
    user: "",
    reasoningEffort: "low",
    maxTokens,
  });

  const tools = Object.fromEntries(
    opts.tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        parameters: t.parameters,
        execute: async (args: unknown) => {
          try {
            return await t.execute(args as Record<string, unknown>);
          } catch (e) {
            // 工具失败不炸整个循环：错误对象回传模型，由其改道（换参数重查或如实告知查询失败）
            return { error: e instanceof Error ? e.message : String(e) };
          }
        },
      }),
    ]),
  );

  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  let lastErr: unknown = new GlmError("network", `GLM(${model}) 未响应`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remainMs = deadline - Date.now();
    if (remainMs <= 0) break;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), remainMs);
    try {
      const res = await generateText({
        model: provider.chatModel(model),
        system: opts.system,
        messages: opts.messages as CoreMessage[],
        tools,
        maxSteps: opts.maxSteps ?? 5,
        temperature: opts.temperature ?? 0.3,
        maxTokens,
        abortSignal: ctl.signal,
      });
      const usage = res.usage;
      if (opts.onUsage && usage) {
        opts.onUsage({
          prompt_tokens: Number(usage.promptTokens ?? 0),
          completion_tokens: Number(usage.completionTokens ?? 0),
        });
      }
      const toolCalls = (res.steps ?? []).flatMap((s) =>
        (s.toolCalls ?? []).map((tc) => ({ name: tc.toolName, args: tc.args })),
      );
      // res.text 只含最后一步：模型常在发起工具调用的同一步把说明写完，工具结果回来后末步无新文本
      // （实测 propose_fitness_plan 后空回复）——累积各步非空文本，全程未产文本才落到 reasoning
      const text =
        (res.steps ?? []).map((s) => (s.text ?? "").trim()).filter(Boolean).join("\n") ||
        res.text ||
        res.reasoning ||
        "";
      if (!text && toolCalls.length === 0) throw new GlmError("badOutput", "GLM 对话返回空内容");
      return { text, toolCalls };
    } catch (e) {
      // 工具参数 schema 级违规（二十轮）：AI SDK 在 execute 之前校验工具实参，失败抛
      // InvalidToolArgumentsError 直达这里——旧版经 classifySdkError 原样透传为裸 500。
      // 收敛为 badOutput（不重试、用户拿到友好文案），模型侧自纠由工具参数层的放宽+execute 钳制承接
      if (InvalidToolArgumentsError.isInstance(e)) {
        throw new GlmError("badOutput", `GLM 工具调用参数不合法（${String((e as { text?: string }).text ?? e.message).slice(0, 120)}）`);
      }
      const err = classifySdkError(e, model);
      if (err instanceof GlmError) {
        if (err.kind === "quota") {
          tripQuotaBreaker();
          throw err;
        }
        if ((err.kind === "rate" || err.kind === "server" || err.kind === "network") && attempt < 2) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new GlmError("network", "GLM 对话未响应");
}
