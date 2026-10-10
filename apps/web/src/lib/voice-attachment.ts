/**
 * 语音动态音频上传（POST /api/entries/:id/audio，multipart file=16k wav）。
 * 失败抛 Error（message 为服务端可读文案）。
 */
export async function uploadEntryAudio(entryId: string, wav: Blob): Promise<void> {
  const form = new FormData();
  form.append("file", new File([wav], "voice.wav", { type: "audio/wav" }));
  const r = await fetch(`/api/entries/${entryId}/audio`, { method: "POST", body: form });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error(j?.message ?? `语音上传失败（${r.status}）`);
  }
}

/** 秒数 → m:ss（语音 chip 展示） */
export function fmtVoiceSeconds(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
