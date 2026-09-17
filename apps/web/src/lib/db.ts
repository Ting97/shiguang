import { Pool } from "pg";

/** 开发期单用户（Phase 1 接入 Supabase Auth 后由会话取代） */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/shiguangri";

export const pool = new Pool({ connectionString, max: 5 });

/** 时间轴约束：一个时刻只能做一件事。返回与 [startAt, endAt) 重叠的已有时间块（无则 null） */
export async function findOverlap(
  userId: string,
  startAt: string,
  endAt: string,
  excludeId?: string,
): Promise<{ id: string; title: string; start_at: string; end_at: string } | null> {
  const { rows } = await pool.query(
    `select id, title, start_at, end_at
     from time_blocks
     where user_id = $1
       and ($4::uuid is null or id <> $4::uuid)
       and tstzrange(start_at, end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
     order by start_at
     limit 1`,
    [userId, startAt, endAt, excludeId ?? null],
  );
  return rows[0] ?? null;
}

/** 冲突的中文提示 */
export function overlapError(c: { title: string; start_at: string; end_at: string }): string {
  const f = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return `这段时间已有日程「${c.title}」（${f(c.start_at)}–${f(c.end_at)}），一个时刻只能做一件事，请调整时间或先处理原日程`;
}

/**
 * 为"完成待办"自动生成的时间块做避让：将 [plannedStart, now] 裁剪到空闲区间。
 * 返回 null 表示没有可用空间（跳过生成，待办照常完成）。
 */
export async function trimCompletionBlock(
  userId: string,
  plannedStart: Date,
  now: Date,
): Promise<{ start: Date; end: Date } | null> {
  const { rows } = await pool.query(
    `select start_at, end_at from time_blocks
     where user_id = $1
       and tstzrange(start_at, end_at, '[)') && tstzrange($2::timestamptz, $3::timestamptz, '[)')
     order by end_at desc`,
    [userId, plannedStart.toISOString(), now.toISOString()],
  );
  let newStart = plannedStart;
  for (const r of rows) {
    const end = new Date(r.end_at);
    if (end > newStart) newStart = end;
  }
  if (now.getTime() - newStart.getTime() < 60_000) return null; // 剩余不足 1 分钟
  return { start: newStart, end: now };
}
