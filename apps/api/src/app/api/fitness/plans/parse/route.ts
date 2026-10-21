import { NextResponse } from "next/server";
import { withModule, readJsonCapped } from "@/server/platform/http/route";
import { fitnessService } from "@/server/fitness";

/** POST /api/fitness/plans/parse —— 粘贴课表文本或佳明训练截图 → AI 结构化草稿（不入库，返回给前端预览）。
 * image：{mimeType, base64（不含 data: 前缀）}；text 与 image 至少一项，text 在附图时可空（作补充说明）。
 * readJsonCapped 替代裸 req.json()：上限对齐 service 层截图守卫（6MB 解码 ≈ 8MB base64，REQ-020）
 * 而非默认 1MB——否则合规截图会被路由层先行 413 */
export const POST = withModule("fitness", async (req, { user }) => {
  const body = (await readJsonCapped(req, 9 * 1024 * 1024) as any) as {
    text?: string;
    image?: { mimeType?: string; base64?: string };
  };
  const image =
    body.image?.base64 && typeof body.image.base64 === "string"
      ? { mimeType: String(body.image.mimeType ?? "image/jpeg"), base64: String(body.image.base64) }
      : undefined;
  return NextResponse.json(await fitnessService.parsePlanDraft(user.id, String(body.text ?? ""), image));
});
