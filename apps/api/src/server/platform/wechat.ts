/**
 * 微信小程序开放接口轻客户端（docs/15 第 1 批）：
 * - jscode2session：wx.login code → openid/unionid（登录识别；网络失败/微信错误码 → ApiError）
 * - msgSecCheck：UGC 文本安全检测（个人主体提审硬门槛）；87014=违规，其余错误降级放行
 * - enforceUgcText：发布口统一门禁——通道未配置/用户未绑微信/接口异常一律放行，不阻塞主流程
 * 未配置 WX_MINI_APPID/WX_MINI_SECRET 时 wechatConfigured()=false，登录侧 503。
 */
import { loadConfig } from "./config";
import { pool } from "./db";
import { ApiError } from "./http/errors";

const WA_BASE = "https://api.weixin.qq.com";
const HTTP_TIMEOUT_MS = 5000;

export function wechatConfigured(): boolean {
  return loadConfig().wechat !== null;
}

interface WxResp {
  errcode?: number;
  errmsg?: string;
  openid?: string;
  unionid?: string;
  access_token?: string;
  expires_in?: number;
}

/** wx.login code → openid/unionid。无效 code（40029/40163 等）转 401，网络失败转 503 */
export async function jscode2session(code: string): Promise<{ openid: string; unionid: string | null }> {
  const cfg = loadConfig().wechat;
  if (!cfg) throw new ApiError(503, "upstream", "微信登录通道未配置");
  const url =
    `${WA_BASE}/sns/jscode2session?appid=${encodeURIComponent(cfg.appid)}` +
    `&secret=${encodeURIComponent(cfg.secret)}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  let j: WxResp;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    j = (await res.json()) as WxResp;
  } catch {
    throw ApiError.upstream("微信服务不可达，请稍后再试");
  }
  if (!j.openid) {
    // code 已被使用/无效是客户端态（重试 wx.login 即可），按 401 语义下发而非 500
    throw new ApiError(401, "unauthorized", `微信登录失败（${j.errcode ?? "?"}）：${j.errmsg ?? "未知错误"}`);
  }
  return { openid: j.openid, unionid: j.unionid ?? null };
}

// ---- access_token（cgi 接口共用；模块级缓存，提前 5 分钟刷新） ----
let tokenCache: { token: string; expiresAt: number } | null = null;
// single-flight：并发首刷共享同一次远端请求——微信侧新取 token 可使旧 token 失效，
// 并发各自取会互相踩（后取的作废先取的，401 风暴）
let tokenInflight: Promise<string> | null = null;

async function fetchAccessToken(): Promise<string> {
  const cfg = loadConfig().wechat;
  if (!cfg) throw new ApiError(503, "upstream", "微信通道未配置");
  const url = `${WA_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(cfg.appid)}&secret=${encodeURIComponent(cfg.secret)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  const j = (await res.json()) as WxResp;
  if (!j.access_token) throw new Error(`获取 access_token 失败（${j.errcode ?? "?"}）：${j.errmsg ?? ""}`);
  tokenCache = { token: j.access_token, expiresAt: Date.now() + Math.max((j.expires_in ?? 7200) - 300, 60) * 1000 };
  return j.access_token;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  if (!tokenInflight) {
    tokenInflight = fetchAccessToken().finally(() => {
      tokenInflight = null;
    });
  }
  return tokenInflight;
}

export type UgcVerdict = { ok: true } | { ok: false; reason: string } | { ok: null };

/** 文本安全检测：0=通过、87014=违规、40001（token 失效，如微信侧被并发刷新作废）强制刷新重试一次、
 * 其余/异常=null（调用方降级放行） */
export async function msgSecCheck(openid: string, content: string): Promise<UgcVerdict> {
  try {
    let token = await getAccessToken();
    const call = (t: string) =>
      fetch(`${WA_BASE}/wxa/msg_sec_check?access_token=${encodeURIComponent(t)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 2, scene: 2, openid, content: content.slice(0, 2500) }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      }).then((r) => r.json() as Promise<WxResp>);
    let j = await call(token);
    if (j.errcode === 40001) {
      tokenCache = null; // 缓存的 token 已失效：清缓存强制刷新再试一次
      token = await getAccessToken(true);
      j = await call(token);
    }
    if (j.errcode === 0) return { ok: true };
    if (j.errcode === 87014) return { ok: false, reason: "内容包含违规信息，请修改后发布" };
    return { ok: null };
  } catch {
    return { ok: null };
  }
}

/**
 * 发布口 UGC 门禁（降级放行）：仅对「绑定了微信的用户」且通道可用时生效——
 * web/Expo 用户没有 openid，msgSecCheck v2 必传 openid，天然跳过。
 * 检测异常只告警不拦截（审核要求「有接入」，可用性由微信侧保障）。
 */
export async function enforceUgcText(userId: string, content: string): Promise<void> {
  const text = content.trim();
  if (!loadConfig().wechat || !text) return;
  try {
    const { rows } = await pool.query(`select wechat_openid from profiles where id = $1 and wechat_openid is not null`, [userId]);
    const openid = rows[0]?.wechat_openid as string | undefined;
    if (!openid) return;
    const verdict = await msgSecCheck(openid, text);
    if (verdict.ok === false) throw ApiError.badRequest(verdict.reason);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.warn("[wechat] UGC 内容检测异常（放行）:", String(e).slice(0, 120));
  }
}
