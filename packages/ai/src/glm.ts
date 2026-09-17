/**
 * GLM 客户端 —— OpenAI 兼容协议（智谱开放平台）
 * 环境变量：ZHIPUAI_API_KEY / ZHIPUAI_BASE_URL / GLM_MODEL
 */

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_MODEL = "glm-4.7-flash";

export function hasApiKey(): boolean {
  return Boolean(process.env.ZHIPUAI_API_KEY);
}

interface ChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 思考模式（GLM-4.5+ 混合思考模型有效）；默认关闭——抽取类任务开思考会拖慢响应且推理 token 占用 max_tokens */
  thinking?: boolean;
}

/** 单轮对话，返回文本内容。429/5xx 指数退避重试；免费档高峰拥塞耗尽重试后自动降级 GLM_FALLBACK_MODEL */
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
    body.thinking = { type: opts.thinking ? "enabled" : "disabled" };
  }

  async function chatOnce(m: string): Promise<string> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
      let res: Response;
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ ...body, model: m }),
          signal: ctl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const json = (await res.json()) as any;
        return json.choices?.[0]?.message?.content ?? "";
      }
      const errText = (await res.text()).slice(0, 300);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`GLM(${m}) HTTP ${res.status}: ${errText}`);
      }
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1) + Math.random() * 500));
    }
    throw new Error("unreachable");
  }

  try {
    return await chatOnce(model);
  } catch (e) {
    if (fallback && fallback !== model && String(e).includes("HTTP 429")) {
      console.warn(`[ai] ${model} 持续限流，降级 ${fallback} 兜底`);
      return await chatOnce(fallback);
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
