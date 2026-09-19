/**
 * GLM 客户端 —— OpenAI 兼容协议（智谱开放平台）
 * 环境变量：ZHIPUAI_API_KEY / ZHIPUAI_BASE_URL / GLM_MODEL
 */

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-5.3-flashx";

export function hasApiKey(): boolean {
  return Boolean(process.env.ZHIPUAI_API_KEY);
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
  if (!key) throw new Error("缺少 ZHIPUAI_API_KEY（复制 .env.example 为 .env 并填入）");
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
  async function chatOnce(m: string, deadline: number): Promise<string> {
    const maxAttempts = 5;
    let lastErr: unknown = new Error(`GLM(${m}) 未响应`);
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
        lastErr = new Error(`GLM(${m}) HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
        if (res.status !== 429 && res.status < 500) throw lastErr; // 参数/鉴权错误重试无意义
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          // 总预算内的等待已耗尽（挂起的连接被掐断）——继续重试只会再超时
          lastErr = new Error(`GLM(${m}) 响应超时（预算耗尽）`);
          break;
        }
        lastErr = e; // 网络瞬断等其他异常：可重试
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
    if (fallback && fallback !== model && String(e).includes("HTTP 429") && deadline - Date.now() > 5_000) {
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
  return JSON.parse(body.slice(start));
}

/** ASR 模型名：优先 GLM_ASR_MODEL 环境变量，缺省 glm-asr */
export function asrModel(): string {
  return process.env.GLM_ASR_MODEL ?? "glm-asr-2512";
}

export interface TranscribeOptions {
  /** 音频二进制 */
  data: Buffer;
  /** 文件名（扩展名用于服务端识别格式，如 voice.webm / voice.wav / voice.mp3） */
  filename: string;
  /** MIME 类型（如 audio/webm） */
  contentType?: string;
  timeoutMs?: number;
}

/** 语音转文字：POST /paas/v4/audio/transcriptions（OpenAI 兼容），返回转写文本 */
export async function transcribeAudio(opts: TranscribeOptions): Promise<string> {
  const key = process.env.ZHIPUAI_API_KEY;
  if (!key) throw new Error("缺少 ZHIPUAI_API_KEY（复制 .env.example 为 .env 并填入）");
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
    return String(parsed.text ?? "").trim();
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("GLM-ASR 转写超时");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

