"use client";

/**
 * 全站唯一会话源（REQ-004 FR-E1.2 / 4-F）：SessionProvider + useSession()。
 * - /api/auth/me 单次拉取、401 统一跳登录（唯一跳转点）
 * - logout() 清会话并跳转；setUser 供登录/注册页写入
 * - 挂在根布局；子页面直接 useSession()，禁止散落自行拉取 /api/auth/me
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError, NO_REDIRECT_PATHS } from "./api";

export interface SessionUser {
  id: string;
  nickname: string | null;
  phone: string | null;
  isAdmin: boolean;
  modules: string[];
  phoneVerified: boolean;
  /** 本地开发后门（AUTH_DISABLED=1）时为 true：导航栏隐藏账号/登出入口 */
  authDisabled?: boolean;
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
    setUser(null);
    router.replace(LOGIN_PATH);
  }, [router]);

  const value = useMemo(() => ({ user, loading, refresh, logout, setUser }), [user, loading, refresh, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
