/**
 * Bitget UTA v3 REST 客户端（docs/16 调研：仅只读接口，复盘同步用）。
 * 签名（与 v2 一致）：prehash = timestamp + method + requestPath + "?" + queryString + body，
 * HMAC-SHA256(secret) → Base64；headers ACCESS-KEY/ACCESS-SIGN/ACCESS-TIMESTAMP/ACCESS-PASSPHRASE。
 * 响应壳 {code:"00000", msg, data}；非 00000 → ApiError.upstream。
 * fetcher 可注入（测试 stub 上游，不真连）。
 */
import { createHmac } from "node:crypto";
import { ProxyAgent } from "undici";
import { ApiError } from "@/server/platform/http/errors";
import { loadConfig } from "@/server/platform/config";

export const BITGET_BASE = "https://api.bitget.com";

/** 出站代理（国内服务器直连 Bitget 被墙）：BITGET_PROXY 配置后所有 Bitget 请求走该代理。
 * agent 按配置缓存（ProxyAgent 自带连接池）；未配置 = 直连（海外服务器/本地可直连场景） */
let proxyAgent: ProxyAgent | undefined;
function dispatcher(): ProxyAgent | undefined {
  const proxy = loadConfig().bitgetProxy;
  if (!proxy) return undefined;
  if (!proxyAgent) proxyAgent = new ProxyAgent(proxy);
  return proxyAgent;
}

export interface BitgetCred {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

export type FetchLike = (url: string, init?: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** 纯函数：给定参数产出签名与请求头（单测固定向量比对） */
export function signRequest(
  cred: BitgetCred,
  method: "GET" | "POST",
  requestPath: string,
  queryString: string,
  body: string,
  timestampMs: string,
): Record<string, string> {
  const prehash = `${timestampMs}${method}${requestPath}${queryString ? `?${queryString}` : ""}${body}`;
  const sign = createHmac("sha256", cred.apiSecret).update(prehash).digest("base64");
  return {
    "ACCESS-KEY": cred.apiKey,
    "ACCESS-SIGN": sign,
    "ACCESS-TIMESTAMP": timestampMs,
    "ACCESS-PASSPHRASE": cred.passphrase,
    "Content-Type": "application/json",
    locale: "zh-CN",
  };
}

interface WxShell {
  code?: string;
  msg?: string;
  data?: unknown;
}

/** Bitget 常见错误码 → 用户可自查提示（拼在原文后；只收录已确证语义的码） */
const BITGET_HINTS: Record<string, string> = {
  "40037": "提示：该接口不认识这把 key——常见于账户为经典模式（未升级统一账户），或误填了 UID/模拟盘 key",
  "40013": "提示：签名校验失败——Secret Key 或 Passphrase 可能复制不完整",
  "40012": "提示：key 或口令不正确——UTA 升级会失效旧 API key，请在 Bitget 重建一把只读 key 再绑定",
  "40084": "提示：账户是经典模式（Classic）——CFD 与 v3 接口仅对统一交易账户(UTA)开放，请先在 Bitget App「我的 → 统一交易账户」升级",
};

/** 单次 GET；查询串按字典序拼（与签名一致由调用方保证——本函数统一 qs() 生成） */
export async function bitgetGet<T>(cred: BitgetCred, path: string, query: Record<string, string | number | undefined>, fetcher: FetchLike = defaultFetch): Promise<T> {
  const qs = qsOf(query);
  const ts = String(Date.now());
  const headers = signRequest(cred, "GET", path, qs, "", ts);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetcher(`${BITGET_BASE}${path}${qs ? `?${qs}` : ""}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
      dispatcher: dispatcher(),
    } as never);
  } catch {
    throw ApiError.upstream("Bitget 服务不可达，请稍后再试");
  }
  const shell = parseShell(await res.text());
  if (shell.code !== "00000") {
    const raw = `Bitget 接口错误（${shell.code ?? res.status}）：${shell.msg ?? "未知错误"}`;
    const hint = shell.code ? BITGET_HINTS[String(shell.code)] : undefined;
    throw ApiError.upstream(hint ? `${raw}。${hint}` : raw);
  }
  return shell.data as T;
}

/** 分页拉全：idLessThan 游标 + limit，按返回列表最后一条 id 前翻，直到取空/越过 fromTime/页数上限。
 * T 不约束 id/ts 形状（流水与订单字段不同），游标取值处按位取。 */
export async function pagedGetAll<T>(
  cred: BitgetCred,
  path: string,
  base: Record<string, string | number | undefined>,
  opts: { fromTimeMs: number; maxPages?: number; fetcher?: FetchLike },
): Promise<T[]> {
  const limit = 50; // 实测这些接口 limit 上限 50，>50 报 40020（文档写的 500 与实际不符）
  const out: T[] = [];
  let cursor: string | undefined;
  const maxPages = opts.maxPages ?? 200; // 50/页 × 200 = 1 万条封顶，防死循环
  for (let i = 0; i < maxPages; i++) {
    const page = await bitgetGet<T[]>(cred, path, { ...base, idLessThan: cursor, limit }, opts.fetcher);
    const list = Array.isArray(page) ? page : [];
    if (list.length === 0) break;
    out.push(...list);
    const last = list.at(-1) as { id?: string; ts?: string | number } | undefined;
    const lastTs = Number(last?.ts ?? 0);
    // 短页=末页；游标无进展（同 id 重复）兜底防死循环；越过窗口起点可停
    if (list.length < limit || !last?.id || last.id === cursor || (lastTs > 0 && lastTs <= opts.fromTimeMs)) break;
    cursor = last.id;
  }
  return out;
}

function qsOf(query: Record<string, string | number | undefined>): string {
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

function parseShell(text: string): WxShell {
  try {
    return JSON.parse(text) as WxShell;
  } catch {
    throw ApiError.upstream("Bitget 响应解析失败");
  }
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init as never);
