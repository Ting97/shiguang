import { useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { loadSpaces } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import "./index.scss";

/**
 * 空间行契约（grep apps/api/src/server/goal/repo.ts listWithStats 查证）：
 * GET /api/spaces → {spaces:[{id,name,description,icon,color,status,started_at,target_date,
 *   todo_total,todo_done,action_total,action_done,entry_count,reflection_count,...}]}
 * SQL 已排 active 在前；进度与 web spaces/page.tsx 同口径 = todo_done/todo_total（顶层待办）。
 * 注意没有独立的数字「进度」字段，进度条必须前端现算。
 */
interface SpaceRow {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  status?: string;
  target_date?: string | null;
  todo_total?: number;
  todo_done?: number;
  entry_count?: number;
  reflection_count?: number;
}

export default function SpaceListPage() {
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  async function refresh() {
    try {
      const j = await loadSpaces();
      setSpaces(j.spaces ?? []);
      setMsg(null);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
  }

  if (!inited && getSessionToken()) {
    setInited(true);
    void refresh();
  }

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh());
  });

  function go(id: string) {
    Taro.navigateTo({ url: `/packages/space/detail/index?id=${id}` });
  }

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}
      {spaces.length === 0 && !msg && (
        <View className="card">
          <Text className="dim">{getSessionToken() ? "还没有目标空间 —— 在 PC 端或动态里创建一个" : "未登录，请先登录"}</Text>
        </View>
      )}
      {spaces.map((s) => {
        // 进度口径对齐 web：顶层待办完成度；无待办时不显示进度条（null 分支）
        const pct = s.todo_total ? Math.round(((s.todo_done ?? 0) / s.todo_total) * 100) : null;
        // 色值要与「+26 透明度」拼接，必须用 hex 兜底（var(--accent) 拼不出 alpha，DB 默认 #38bdf8）
        const color = s.color || "#38bdf8";
        return (
          <View key={s.id} className="card space-card" onClick={() => go(s.id)}>
            <View className="space-head">
              <View className="space-icon" style={{ backgroundColor: `${color}26` }}>
                <Text>{s.icon || "🎯"}</Text>
              </View>
              <View className="grow">
                <View className="space-name-row">
                  <Text className="space-name">{s.name}</Text>
                  {s.status === "archived" && <Text className="space-archived">已归档</Text>}
                </View>
                {!!s.description && <Text className="dim desc">{s.description}</Text>}
              </View>
            </View>
            <View className="space-meta">
              <Text className="dim">
                待办 {s.todo_done ?? 0}/{s.todo_total ?? 0} · 动态 {s.entry_count ?? 0} · 感悟 {s.reflection_count ?? 0}
              </Text>
              {s.target_date && <Text className="dim">目标 {String(s.target_date).slice(5, 10).replace("-", "/")}</Text>}
            </View>
            {pct != null && (
              <View className="progress-wrap">
                <View className="progress-bar">
                  {/* 颜色跟空间主色，与 web 卡片一致 */}
                  <View className="progress-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
                </View>
                <Text className="dim pct">{pct}%</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
