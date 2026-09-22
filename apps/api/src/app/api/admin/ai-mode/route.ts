import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { envJevMode, getJevMode, setJevMode, type JevModeValue } from "@/lib/ai-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID: JevModeValue[] = ["off", "shadow", "on"];

/** GET /api/admin/ai-mode —— 当前生效的调用模式 + env 默认值（UI 标注用） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });
  const mode = await getJevMode();
  return NextResponse.json({ mode, envDefault: envJevMode(), takeoverAvailable: true });
}

/** PUT /api/admin/ai-mode {mode} —— 切换调用模式，保存即生效（清缓存）。
 * off=全 GLM；shadow=GLM 行为不变 + Jev 影子对照（仅审计）；
 * on=实时接管（3-D：空间分类切 Jev + 五域混合引擎，Jev 失败自动回落全量 GLM）。 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "仅管理员" }, { status: 403 });
  const { mode } = (await req.json().catch(() => ({}))) as { mode?: string };
  if (!VALID.includes(mode as JevModeValue)) {
    return NextResponse.json({ error: "mode 需为 off/shadow/on" }, { status: 400 });
  }
  await setJevMode(mode as JevModeValue, user.id);
  return NextResponse.json({ ok: true, mode });
}
