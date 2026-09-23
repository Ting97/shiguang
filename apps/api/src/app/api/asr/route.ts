import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { hasApiKey, transcribeAudio, asrModel } from "@shiguangri/ai";
import { withAuth } from "@/server/platform/http/route";
import { writeAuditRecord } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15MB 上限（约几分钟语音）

/** 音频魔数嗅探：GLM-ASR 只认 wav/mp3，其余格式先经 FFMPEG_PATH 转成 16k 单声道 wav */
function sniffFormat(buf: Buffer): "wav" | "mp3" | "other" {
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (buf.length > 3 && (buf.toString("ascii", 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return "mp3";
  return "other";
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: "ignore" });
    p.on("error", (e) => reject(new Error(`ffmpeg 启动失败：${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });
}

/** 非 wav/mp3（安卓 MediaRecorder 只能出 3gp/m4a 等）→ 统一转 16k 单声道 wav 再送识别 */
async function toWav(buffer: Buffer, contentType: string): Promise<Buffer> {
  const ffmpeg = process.env.FFMPEG_PATH;
  if (!ffmpeg) {
    throw new Error("该音频格式暂不支持，请使用键盘输入或重试");
  }
  const ext = contentType.includes("mp4") || contentType.includes("m4a") ? "m4a" : contentType.includes("webm") ? "webm" : "bin";
  const dir = await mkdtemp(join(tmpdir(), "asr-"));
  try {
    const src = join(dir, `in.${ext}`);
    const dst = join(dir, "out.wav");
    await writeFile(src, buffer);
    await runFfmpeg(ffmpeg, ["-y", "-i", src, "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", dst]);
    return await readFile(dst);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * POST /api/asr —— 语音转文字（multipart: file）
 * 转发智谱 GLM-ASR；返回 { text }，空音频返回空文本由前端提示。
 * Web 端已重采样为 wav；安卓受 MediaRecorder 限制产出 m4a 等，由 FFMPEG_PATH 转码兜底。
 */
export const POST = withAuth(async (req, { user }) => {
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
    let buffer = Buffer.from(await file.arrayBuffer());
    const format = sniffFormat(buffer);
    let filename = file.name || "voice.webm";
    let contentType = file.type || "audio/webm";
    if (format === "other") {
      buffer = Buffer.from(await toWav(buffer, contentType));
      filename = "voice.wav";
      contentType = "audio/wav";
    }
    const startedAt = Date.now();
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    const text = await transcribeAudio({
      data: buffer,
      filename,
      contentType,
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
    // 429 多为资源包不足/限流：对用户友好化（管理员侧去智谱控制台买 GLM-ASR 资源包即可恢复）；
    // 其余固定文案，不把上游原始信息外泄到响应（细节只进服务端日志）
    const friendly = msg.includes("429") || msg.includes("1113")
      ? "语音识别服务暂不可用（资源包不足或限流），请稍后重试或使用键盘输入"
      : "语音识别失败，请稍后重试";
    console.warn(`[asr] 识别失败: ${msg.slice(0, 300)}`);
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
});
