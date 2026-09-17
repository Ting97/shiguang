import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { dedupeKey, parseBill, type ImportRow } from "@/lib/csv-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/transactions/import —— 支付宝/微信 CSV 账单导入
 * body: { text, platform?, accountId?, dryRun? }
 * dryRun=true 只解析与去重做预览，不落库；false 时直接入账（is_draft=false, source=csv_import）
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    platform?: "alipay" | "wechat";
    accountId?: string | null;
    dryRun?: boolean;
  };
  const text = body.text ?? "";
  if (text.trim().length < 10) {
    return NextResponse.json({ error: "账单内容为空 —— 请上传 CSV 文件或粘贴账单文本" }, { status: 400 });
  }
  if (text.length > 5_000_000) {
    return NextResponse.json({ error: "账单文件过大（>5MB），请分段导出后导入" }, { status: 400 });
  }

  // 解析（平台自动识别；解析失败抛中文错误）
  let parsed;
  try {
    parsed = parseBill(text, body.platform);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const { platform, rows, skips } = parsed;

  // 账户归属校验
  let accountId: string | null = null;
  if (body.accountId) {
    const owned = await pool.query(
      `select id, name from accounts where id = $1 and user_id = $2 and archived = false`,
      [body.accountId, user.id],
    );
    if (owned.rows.length === 0) {
      return NextResponse.json({ error: "账户不存在" }, { status: 400 });
    }
    accountId = owned.rows[0].id;
  }

  // ---- 去重 ----
  // 1) 批内去重（同一次导入里的重复行，保留首条）
  const seen = new Set<string>();
  const uniqueRows: ImportRow[] = [];
  let batchDup = 0;
  for (const row of rows) {
    const key = dedupeKey(row);
    if (seen.has(key)) { batchDup++; continue; }
    seen.add(key);
    uniqueRows.push(row);
  }

  // 2) 与库中已有流水比对：有单号查单号；无单号查 时间+金额+方向+对方 指纹（限定已导入流水的时间窗）
  let dbDup = 0;
  const externalNos = uniqueRows.map((r) => r.externalNo).filter((n): n is string => !!n);
  const existNos = new Set<string>();
  if (externalNos.length > 0) {
    const { rows: exist } = await pool.query(
      `select external_no from transactions where user_id = $1 and external_no = any($2)`,
      [user.id, externalNos],
    );
    for (const r of exist) existNos.add(r.external_no);
  }
  const noNoRows = uniqueRows.filter((r) => !r.externalNo);
  const existFps = new Set<string>();
  if (noNoRows.length > 0) {
    const times = noNoRows.map((r) => r.occurredAt).sort();
    const { rows: exist } = await pool.query(
      `select (occurred_at at time zone 'Asia/Shanghai')::text as t, amount_cents, counterparty, direction, source
       from transactions
       where user_id = $1 and source in ('csv_import','manual')
         and occurred_at between $2::timestamptz and $3::timestamptz`,
      [user.id, times[0], times[times.length - 1]],
    );
    for (const r of exist) {
      existFps.add(`fp:${r.t}|${r.amount_cents}|${r.counterparty ?? ""}|${r.direction}`);
    }
  }

  const toImport: ImportRow[] = [];
  for (const row of uniqueRows) {
    if (row.externalNo) {
      if (existNos.has(row.externalNo)) { dbDup++; continue; }
    } else {
      // 库中指纹用北京时间文本（at time zone 'Asia/Shanghai'），本地同样换算后比对
      const bj = new Date(new Date(row.occurredAt).getTime() + 8 * 3600_000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      if (existFps.has(`fp:${bj}|${row.amountCents}|${row.counterparty ?? ""}|${row.direction}`)) {
        dbDup++;
        continue;
      }
    }
    toImport.push(row);
  }

  // 分类统计（预览展示）
  const categories: Record<string, number> = {};
  for (const r of toImport) categories[r.category] = (categories[r.category] ?? 0) + 1;
  const skipSummary: Record<string, number> = {};
  for (const s of skips) skipSummary[s.reason] = (skipSummary[s.reason] ?? 0) + 1;

  if (body.dryRun) {
    return NextResponse.json({
      platform,
      total: rows.length + skips.length,
      importable: toImport.length,
      batchDup,
      dbDup,
      skipped: skips.length,
      skipSummary,
      categories,
      outCents: toImport.filter((r) => r.direction === "out").reduce((s, r) => s + r.amountCents, 0),
      inCents: toImport.filter((r) => r.direction === "in").reduce((s, r) => s + r.amountCents, 0),
      sample: toImport.slice(0, 8),
    });
  }

  if (toImport.length === 0) {
    return NextResponse.json({
      platform,
      imported: 0,
      dbDup,
      batchDup,
      skipped: skips.length,
      skipSummary,
      message: "没有新流水 —— 全部为重复或不可导入行",
    });
  }

  // ---- 批量插入（分块；外部单号唯一索引兜底并发重复）----
  let imported = 0;
  const CHUNK = 100;
  for (let i = 0; i < toImport.length; i += CHUNK) {
    const chunk = toImport.slice(i, i + CHUNK);
    const values: unknown[] = [user.id, accountId];
    const tuples = chunk.map((r, j) => {
      const b = j * 7;
      values.push(r.direction, r.amountCents, r.category, r.counterparty, r.note, r.occurredAt, r.externalNo);
      return `($1, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, 'csv_import', false, $2)`;
    });
    const { rowCount } = await pool.query(
      `insert into transactions
         (user_id, direction, amount_cents, category, counterparty, note, occurred_at, external_no, source, is_draft, account_id)
       values ${tuples.join(",")}
       on conflict (user_id, external_no) where external_no is not null do nothing`,
      values,
    );
    imported += rowCount ?? 0;
  }

  return NextResponse.json({
    platform,
    imported,
    dbDup,
    batchDup,
    skipped: skips.length,
    skipSummary,
    categories,
  });
}
