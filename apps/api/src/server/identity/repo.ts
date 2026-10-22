/** identity 域 repo：SQL 唯一发生地（REQ-004 FR-B1.2） */
import { pool } from "@/server/platform/db";

export const profilesRepo = {
  byIdentity(identity: string, byEmail: boolean) {
    return byEmail
      ? pool.query(
          `select id, nickname, phone, email, email_verified, password_hash, status from profiles where email = $1`,
          [identity],
        )
      : pool.query(
          `select id, nickname, phone, email, email_verified, password_hash, status from profiles where phone = $1`,
          [identity],
        );
  },
  async passwordHashOf(userId: string): Promise<string | null> {
    const { rows } = await pool.query(`select password_hash from profiles where id = $1`, [userId]);
    return rows[0]?.password_hash ?? null;
  },
  setNickname(userId: string, nickname: string) {
    return pool.query(`update profiles set nickname = $1 where id = $2`, [nickname, userId]);
  },
  setPasswordHash(userId: string, hash: string) {
    return pool.query(`update profiles set password_hash = $1 where id = $2`, [hash, userId]);
  },
  touchLastLogin(userId: string) {
    return pool.query(`update profiles set last_login_at = now() where id = $1`, [userId]);
  },
  info(userId: string) {
    return pool.query(`select created_at, phone_verified, wechat_openid is not null as wechat_bound from profiles where id = $1`, [userId]);
  },
  hasPhoneAccount() {
    return pool.query(`select 1 from profiles where phone is not null limit 1`);
  },
  /** 已存在带密码的管理员账号（setup 硬守卫）：旧守卫只看「任一账号有手机号」，
   * 全邮箱注册且种子行未认领的库会放行 setup——未认证的管理员创建入口 */
  hasAdminAccount(exec: Pick<typeof pool, "query"> = pool) {
    return exec.query(`select 1 from profiles where role = 'admin' and password_hash is not null limit 1`);
  },
  claimDevAdmin(nickname: string, phone: string, hash: string) {
    return pool.query(
      `update profiles set nickname = $1, phone = $2, phone_verified = true,
         password_hash = $3, last_login_at = now()
       where id = $4 and phone is null returning id, nickname, phone`,
      [nickname, phone, hash, "00000000-0000-0000-0000-000000000000"],
    );
  },
};
