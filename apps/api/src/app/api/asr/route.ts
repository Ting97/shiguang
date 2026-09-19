import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasApiKey, transcribeAudio, asrModel } from "@shiguangri/ai";
import { writeAuditRecord } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB 上限（约几分钟语音）

/**
 * POST /api/asr —— 语音转文字（multipart: file）
 * 转发智谱 GLM-ASR；返回 { text }，空音频返回空文本由前端提示。
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!hasApiKey()) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少音频文件" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "音频为空，请重试" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "音频太长（上限 15MB）" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const startedAt = Date.now();
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    const text = await transcribeAudio({
      data: buffer,
      filename: file.name || "voice.webm",
      contentType: file.type || "audio/webm",
      timeoutMs: 45_000,
      onUsage: (u) => (usage = u),
    });
    void writeAuditRecord({
      userId: user.id,
      stage: "asr",
      model: asrModel(),
      latencyMs: Date.now() - startedAt,
      textLen: text?.length ?? 0,
      ok: Boolean(text),
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
    if (!text) {
      return NextResponse.json({ error: "没有听清内容，请再试一次" }, { status: 422 });
    }
    return NextResponse.json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void writeAuditRecord({
      userId: user.id,
      stage: "asr",
      model: asrModel(),
      ok: false,
      error: msg.slice(0, 300),
    });
    // 429 多为资源包不足/限流：对用户友好化（管理员侧去智谱控制台买 GLM-ASR 资源包即可恢复）
    const friendly = msg.includes("429") || msg.includes("1113")
      ? "语音识别服务暂不可用（资源包不足或限流），请稍后重试或使用键盘输入"
      : `语音识别失败：${msg}`;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
