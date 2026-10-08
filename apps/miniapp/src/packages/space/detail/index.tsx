/**
 * 空间详情（= web spaces/[id]/detail.tsx 移动端形态）：
 * msg 横幅 → HeaderCard（可重命名/目标到期就地编辑/‹ 返回/⋯ 菜单）→ 分区 tab FilterChip
 * （TODO·行动 / 感悟 / 动态）→ TodoSection / ReflectionTab / MomentsTab。
 * 取数（= web use-space-data）：GET /api/spaces（头卡从列表按 id 找，:id 无 GET）+ todos all/done
 * + feed?spaceId + activities 五路并行（allSettled，部分失败跳过）。
 */
import { useEffect, useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import LucideIcon from "../../../components/lucide-icon";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import { showToast } from "@/components/toast";
import { loadFeed, loadSpaces } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import type { SpaceRow } from "../shared";
import HeaderCard from "./header-card";
import TodoSection from "./todo-section";
import ReflectionTab from "./reflection-tab";
import MomentsTab from "./moments-tab";
import {
  deleteTodo,
  loadActivities,
  loadTodoView,
  patchTodo,
  type Activity,
  type TodoItem,
} from "./api";
import { deleteSpace, patchSpace } from "../list/api"; // 空间 CRUD 端点在列表页局部 api（同分包复用）
import "./index.scss";

/** 删除/归档后的回列表：优先 navigateBack（入口是列表 navigateTo，栈里还有列表实例——
 * redirectTo 会再压一份新列表成 [list, list]，物理返回落在旧实例），栈空（分享直达）兜底 redirectTo */
function backToList(url: string) {
  Taro.navigateBack().catch(() => Taro.redirectTo({ url }));
}

type SpaceTab = "todo" | "reflection" | "moments";

export default function SpaceDetailPage() {
  const router = Taro.useRouter();
  const id = router.params.id ?? "";

  const [space, setSpace] = useState<SpaceRow | null>(null);
  const [allSpaces, setAllSpaces] = useState<SpaceRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [doneTodos, setDoneTodos] = useState<TodoItem[]>([]);
  const [moments, setMoments] = useState<{ id: string; raw_text: string; created_at: string }[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tab, setTab] = useState<SpaceTab>("todo");
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  const [inited, setInited] = useState(false);

  async function load() {
    setLoadErr(null);
    try {
      // 五路无依赖并行；todo/feed/activities 单路失败不拖垮头卡（web allSettled 同语义）
      const [sj, tj, dj, fj, aj] = await Promise.allSettled([
        loadSpaces(),
        loadTodoView("all"),
        loadTodoView("done"),
        loadFeed(20, 0, "", id),
        loadActivities(),
      ]);
      if (sj.status === "fulfilled") {
        const spaces = (sj.value.spaces as SpaceRow[]) ?? [];
        setAllSpaces(spaces);
        const s = spaces.find((x) => x.id === id) ?? null;
        setSpace(s);
        setNotFound(!s);
      }
      if (tj.status === "fulfilled") setTodos((tj.value.todos ?? []).filter((t) => t.space_id === id));
      if (dj.status === "fulfilled") setDoneTodos(((dj.value.todos ?? []) as TodoItem[]).filter((t) => t.space_id === id));
      if (fj.status === "fulfilled") setMoments((fj.value.moments ?? []) as typeof moments);
      if (aj.status === "fulfilled") setActivities(aj.value.activities ?? []);
    } catch (e: any) {
      setLoadErr(e?.message ?? "加载失败");
    }
  }

  // 副作用移入 useEffect：render 期 setState+发请求在并发/StrictMode 下会双发
  useEffect(() => {
    if (inited || !getSessionToken() || !id) return;
    setInited(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullDownRefresh(() => {
    if (!getSessionToken()) {
      Taro.stopPullDownRefresh(); // 游客态无服务端通道，直接收起动画（防 401 错误横幅/toast）
      return;
    }
    load().finally(() => Taro.stopPullDownRefresh());
  });

  // 游客无服务端只读通道（/api 全 401）：给出登录引导出口（全部 hooks 之后早退）
  if (!getSessionToken()) {
    return (
      <PageShell>
        <GuestGate title="空间详情" desc="进度、待办、动态与感悟" />
      </PageShell>
    );
  }

  async function saveRename(name: string): Promise<boolean> {
    try {
      await patchSpace(id, { name });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "重命名失败" });
      return false;
    }
    setSpace((s) => (s ? { ...s, name } : s));
    showToast({ type: "ok", text: "已重命名" });
    return true;
  }

  async function saveTargetDate(v: string | null): Promise<boolean> {
    try {
      await patchSpace(id, { targetDate: v });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "网络异常，请稍后重试" });
      return false;
    }
    setSpace((s) => (s ? { ...s, target_date: v } : s));
    showToast({ type: "ok", text: v ? `⏳ 目标到期时间已调整为 ${v}` : "目标到期时间已清除" });
    return true;
  }

  async function setStatus(status: "active" | "archived") {
    if (!space) return;
    try {
      await patchSpace(space.id, { status });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "操作失败" });
      return;
    }
    // web 归档/恢复后跳回列表（location.href="/spaces"）
    backToList("/packages/space/list/index");
  }

  async function removeSpace() {
    if (!space) return;
    // 两步确认在菜单里完成（armDelete 态），此处 web 原生 confirm 的说明并入 showModal
    const res = await Taro.showModal({
      title: "删除空间",
      content: `删除空间「${space.name}」？\n含 ${space.reflection_count ?? 0} 篇感悟（将一并删除）；${space.todo_total ?? 0} 条关联 todo、${space.entry_count ?? 0} 条动态仅解除归属。`,
      confirmColor: "#f43f5e",
    });
    if (!res.confirm) return;
    try {
      await deleteSpace(space.id);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "删除失败" });
      return;
    }
    backToList("/packages/space/list/index");
  }

  /** 行级空间关联（菜单「关联空间」→ 选择后 PATCH spaceId） */
  async function pickSpace(todoId: string, target: string | null): Promise<boolean> {
    try {
      await patchTodo(todoId, { spaceId: target });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "网络异常，请稍后重试" });
      return false;
    }
    showToast({ type: "ok", text: target ? "🎯 已关联空间" : "已移除空间归属" });
    await load();
    return true;
  }

  /* ---- 加载中 / 失败 / 404 形态（= web detail 三分支） ---- */
  if (notFound || !id) {
    return (
      <PageShell active="spaces">
        <View className="glass glass-p5 dt-notfound">
          <Text className="dt-notfound-icon">🎯</Text>
          <Text className="dt-notfound-text">空间不存在或已删除</Text>
          <Button
            className="btn-reset btn-primary dt-notfound-btn"
            hoverClass="press"
            onClick={() => backToList("/packages/space/list/index")}
          >
            返回目标列表
          </Button>
        </View>
      </PageShell>
    );
  }

  if (!space) {
    return (
      <PageShell active="spaces">
        {loadErr ? (
          <View className="dt-center">
            <Text className="dt-load-err">加载失败：{loadErr}</Text>
            <Button
              className="btn-reset btn-primary dt-retry"
              hoverClass="press"
              onClick={() => {
                setSpace(null);
                void load();
              }}
            >
              重试
            </Button>
          </View>
        ) : (
          <View className="dt-center">
            <Text className="hint">加载中…</Text>
          </View>
        )}
      </PageShell>
    );
  }

  const tabs: { key: SpaceTab; label: string; count: number }[] = [
    { key: "todo", label: "TODO·行动", count: todos.length },
    { key: "reflection", label: "感悟", count: space.reflection_count ?? 0 },
    { key: "moments", label: "动态", count: moments.length },
  ];

  return (
    <PageShell active="spaces">
      {/* 空间头部（可编辑/归档/删除/返回链） */}
      <HeaderCard space={space} onRename={saveRename} onSaveTargetDate={saveTargetDate} onOpenMenu={() => setSpaceMenu(true)} />

      {/* 分区 tab（= FilterChip 组，激活 sky→indigo 渐变） */}
      <View className="dt-tabs">
        {tabs.map((t) => (
          <View key={t.key} className={`dt-tab ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
            <Text>{t.label}</Text>
            <Text className="dt-tab-count">{t.count}</Text>
          </View>
        ))}
      </View>

      {/* 关联 TODO·行动 */}
      {tab === "todo" && (
        <TodoSection
          spaceId={id}
          todos={todos}
          doneTodos={doneTodos}
          activities={activities}
          allSpaces={allSpaces}
          onChanged={() => void load()}
          onPickSpace={pickSpace}
        />
      )}

      {/* 感悟 */}
      {tab === "reflection" && <ReflectionTab spaceId={id} onChanged={() => void load()} rev={0} />}

      {/* 关联动态 */}
      {tab === "moments" && (
        <MomentsTab spaceId={id} moments={moments} onChanged={() => void load()} />
      )}

      {/* 空间操作菜单（⋯ 收纳归档/删除；= web SpaceMenuModal 移动端形态） */}
      {spaceMenu && <View className="overlay" onClick={() => { setSpaceMenu(false); setArmDelete(false); }} />}
      {spaceMenu && (
        <View className="sheet dt-menu safe-bottom">
          <View className="dt-menu-handle" />
          <Text className="dt-menu-title">{space.name}</Text>
          {space.status === "archived" ? (
            <View
              className="dt-menu-item"
              onClick={() => {
                setSpaceMenu(false);
                void setStatus("active");
              }}
            >
              <View className="dt-menu-icon">
                <LucideIcon name="send" size={14} color="var(--ink-mute)" />
              </View>
              <Text className="dt-menu-text">恢复空间</Text>
            </View>
          ) : (
            <View
              className="dt-menu-item warn"
              onClick={() => {
                setSpaceMenu(false);
                void setStatus("archived");
              }}
            >
              <View className="dt-menu-icon">
                <LucideIcon name="download" size={14} color="var(--warn)" />
              </View>
              <Text className="dt-menu-text">归档空间</Text>
            </View>
          )}
          <View
            className={`dt-menu-item danger ${armDelete ? "armed" : ""}`}
            onClick={() => {
              if (!armDelete) {
                // 两步删除：首点武装，3 秒内再点执行
                setArmDelete(true);
                setTimeout(() => setArmDelete(false), 3000);
                return;
              }
              setSpaceMenu(false);
              void removeSpace();
            }}
          >
            <View className="dt-menu-icon">
                <LucideIcon name="trash_2" size={14} color="var(--danger)" />
              </View>
            <Text className="dt-menu-text">{armDelete ? "确认删除？（3 秒内再点）" : "删除空间"}</Text>
          </View>
        </View>
      )}
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="target" label="目标空间" />
    </PageShell>
  );
}
