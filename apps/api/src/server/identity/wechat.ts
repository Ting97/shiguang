/**
 * 微信小程序登录/绑定：
 * - loginByWechat：jscode2session → openid 命中 wechat_openid 即建会话；未命中自动建号
 *   （免绑手机号，昵称取用户授权资料；REQ-游客/微信直登）
 * - bindSessionByWechat：已登录账号凭 code 绑定当前微信（REQ-绑定已有账户）；openid
 *   占用方为自动建号空壳时回收迁移；占用方有数据时返回 409 + 双方数据概览，
 *   前端弹「保留哪份数据」选择 → resolve=current（改绑）/ resolve=wechat（改登对方）
 * 历史：票据绑定流程（wechat_bind_tickets + 短信验证码）已随 code 直绑（bind-session）下线，
 * 全仓无票据签发方，bindWechat 端点于十一轮检视删除；wechat_bind_tickets 表按「迁移只增不改」
 * 留库（patrol 仍清理过期行做卫生）。
 */
import { pool } from "@/server/platform/db";
import { jscode2session, enforceUgcText } from "@/server/platform/wechat";
import { ApiError } from "@/server/platform/http/errors";
import { createSession } from "@/server/identity/auth";
import { PRESET_ACTIVITIES } from "@/server/time/seed";

export interface WechatLoginInput {
  code: string;
  /** 用户授权弹窗里同意的资料（可选）：昵称用于自动建号 */
  profile?: { nickname?: string };
  userAgent?: string | null;
}

/** 默认昵称：微信用户 + 4 位随机（unique 兜底场景极小，见 23505 分支） */
function fallbackNickname(): string {
  return `微信用户${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * 自动建号空壳判定：绑定迁移前检查既有绑定方是否「无任何业务数据」。
 * 任一主业务表有数据即非空壳（保守：查询异常按非空壳处理，宁可拒绝迁移不可丢数据）。
 */
async function isBusinessEmpty(
  userId: string,
  client: import("pg").PoolClient | typeof pool = pool,
): Promise<boolean> {
  try {
    // 新增用户业务表必须同步本清单，否则微信空壳回收会丢数据
    const { rows } = await client.query(
      `select (
        (select count(*) from public.entries where user_id = $1)
      + (select count(*) from public.transactions where user_id = $1)
      + (select count(*) from public.todos where user_id = $1)
      + (select count(*) from public.time_blocks where user_id = $1)
      + (select count(*) from public.contacts where user_id = $1)
      + (select count(*) from public.goal_spaces where user_id = $1)
      + (select count(*) from public.space_reflections where user_id = $1)
      + (select count(*) from public.liabilities where user_id = $1)
      + (select count(*) from public.liability_payments where user_id = $1)
      + (select count(*) from public.accounts where user_id = $1)
      + (select count(*) from public.trades where user_id = $1)
      + (select count(*) from public.trade_accounts where user_id = $1)
      + (select count(*) from public.budgets where user_id = $1)
      + (select count(*) from public.interactions where user_id = $1)
      + (select count(*) from public.fitness_profiles where user_id = $1)
      + (select count(*) from public.fitness_goals where user_id = $1)
      + (select count(*) from public.fitness_daily_plans where user_id = $1)
      + (select count(*) from public.fitness_session_logs where user_id = $1)
      + (select count(*) from public.fitness_body_metrics where user_id = $1)
      + (select count(*) from public.fitness_sleep_logs where user_id = $1)
      + (select count(*) from public.fitness_xunji_aliases where user_id = $1)
      + (select count(*) from public.chat_conversations where user_id = $1)
      + (select count(*) from public.chat_messages where user_id = $1)
      )::int as n`,
      [userId],
    );
    return rows[0].n === 0;
  } catch {
    return false;
  }
}

/** 账号数据概览（绑定冲突时给前端渲染「保留哪份数据」用） */
export interface AccountSummary {
  nickname: string;
  createdAt: string | null;
  counts: {
    entries: number;
    transactions: number;
    todos: number;
    blocks: number;
    contacts: number;
    goalSpaces: number;
    spaceReflections: number;
  };
}

async function accountSummary(userId: string): Promise<AccountSummary> {
  const { rows } = await pool.query<{
    nickname: string;
    created_at: string | null;
    entries: string;
    transactions: string;
    todos: string;
    blocks: string;
    contacts: string;
    goal_spaces: string;
    space_reflections: string;
  }>(
    `select p.nickname,
            p.created_at,
            (select count(*) from public.entries where user_id = p.id) as entries,
            (select count(*) from public.transactions where user_id = p.id) as transactions,
            (select count(*) from public.todos where user_id = p.id) as todos,
            (select count(*) from public.time_blocks where user_id = p.id) as blocks,
            (select count(*) from public.contacts where user_id = p.id) as contacts,
            (select count(*) from public.goal_spaces where user_id = p.id) as goal_spaces,
            (select count(*) from public.space_reflections where user_id = p.id) as space_reflections
     from public.profiles p where p.id = $1`,
    [userId],
  );
  const r = rows[0];
  return {
    nickname: r?.nickname ?? "",
    createdAt: r?.created_at ? new Date(r.created_at).toISOString() : null,
    counts: {
      entries: Number(r?.entries ?? 0),
      transactions: Number(r?.transactions ?? 0),
      todos: Number(r?.todos ?? 0),
      blocks: Number(r?.blocks ?? 0),
      contacts: Number(r?.contacts ?? 0),
      goalSpaces: Number(r?.goal_spaces ?? 0),
      spaceReflections: Number(r?.space_reflections ?? 0),
    },
  };
}

/**
 * 已登录账号绑定当前微信（REQ-绑定已有账户）：密码登录后凭 code 把 openid 迁移到本账号，
 * 之后微信一键登录即进入本账号。openid 已被占用时：占用方为「无业务数据的自动建号空壳」
 * 直接回收迁移；占用方有数据则返回 conflict + 双方概览（不自动动数据，由用户选择保留哪份）。
 */
export async function bindSessionByWechat(input: {
  code: string;
  userId: string;
  userAgent?: string | null;
}): Promise<
  | { status: "ok"; already?: boolean }
  | { status: "conflict"; owner: AccountSummary; current: AccountSummary }
> {
  const { openid, unionid } = await jscode2session(input.code);
  const { rows } = await pool.query(
    `select id, nickname from profiles where wechat_openid = $1`,
    [openid],
  );
  const owner = rows[0];
  if (owner) {
    if (owner.id === input.userId) return { status: "ok", already: true };
    if (!(await isBusinessEmpty(owner.id))) {
      // 有数据的占用方：不自动动数据，交出双方概览由用户选（口子在 bind-session 路由）
      const [ownerSummary, currentSummary] = await Promise.all([
        accountSummary(owner.id),
        accountSummary(input.userId),
      ]);
      return { status: "conflict", owner: ownerSummary, current: currentSummary };
    }
  }
  // 回收空壳与改绑同一事务：两条独立语句的窗口期内并发 loginByWechat 会以同 openid
  // 重建空壳号 → 改绑撞 unique 报「已绑定其他账号」并留下孤儿行
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (owner) {
      // 空壳判定在事务内复核：事务外的预检到解绑之间，空壳若并发产生业务数据会被无条件解绑，
      // 数据挂在无法登录的账号上（违背文件头「宁可拒绝迁移不可丢数据」口径）——非空即回滚走冲突口子
      if (!(await isBusinessEmpty(owner.id, client))) {
        await client.query("rollback");
        const [ownerSummary, currentSummary] = await Promise.all([
          accountSummary(owner.id),
          accountSummary(input.userId),
        ]);
        return { status: "conflict", owner: ownerSummary, current: currentSummary };
      }
      // 回收空壳：解绑后把 openid 迁到当前账号（空壳无数据可丢）
      await client.query(`update profiles set wechat_openid = null, wechat_unionid = null where id = $1`, [owner.id]);
    }
    // 守卫：本账号已绑定其他微信时拒绝静默改绑（原 openid 被孤儿化，下次原微信登录自动建新空壳号）
    const bound = await client.query(
      `update profiles set wechat_openid = $1, wechat_unionid = coalesce($2, wechat_unionid), last_login_at = now()
       where id = $3 and (wechat_openid is null or wechat_openid = $1) returning id, nickname`,
      [openid, unionid, input.userId],
    );
    if (!bound.rows[0]) {
      await client.query("rollback");
      throw ApiError.conflict("当前账号已绑定其他微信，请先解绑后再绑定");
    }
    await client.query("commit");
    return { status: "ok" };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    // wechat_openid unique：并发绑定同 openid 到另一账号
    if ((e as { code?: string }).code === "23505") {
      throw ApiError.conflict("该微信已绑定其他账号");
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 冲突口子一（resolve=current）：用户选择「保留当前账号的数据」——把微信从占用方解绑并
 * 绑到当前账号。占用方数据原地保留（只是失去微信登录入口），不做任何删除/迁移。
 */
export async function bindSessionForceCurrent(input: { code: string; userId: string }) {
  const { openid, unionid } = await jscode2session(input.code);
  const owner = await pool.query(`select id from profiles where wechat_openid = $1 and id <> $2`, [
    openid,
    input.userId,
  ]);
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (owner.rows[0]) {
      await client.query(
        `update profiles set wechat_openid = null, wechat_unionid = null where id = $1`,
        [owner.rows[0].id],
      );
    }
    // 守卫：与 bindSessionByWechat 同款——本账号已绑定其他微信时拒绝静默改绑
    //（冲突对话框打开到确认之间，本账号可能又绑上了别的微信）
    const bound = await client.query(
      `update profiles set wechat_openid = $1, wechat_unionid = coalesce($2, wechat_unionid), last_login_at = now()
       where id = $3 and (wechat_openid is null or wechat_openid = $1) returning id`,
      [openid, unionid, input.userId],
    );
    if (!bound.rows[0]) {
      await client.query("rollback");
      throw ApiError.conflict("当前账号已绑定其他微信，请先解绑后再绑定");
    }
    await client.query("commit");
    return { ok: true as const };
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // 连接已不可用
    }
    if ((e as { code?: string }).code === "23505") {
      throw ApiError.conflict("该微信已绑定其他账号");
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 冲突口子二（resolve=wechat）：用户选择「保留微信账号的数据」——本次会话切换为微信绑定的
 * 账号（凭「已登录会话 + 该微信有效 code」：code 只能来自主张者本人微信的 wx.login；
 * 十一轮修正注释——旧文案「A 号密码 + code 双重凭证」与实现不符，实现无密码校验）。
 * 两个账号的数据都原样保留，用户此后以对方账号为准继续使用；当前账号仍可密码登录（网页版不受影响）。
 */
export async function bindSessionSwitchToOwner(input: { code: string; userAgent?: string | null }) {
  const { openid, unionid } = await jscode2session(input.code);
  const { rows } = await pool.query(
    `select id, nickname, status from profiles where wechat_openid = $1`,
    [openid],
  );
  const owner = rows[0];
  if (!owner) throw ApiError.badRequest("该微信尚未绑定任何账号，无需切换");
  // 与 issueSessionFor 同口径：被禁用账号不得经换登路径重新拿到会话
  if (owner.status !== "active") throw ApiError.forbidden("账号已被禁用");
  const token = await createSession(owner.id, input.userAgent ?? "miniapp");
  await pool.query(`update profiles set last_login_at = now() where id = $1`, [owner.id]);
  void unionid;
  return {
    ok: true as const,
    switched: true as const,
    token,
    user: { id: owner.id, nickname: owner.nickname },
  };
}

/** 授权昵称净化：去尖括号/压空白/限长——入库前最小防御 */
function sanitizeNickname(raw: string | undefined): string {
  const cleaned = (raw ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return cleaned || fallbackNickname();
}

/** 登录路径共用：最后登录时间 + 发会话（老用户与并发首登兜底共用） */
async function issueSessionFor(
  user: { id: string; nickname: string; status: string },
  unionid: string | null,
  userAgent?: string | null,
) {
  if (user.status !== "active") throw new ApiError(403, "forbidden", "账号已被禁用");
  await pool.query(
    `update profiles set last_login_at = now()${unionid ? ", wechat_unionid = coalesce(wechat_unionid, $2)" : ""} where id = $1`,
    unionid ? [user.id, unionid] : [user.id],
  );
  const token = await createSession(user.id, userAgent ?? "miniapp");
  return { ok: true as const, bound: true as const, token, user: { id: user.id, nickname: user.nickname } };
}

/** 一键登录：命中 wechat_openid 直接发会话；未命中自动建号（免绑手机号，直登体验） */
export async function loginByWechat(input: WechatLoginInput) {
  const { openid, unionid } = await jscode2session(input.code);
  const { rows } = await pool.query(
    `select id, nickname, status from profiles where wechat_openid = $1`,
    [openid],
  );
  const user = rows[0];
  if (user) return issueSessionFor(user, unionid, input.userAgent);

  // 未命中 → 自动建号：昵称取用户授权资料（拒绝授权用默认昵称，可后改）；
  // 播种九大预设分类与 web 注册同口径，保证开箱即用。事务保证「建号+播种」原子（4-F P1 同范式）。
  const nickname = sanitizeNickname(input.profile?.nickname);
  const client = await pool.connect();
  let created: { id: string; nickname: string };
  try {
    await client.query("begin");
    const inserted = await client.query(
      `insert into profiles (nickname, wechat_openid, wechat_unionid, phone_verified, last_login_at)
       values ($1, $2, $3, false, now()) returning id, nickname`,
      [nickname, openid, unionid],
    );
    created = inserted.rows[0];
    for (const a of PRESET_ACTIVITIES) {
      await client.query(
        `insert into activities (id, user_id, name, icon, color, default_min, sort_order, is_preset)
         values ($1, $2, $3, $4, $5, $6, $7, true)
         on conflict (id, user_id) do nothing`,
        [a.id, created.id, a.name, a.icon, a.color, a.defaultMin, a.sortOrder],
      );
    }
    await client.query("commit");
  } catch (e) {
    try {
      await client.query("rollback");
    } catch {
      // 连接已不可用：释放即可
    }
    // wechat_openid unique：并发首登另一请求已建号 → 按 openid 重查走登录路径
    if ((e as { code?: string }).code === "23505") {
      const again = await pool.query(`select id, nickname, status from profiles where wechat_openid = $1`, [openid]);
      if (again.rows[0]) return issueSessionFor(again.rows[0], unionid, input.userAgent);
    }
    throw e;
  } finally {
    client.release();
  }

  // 昵称过一道内容安全（msgSecCheck 降级放行的同口径不适用——这里必须放行登录，
  // 被拒则换默认昵称，不因昵称卡住进入）
  try {
    await enforceUgcText(created.id, created.nickname);
  } catch (e) {
    if (e instanceof ApiError) {
      const fixed = await pool.query(`update profiles set nickname = $2 where id = $1 returning nickname`, [
        created.id,
        fallbackNickname(),
      ]);
      created = { id: created.id, nickname: fixed.rows[0].nickname };
    } else {
      throw e;
    }
  }

  const token = await createSession(created.id, input.userAgent ?? "miniapp");
  return {
    ok: true as const,
    bound: true as const,
    created: true as const,
    token,
    user: { id: created.id, nickname: created.nickname },
  };
}
