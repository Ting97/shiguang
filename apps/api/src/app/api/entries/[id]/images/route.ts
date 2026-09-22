import { NextResponse } from "next/server";
import { pool } from "@/server/platform/db";
import { getCurrentUser } from "@/server/identity/auth";
import { IMAGE_MIME_EXT, newStorageKey, saveImageFile, sniffImageMime } from "@/server/timeline/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PER_ENTRY = 9;
const MAX_BYTES = 5 * 1024 * 1024; // 压缩后兜底上限

/**
 * POST /api/entries/:id/images —— 发布文字动态后并行上传图片（formData 字段 files，多文件）
 * 校验：登录 → entry 属主 → 单条 ≤9 张（含已有）→ 单张 ≤5MB → 魔数白名单；写盘 + 落库（事务）
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;

  const entry = (
    await pool.query(`select id from entries where id = $1 and user_id = $2`, [id, user.id])
  ).rows[0];
  if (!entry) return NextResponse.json({ error: "动态不存在" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "需要 multipart/form-data" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "没有文件" }, { status: 400 });

  const { rows: existing } = await pool.query(
    `select count(*)::int as n from entry_images where entry_id = $1 and user_id = $2`,
    [id, user.id],
  );
  const have = existing[0].n;
  if (have + files.length > MAX_PER_ENTRY) {
    return NextResponse.json({ error: `单条动态最多 ${MAX_PER_ENTRY} 张（已有 ${have} 张）` }, { status: 400 });
  }

  // 逐一校验（大小 + 魔数），全部通过才落库
  const prepared: { mime: string; bytes: number; data: Buffer; key: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      return NextResponse.json({ error: `单张图片不能超过 5MB` }, { status: 400 });
    }
    const data = Buffer.from(await f.arrayBuffer());
    const sniffed = sniffImageMime(data);
    if (!sniffed || !(sniffed in IMAGE_MIME_EXT)) {
      return NextResponse.json({ error: "仅支持 jpg/png/webp/gif 图片" }, { status: 400 });
    }
    prepared.push({ mime: sniffed, bytes: data.length, data, key: newStorageKey(sniffed) });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted: { id: string; storageKey: string; mime: string; width: number | null; height: number | null; sort: number }[] = [];
    let sort = have; // 追加到已有图片之后
    for (const p of prepared) {
      const { rows } = await client.query(
        `insert into entry_images (user_id, entry_id, storage_key, mime, bytes, width, height, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, storage_key, mime, width, height, sort`,
        [user.id, id, p.key, p.mime, p.bytes, null, null, sort++],
      );
      const r = rows[0];
      inserted.push({ id: r.id, storageKey: r.storage_key, mime: r.mime, width: r.width, height: r.height, sort: r.sort });
    }
    await client.query("commit");
    // 落库成功后写盘；失败则回删行（个人系统：极小概率，保证不留死链）
    try {
      for (const p of prepared) await saveImageFile(p.key, p.data);
    } catch (e) {
      await pool.query(`delete from entry_images where entry_id = $1 and storage_key = any($2)`, [
        id,
        prepared.map((p) => p.key),
      ]).catch(() => {});
      throw e;
    }
    return NextResponse.json({ ok: true, images: inserted });
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.error("[images] 上传失败:", e);
    return NextResponse.json({ error: "上传失败，请重试" }, { status: 500 });
  } finally {
    client.release();
  }
}
