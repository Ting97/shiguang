/**
 * 目标空间列表 —— 对齐 web apps/web/src/app/spaces/page.tsx 移动端形态。
 * 结构：msg 横幅 → hero（拾光·目标 + ＋新建空间）→ 空间卡列表
 * （icon 圆底 color+26 / 名称就地重命名 / meta 行 / ⋯ 底部弹层菜单 / 描述两行截断 /
 * todo 进度条 h-1.5 填充 space.color + 百分比）→ 归档折叠区（恢复/两步删除）
 * → 新建/编辑居中弹层（图标/颜色/日期选择）→ 卡片 ⋯ 底部弹层（编辑/归档/两步删除）。
 */
import { useEffect, useState } from "react";
import { View, Text, Input, Textarea, Button, Picker } from "@tarojs/components";
import LucideIcon from "../../../components/lucide-icon";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import { showToast } from "@/components/toast";
import { loadSpaces } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import type { SpaceRow } from "../shared";
import { bjDate, bjToday, daysOf, progressOf, useArmConfirm } from "../shared";
import { createSpace, deleteSpace, patchSpace } from "./api";
import "./index.scss";

/* = web ICONS / COLORS 常量逐值同源 */
const ICONS = ["🎯", "📚", "💪", "💰", "🚀", "🧘", "🎓", "🏃", "✍️", "🎸", "🏠", "❤️"];
const COLORS = ["#38bdf8", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6", "#64748b"];

/** 新建/编辑弹层草稿（= web Draft；默认开始日期取北京今天） */
interface Draft {
  name: string;
  description: string;
  icon: string;
  color: string;
  startedAt: string;
  targetDate: string;
}
const EMPTY: Draft = { name: "", description: "", icon: "🎯", color: "#38bdf8", startedAt: "", targetDate: "" };

export default function SpaceListPage() {
  const [spaces, setSpaces] = useState<SpaceRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null); // null=关闭；editingId null=新建
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); // 保存中防双击重复创建
  // 卡片 ⋯ 菜单（web 移动端=底部弹层）
  const [cardMenu, setCardMenu] = useState<SpaceRow | null>(null);
  // 名称就地重命名（= web InlineRename：展示态 ⇄ 编辑态）
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const armDelete = useArmConfirm();
  const [inited, setInited] = useState(false);

  async function load() {
    setLoadErr(null);
    try {
      const j = await loadSpaces();
      setSpaces((j.spaces as SpaceRow[]) ?? []);
    } catch (e: any) {
      // 4xx 业务错置空列表（= web ApiClientError 分支）；网络异常给重试入口
      if (e?.status && e.status < 500) setSpaces([]);
      else setLoadErr(e?.message ?? "加载失败");
    }
  }

  // 副作用移入 useEffect：render 期 setState+发请求在并发/StrictMode 下会双发
  useEffect(() => {
    if (inited || !getSessionToken()) return;
    setInited(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullDownRefresh(() => {
    load().finally(() => Taro.stopPullDownRefresh());
  });

  // 游客无服务端只读通道（/api 全 401）：给出登录引导出口（全部 hooks 之后早退）
  if (!getSessionToken()) {
    return (
      <PageShell active="spaces">
        <GuestGate title="目标空间" desc="把目标装进空间：进度、待办与感悟沉淀" />
      </PageShell>
    );
  }

  function openNew() {
    // 默认开始日期=北京口径今天（bjToday）：本地 getter 在海外设备差一天
    setEditing({ ...EMPTY, startedAt: bjToday() });
    setEditingId(null);
  }

  function openEdit(s: SpaceRow) {
    setEditing({
      name: s.name,
      description: s.description ?? "",
      icon: s.icon ?? "🎯",
      color: s.color ?? "#38bdf8",
      startedAt: s.started_at ? bjDate(s.started_at) : "",
      targetDate: s.target_date ? bjDate(s.target_date) : "",
    });
    setEditingId(s.id);
  }

  async function save() {
    if (!editing || saving) return;
    const body = {
      name: editing.name,
      description: editing.description || null,
      icon: editing.icon,
      color: editing.color,
      startedAt: editing.startedAt || null,
      targetDate: editing.targetDate || null,
    };
    setSaving(true);
    try {
      await (editingId ? patchSpace(editingId, body) : createSpace(body));
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "网络异常，请稍后重试" });
      return;
    } finally {
      setSaving(false);
    }
    const name = editing.name;
    setEditing(null);
    showToast({ type: "ok", text: editingId ? "空间已更新" : `空间「${name}」已创建 🎯` });
    await load();
  }

  async function setStatus(s: SpaceRow, status: "active" | "archived") {
    try {
      await patchSpace(s.id, { status });
    } catch (e: any) {
      // 失败报错并中止，不提示成功（web 同注释：吞错会无条件弹「已归档」）
      showToast({ type: "err", text: e?.message ?? "操作失败" });
      return;
    }
    showToast({ type: "ok", text: status === "archived" ? `「${s.name}」已归档` : `「${s.name}」已恢复` });
    await load();
  }

  async function remove(s: SpaceRow) {
    if (!armDelete.arm(s.id)) return;
    try {
      await deleteSpace(s.id);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "删除失败" });
      return;
    }
    showToast({ type: "ok", text: `「${s.name}」已删除` });
    await load();
  }

  async function saveRename(s: SpaceRow) {
    const name = renameDraft.trim();
    if (!name) {
      showToast({ type: "err", text: "名称不能为空" });
      return;
    }
    try {
      await patchSpace(s.id, { name });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "重命名失败" });
      return;
    }
    setRenamingId(null);
    showToast({ type: "ok", text: "已重命名" });
    await load();
  }

  function go(id: string) {
    Taro.navigateTo({ url: `/packages/space/detail/index?id=${id}` });
  }

  const active = (spaces ?? []).filter((s) => s.status === "active");
  const archived = (spaces ?? []).filter((s) => s.status === "archived");

  return (
    <PageShell active="spaces">
      {/* = web header.mb-5.text-center：居中 hero + 副标题 + 新建按钮 */}
      <View className="sp-head">
        <View className="hero text-gradient sp-hero">
          拾光
          <Text className="sp-hero-sub">目标</Text>
        </View>
        <View className="hint sp-head-sub">
          创建一个空间，专属于这个目标的 TODO·行动与感悟 —— 相关动态自动归属，见证每天的靠近
        </View>
        <Button className="btn-reset btn-primary sp-new-btn" hoverClass="press" onClick={openNew}>
          ＋ 新建空间
        </Button>
      </View>

      {spaces === null ? (
        loadErr ? (
          <View className="sp-center">
            <Text className="sp-load-err">加载失败：{loadErr}</Text>
            <Button className="btn-reset btn-primary sp-retry-btn" hoverClass="press" onClick={() => void load()}>
              重试
            </Button>
          </View>
        ) : (
          <View className="sp-center">
            <Text className="hint">加载中…</Text>
          </View>
        )
      ) : active.length === 0 ? (
        /* = web glass p-10 empty-state：还没有目标空间 */
        <View className="glass glass-p4 sp-empty">
          <Text className="sp-empty-icon">🎯</Text>
          <Text className="sp-empty-title">还没有目标空间</Text>
          <Text className="hint sp-empty-desc">
            为一个大目标（考研上岸 / 副业过万 / 完成全马…）建一个空间，把它的 TODO·行动、感悟和动态都聚在专属容器里
          </Text>
          <Button className="btn-reset btn-primary sp-empty-btn" hoverClass="press" onClick={openNew}>
            创建第一个空间
          </Button>
        </View>
      ) : (
        <View className="sp-grid">
          {active.map((s) => {
            const days = daysOf(s.started_at);
            const pct = progressOf(s);
            const color = s.color || "#38bdf8"; // 色值要拼「26」透明底，var() 拼不出 alpha，hex 兜底（DB 默认 #38bdf8）
            return (
              /* = web Link.glass.rounded-2xl.p-4 目标卡 */
              <View key={s.id} className="glass glass-p4 sp-card fade-up" onClick={() => go(s.id)}>
                <View className="sp-card-top">
                  <View className="sp-icon" style={{ backgroundColor: `${color}26` }}>
                    <Text className="sp-icon-emoji">{s.icon || "🎯"}</Text>
                  </View>
                  <View className="sp-card-mid">
                    {renamingId === s.id ? (
                      /* 名称就地重命名（= web InlineRename 编辑态） */
                      <View className="sp-rename" onClick={(e) => e.stopPropagation()}>
                        <Input
                          className="input sp-rename-input"
                          value={renameDraft}
                          maxlength={40}
                          focus
                          onInput={(e) => setRenameDraft(e.detail.value)}
                        />
                        <View className="sp-rename-ok" onClick={() => void saveRename(s)}>
                          <LucideIcon name="check" size={16} color="var(--accent)" />
                        </View>
                        <View className="sp-rename-cancel" onClick={() => setRenamingId(null)}>
                          <LucideIcon name="x" size={14} color="var(--ink-mute)" />
                        </View>
                      </View>
                    ) : (
                      <View
                        className="sp-name-row"
                        onClick={(e) => {
                          e.stopPropagation(); // 点名字不进详情，进入重命名
                          setRenameDraft(s.name);
                          setRenamingId(s.id);
                        }}
                      >
                        <Text className="sp-name">{s.name}</Text>
                        <View className="sp-name-pen">
                          <LucideIcon name="pencil" size={11} color="var(--ink-dim)" />
                        </View>
                      </View>
                    )}
                    <Text className="sp-meta">
                      {s.todo_total ?? 0} todo · {s.entry_count ?? 0} 动态 · 感悟 {s.reflection_count ?? 0}
                      {days != null ? ` · 第 ${days} 天` : ""}
                      {s.target_date ? ` · ⏳ ${bjDate(s.target_date).slice(5)}` : ""}
                    </Text>
                  </View>
                  <Text
                    className="sp-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCardMenu(s);
                    }}
                  >
                    ⋯
                  </Text>
                </View>
                {!!s.description && <Text className="sp-desc">{s.description}</Text>}
                {/* todo 进度条：h-1.5 填充 space.color + 右侧百分比 */}
                <View className="sp-prog">
                  <View className="sp-prog-label">
                    <Text>todo 进度</Text>
                    <Text>{pct == null ? "暂无 todo" : `${pct}%`}</Text>
                  </View>
                  <View className="sp-prog-bar">
                    <View className="sp-prog-fill" style={{ width: `${pct ?? 0}%`, backgroundColor: color }} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* 归档区（= web <details> 折叠）：恢复 / 两步删除 */}
      {archived.length > 0 && (
        <View className="sp-archived">
          <View className="sp-archived-summary ico-row" onClick={() => setShowArchived((v) => !v)}>
            <LucideIcon name={showArchived ? "chevron_down" : "chevron_right"} size={11} color="var(--ink-dim)" />
            <Text>归档空间（{archived.length}）</Text>
          </View>
          {showArchived &&
            archived.map((s) => (
              <View key={s.id} className="sp-arch-row">
                <Text>{s.icon || "🎯"}</Text>
                <Text className="sp-arch-name">{s.name}</Text>
                <Text className="sp-arch-restore" onClick={() => void setStatus(s, "active")}>恢复</Text>
                <Text
                  className={`sp-arch-del ${armDelete.armedId === s.id ? "armed" : ""}`}
                  onClick={() => void remove(s)}
                >
                  {armDelete.armedId === s.id ? "确认删除?" : "删除"}
                </Text>
              </View>
            ))}
        </View>
      )}

      {/* 页脚徽章（REQ-全站页脚徽章，= web spaces footer 的共享组件形态） */}
      <PageFooter icon="target" label="目标空间" />

      {/* 新建/编辑弹层（web 移动端=居中弹层 inset-x-4 top-1/2，非底部 sheet） */}
      {editing && (
        <View className="overlay" onClick={() => setEditing(null)} />
      )}
      {editing && (
        <View className="sp-modal">
          <Text className="sp-modal-title">{editingId ? "编辑空间" : "新建目标空间"}</Text>
          <Input
            className="input sp-modal-input"
            value={editing.name}
            maxlength={40}
            placeholder="目标名称（如：考研上岸）"
            placeholderClass="input-placeholder"
            onInput={(e) => setEditing({ ...editing, name: e.detail.value })}
          />
          <Textarea
            className="sp-modal-desc"
            value={editing.description}
            maxlength={300}
            autoHeight
            placeholder="描述（可空：为什么重要、衡量标准…）"
            placeholderClass="input-placeholder"
            onInput={(e) => setEditing({ ...editing, description: e.detail.value })}
          />
          <Text className="sp-field-label">图标</Text>
          <View className="sp-icon-grid">
            {ICONS.map((ic) => (
              <View
                key={ic}
                className={`sp-icon-cell ${editing.icon === ic ? "on" : ""}`}
                onClick={() => setEditing({ ...editing, icon: ic })}
              >
                <Text>{ic}</Text>
              </View>
            ))}
          </View>
          <Text className="sp-field-label">颜色</Text>
          <View className="sp-color-row">
            {COLORS.map((c) => (
              <View
                key={c}
                className={`sp-color-dot ${editing.color === c ? "on" : ""}`}
                style={{ backgroundColor: c, ...(editing.color === c ? { boxShadow: `0 0 0 4px var(--surface), 0 0 0 8px ${c}` } : {}) }}
                onClick={() => setEditing({ ...editing, color: c })}
              />
            ))}
          </View>
          {/* 日期（web type=date input → Taro Picker；已设值给 ✕ 清除） */}
          <View className="sp-date-row">
            <View className="sp-date-field">
              <Text className="sp-field-label">开始日期</Text>
              <View className="sp-date-pick">
                <Picker
                  mode="date"
                  value={editing.startedAt || bjToday()}
                  onChange={(e) => setEditing({ ...editing, startedAt: e.detail.value })}
                >
                  <View className="sp-date-value">
                    <Text>{editing.startedAt || "选择日期"}</Text>
                  </View>
                </Picker>
                {!!editing.startedAt && (
                  <View className="sp-date-clear" onClick={() => setEditing({ ...editing, startedAt: "" })}>
                    <LucideIcon name="x" size={12} color="var(--ink-mute)" />
                  </View>
                )}
              </View>
            </View>
            <View className="sp-date-field">
              <Text className="sp-field-label">目标日期</Text>
              <View className="sp-date-pick">
                <Picker
                  mode="date"
                  value={editing.targetDate || bjToday()}
                  onChange={(e) => setEditing({ ...editing, targetDate: e.detail.value })}
                >
                  <View className="sp-date-value">
                    <Text>{editing.targetDate || "选择日期"}</Text>
                  </View>
                </Picker>
                {!!editing.targetDate && (
                  <View className="sp-date-clear" onClick={() => setEditing({ ...editing, targetDate: "" })}>
                    <LucideIcon name="x" size={12} color="var(--ink-mute)" />
                  </View>
                )}
              </View>
            </View>
          </View>
          <View className="sp-modal-foot">
            <Button className="btn-reset sp-modal-cancel" hoverClass="press" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button
              className={`btn-reset btn-primary sp-modal-save ${!editing.name.trim() || saving ? "disabled" : ""}`}
              hoverClass="press"
              disabled={!editing.name.trim() || saving}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : editingId ? "保存" : "创建"}
            </Button>
          </View>
        </View>
      )}

      {/* 卡片 ⋯ 菜单（web 移动端=底部弹层 bg-elevated）：编辑/归档/两步删除 */}
      {cardMenu && (
        <View className="overlay" onClick={() => setCardMenu(null)} />
      )}
      {cardMenu && (
        <View className="sheet sp-menu-sheet safe-bottom">
          <View className="sp-menu-handle" />
          <Text className="sp-menu-title">{cardMenu.name}</Text>
          <View
            className="sp-menu-item"
            onClick={() => {
              const s = cardMenu;
              setCardMenu(null);
              openEdit(s);
            }}
          >
            <View className="sp-menu-icon">
            <LucideIcon name="pencil" size={14} color="var(--accent)" />
          </View>
            <Text className="sp-menu-text">编辑空间</Text>
          </View>
          <View
            className="sp-menu-item warn"
            onClick={() => {
              const s = cardMenu;
              setCardMenu(null);
              void setStatus(s, "archived");
            }}
          >
            <View className="sp-menu-icon">
            <LucideIcon name="download" size={14} color="var(--warn)" />
          </View>
            <Text className="sp-menu-text">归档空间</Text>
          </View>
          <View
            className={`sp-menu-item danger ${armDelete.armedId === cardMenu.id ? "armed" : ""}`}
            onClick={() => void remove(cardMenu)}
          >
            <View className="sp-menu-icon">
            <LucideIcon name="trash_2" size={14} color="var(--danger)" />
          </View>
            <Text className="sp-menu-text">
              {armDelete.armedId === cardMenu.id ? "确认删除？（3 秒内再点）" : "删除空间"}
            </Text>
          </View>
        </View>
      )}
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="target" label="目标空间" />
    </PageShell>
  );
}
