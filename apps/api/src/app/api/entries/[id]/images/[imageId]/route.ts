import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { deleteImageFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/entries/:id/images/:imageId —— 删除单张图片（删行 + 异步删盘上文件） */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id, imageId } = await params;

  const { rows } = await pool.query(
    `delete from entry_images where id = $1 and entry_id = $2 and user_id = $3 returning storage_key`,
    [imageId, id, user.id],
  );
  if (!rows[0]) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  void deleteImageFile(rows[0].storage_key);
  return NextResponse.json({ ok: true });
}
