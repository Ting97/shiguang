import { NextResponse } from "next/server";
import { withAuth } from "@/server/platform/http/route";
import { todoService, type TodoCreateInput } from "@/server/goal";

export const runtime = "nodejs";

/** GET /api/todos —— 智能列表视图（today/important/all/done/today-actions，见 todoService.list） */
export const GET = withAuth(async (req, { user }) => {
  const view = new URL(req.url).searchParams.get("view") ?? "all";
  return NextResponse.json(await todoService.list(user.id, view));
});

/** POST /api/todos —— 手动新增待办/行动（标题即可；标记/空间/插入定位见 todoService.create） */
export const POST = withAuth(async (req, { user }) => {
  const body = (await req.json().catch(() => ({}))) as TodoCreateInput;
  return NextResponse.json(await todoService.create(user.id, body));
});
