import { NextResponse } from "next/server";
import { withAuthParams } from "@/server/platform/http/route";
import { todoService, type TodoPatchInput } from "@/server/goal";

export const runtime = "nodejs";

/** PATCH /api/todos/:id —— { done: true } 勾选完成；{ undone: true } 恢复；或传字段修改待办 */
export const PATCH = withAuthParams(async (req, { user, params }) => {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as TodoPatchInput;
  return NextResponse.json(await todoService.update(user.id, id, body));
});

/** DELETE /api/todos/:id —— 删除待办（已完成的也可删） */
export const DELETE = withAuthParams(async (_req, { user, params }) => {
  const { id } = await params;
  return NextResponse.json(await todoService.remove(user.id, id));
});
