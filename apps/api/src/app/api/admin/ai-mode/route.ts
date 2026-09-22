import { NextResponse } from "next/server";
import { withAdmin } from "@/server/platform/http/route";
import { ApiError } from "@/server/platform/http/errors";
import { envJevMode, getJevMode, setJevMode, type JevModeValue } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: JevModeValue[] = ["off", "shadow", "on"];

/** GET /api/admin/ai-mode —— 当前生效的调用模式 + env 默认值（UI 标注用） */
export const GET = withAdmin(async () => {
  const mode = await getJevMode();
  return NextResponse.json({ mode, envDefault: envJevMode(), takeoverAvailable: true });
});

/** PUT /api/admin/ai-mode {mode} —— 切换调用模式，保存即生效（清缓存）。
 * off=全 GLM；shadow=GLM 行为不变 + Jev 影子对照（仅审计）；
 * on=实时接管（3-D：空间分类切 Jev + 五域混合引擎，Jev 失败自动回落全量 GLM）。 */
export const PUT = withAdmin(async (req, { user }) => {
  const { mode } = (await req.json().catch(() => ({}))) as { mode?: string };
  if (!VALID.includes(mode as JevModeValue)) {
    throw ApiError.badRequest("mode 需为 off/shadow/on");
  }
  await setJevMode(mode as JevModeValue, user.id);
  return NextResponse.json({ ok: true, mode });
});
