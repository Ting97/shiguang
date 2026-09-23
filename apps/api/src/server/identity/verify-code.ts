/**
 * 验证码一次性核销（sms_codes / email_codes 共享，4-F P2 抽取）：
 * 旧实现 select→比较→delete 三步分离，并发重放可双双通过，「一次性」失效；
 * 现改为单条带守卫的 DELETE 原子判定——命中即删（returning id），并发下仅一端成功。
 * 错码/过期不误删；错 5 次作废（attempts < 5 守卫）语义保留。
 * SQL 全字面量（表名/列名写死，无拼接），值一律 $n 参数化。
 */
import { pool } from "@/server/platform/db";
import { hashToken } from "@/server/identity/auth-crypto";

export type VerifyChannel = "sms_codes" | "email_codes";

/** 命中核销：键 + 用途 + 哈希全对、未锁、未过期 → 删除该行并返回 id */
const HIT_SQL: Record<VerifyChannel, string> = {
  sms_codes: `delete from sms_codes
   where phone = $1 and purpose = $2 and code_hash = $3 and attempts < 5 and expires_at > now()
   returning id`,
  email_codes: `delete from email_codes
   where email = $1 and purpose = $2 and code_hash = $3 and attempts < 5 and expires_at > now()
   returning id`,
};

/** 未命中时对最新一条未过期记录累计失败次数（尽力而为，非原子也不影响一次性语义） */
const BUMP_SQL: Record<VerifyChannel, string> = {
  sms_codes: `update sms_codes set attempts = attempts + 1
   where id = (select id from sms_codes
               where phone = $1 and purpose = $2 and expires_at > now()
               order by created_at desc limit 1)`,
  email_codes: `update email_codes set attempts = attempts + 1
   where id = (select id from email_codes
               where email = $1 and purpose = $2 and expires_at > now()
               order by created_at desc limit 1)`,
};

/** 校验并一次性核销验证码：正确且未过期 → true（该行已删）；否则 false */
export async function verifyCode(table: VerifyChannel, key: string, purpose: string, code: string): Promise<boolean> {
  const hit = await pool.query(HIT_SQL[table], [key, purpose, hashToken(code)]);
  if (hit.rows.length > 0) return true;
  await pool.query(BUMP_SQL[table], [key, purpose]);
  return false;
}
