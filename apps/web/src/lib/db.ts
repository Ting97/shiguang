import { Pool } from "pg";

/** 开发期单用户（Phase 1 接入 Supabase Auth 后由会话取代） */
export const DEV_USER_ID = "00000000-0000-0000-0000-000000000000";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/shiguangri";

export const pool = new Pool({ connectionString, max: 5 });
