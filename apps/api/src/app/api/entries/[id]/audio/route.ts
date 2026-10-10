import { NextRequest, NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";
import { setEntryAudio } from "@/server/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/entries/:id/audio —— 语音动态音频上传（multipart 字段 file，16k 单声道 wav）
 * 校验：登录 → entry 属主 → 魔数嗅探 wav → ≤5MB（30s/16k/16bit 约 960KB，余量充足）；
 * body 上限前置预检同 images 路由（formData 会整体缓存进内存）
 */
export const POST = withAuthParams(async (req: NextRequest, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id");
  const declared = req.headers.get("content-length");
  if (declared === null || !Number.isFinite(Number(declared)) || Number(declared) > 20 * 1024 * 1024) {
    throw ApiError.badRequest("上传内容过大或缺少长度声明（上限约 20MB）");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw ApiError.badRequest("需要 multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw ApiError.badRequest("需要 file 字段");
  const buf = Buffer.from(await file.arrayBuffer());
  return NextResponse.json(await setEntryAudio(user.id, id, buf));
});
