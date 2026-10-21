/**
 * 语音动态音频上传（POST /api/entries/:id/audio，multipart file=16k wav）。
 * 统一走 apiForm()（Bearer + apiBase 与全站一致）：旧裸 fetch 在分离部署（NEXT_PUBLIC_API_BASE）
 * 或 Token 鉴权下会 401/打到静态 origin 404。失败抛 Error（message 为服务端可读文案）。
 */
import { apiForm } from "@/shared/api";

export async function uploadEntryAudio(entryId: string, wav: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", new File([wav], "voice.wav", { type: "audio/wav" }));
  try {
    await apiForm(`/api/entries/${entryId}/audio`, form);
  } catch (e) {
    throw new Error(e instanceof Error && e.message ? e.message : `语音上传失败`);
  }
}
