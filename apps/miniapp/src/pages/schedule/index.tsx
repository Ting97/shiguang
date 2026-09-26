import { useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { loadTodos, toggleTodo, bjToday } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import "./index.scss";

export default function Schedule() {
  const [todos, setTodos] = useState<any[]>([]);
  const [inited, setInited] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      const j = await loadTodos();
      setTodos(j.todos ?? []);
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

  async function toggle(t: any) {
    try {
      await toggleTodo(t.id, !t.done);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "操作失败");
    }
  }

  const today = bjToday();
  const open = todos.filter((t) => !t.done);

  function go(url: string) {
    Taro.navigateTo({ url });
  }

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}

      <View className="entries">
        <Text className="entry" onClick={() => go(`/packages/calendar/index?date=${today}`)}>📅 日历复盘</Text>
        <Text className="entry" onClick={() => go("/packages/space/list/index")}>🎯 目标空间</Text>
        <Text className="entry" onClick={() => go("/packages/contact/list/index")}>🧑 人际</Text>
      </View>

      <View className="card">
        <Text className="h2">待办（未完成 {open.length}）</Text>
        {todos.length === 0 && <Text className="dim">暂无待办 —— 在动态里说一句即可创建</Text>}
        {todos.slice(0, 30).map((t) => (
          <View key={t.id} className="todo-row" onClick={() => toggle(t)}>
            <Text className="todo-check">{t.done ? "☑" : "☐"}</Text>
            <Text className={`todo-title grow ${t.done ? "done" : ""}`}>{t.title}</Text>
            {t.due_at && <Text className="dim">{String(t.due_at).slice(5, 10).replace("-", "/")}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}
