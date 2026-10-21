"use client";

/**
 * 全站唯一会话源（REQ-004 FR-E1.2 / 4-F）：SessionProvider + useSession()。
 * - /api/auth/me 单次拉取、401 统一跳登录（唯一跳转点）
 * - logout() 清会话并跳转；setUser 供登录/注册页写入
 * - 挂在根布局；子页面直接 useSession()，禁止散落自行拉取 /api/auth/me
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { setSessionToken } from "@shiguangri/shared/client-api";
import { api, ApiClientError, NO_REDIRECT_PATHS } from "./api";
import { clearCachedApiData } from "@/lib/sw-cache";

export interface ModulePref {
  key: string;
  name: string;
  level: "domain" | "submodule";
  parent: string | null;
  effective: boolean;
  controllable: boolean;
  value: boolean | null;
}

export interface SessionUser {
  id: string;
  nickname: string | null;
  phone: string | null;
  isAdmin: boolean;
  /** 有效开启的模块 key 全量（REQ-028 三层计算结果） */
  modules: string[];
  /** 功能管理区明细（【我的】→功能管理 消费） */
  modulePrefs?: ModulePref[];
  phoneVerified: boolean;
  /** 本地开发后门（AUTH_DISABLED=1）时为 true：导航栏隐藏账号/登出入口 */
  authDisabled?: boolean;
  /** 账号创建时间（ISO，可 null）——/api/auth/me 原样返回，profile 页「加入于」展示用 */
  createdAt?: string | null;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: SessionUser | null) => void;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
  setUser: () => {},
});

const LOGIN_PATH = "/login";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // 账号切换（共用设备直接登录另一账号，不经登出）时清 SW 的 /api/* 缓存：
  // 旧缓存是上一账号的 feed/contacts/finance 个人数据，弱网/离线下 network-first 回退会读到
  const switchUser = useCallback((next: SessionUser | null) => {
    setUser((prev) => {
      if (next && prev && next.id !== prev.id) clearCachedApiData();
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api<SessionUser>("/api/auth/me", "GET");
      setUser(me);
    } catch (e) {
      // 仅会话失效（401）才清会话跳登录；/setup 等免登录页停留本页（与 NO_REDIRECT_PATHS 同语义）。
      // 网络抖动/5xx 不能把用户踢出——旧实现任何失败都跳登录，弱网下会清掉正在填写的页面
      if (
        e instanceof ApiClientError &&
        e.status === 401 &&
        typeof window !== "undefined" &&
        !NO_REDIRECT_PATHS.includes(window.location.pathname)
      ) {
        setUser(null);
        router.replace(LOGIN_PATH);
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", "POST").catch(() => {});
    // 服务端 200 即已吊销：显式清本机 token（旧版只靠下次任意请求 401 兜底，共享设备上是敏感残留）
    await setSessionToken(null).catch(() => {});
    // SW 的 /api/* 缓存含本账号个人数据（feed/contacts/finance）：登出一并清掉（共享设备隐私）
    clearCachedApiData();
    setUser(null);
    router.replace(LOGIN_PATH);
  }, [router]);

  const value = useMemo(() => ({ user, loading, refresh, logout, setUser: switchUser }), [user, loading, refresh, logout, switchUser]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
