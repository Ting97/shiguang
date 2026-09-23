import { NextRequest, NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { assertUuidParam } from "@/server/platform/http/validate";
import { addEntryImages } from "@/server/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/entries/:id/images —— 发布文字动态后并行上传图片（formData 字段 files，多文件）
 * 校验：登录 → entry 属主 → 单条 ≤9 张（含已有）→ 单张 ≤5MB → 魔数白名单；写盘 + 落库（事务）
 */
export const POST = withAuthParams(async (req: NextRequest, { user, params }) => {
  const { id } = await params;
  assertUuidParam(id, "id"); // 非法 uuid 落 SQL 会 22P02 → 500，先拦成 400
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw ApiError.badRequest("需要 multipart/form-data");
  }
  return NextResponse.json(await addEntryImages(user.id, id, form));
});
