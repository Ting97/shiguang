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
  const p = (n: number) => String(n).padStart(2, "0");
  const zh = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  const hm = (d: Date) => `${p(d.getHours())}:${p(d.getMinutes())}`;
  const s = new Date(c.start_at);
  const e = new Date(c.end_at);
  // 跨天/不同日的冲突必须带日期，否则「23:00–07:00」看不出占用的是哪天
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate();
  const range = sameDay ? `${hm(s)}–${hm(e)}` : `${zh(s)} ${hm(s)} – ${zh(e)} ${hm(e)}`;
  return `这段时间已有日程「${c.title}」（${range}），一个时刻只能做一件事，请调整时间或先处理原日程`;
}
