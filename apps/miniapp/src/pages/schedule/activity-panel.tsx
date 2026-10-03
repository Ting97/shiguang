/**
 * 分类子页（= web activity-panel.tsx 整体平移）：活动分类管理。
 * 预设分类不可删除（可改名称/图标/颜色/默认时长）；自定义分类删除后其记录归入「其他」。
 * 小程序差异：颜色选择用固定色板（无 input[type=color]）；删除保持 web 两步确认（3 秒内再点）。
 */
import { useEffect, useRef, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import IconPicker from "./icon-picker";
import { createActivity, deleteActivity, loadActivities, patchActivity, type Activity } from "./api";
import { ApiError } from "@/lib/request";
import { showToast } from "@/components/toast";

interface Draft {
  id: string;
  name: string;
  icon: string;
  color: string;
  defaultMin: number;
  is_preset?: boolean;
}

/** 色板（web input[type=color] 的小程序替代；取活动分类常用色） */
const PALETTE = [
  "#38bdf8", "#0ea5e9", "#6366f1", "#8b5cf6", "#a855f7", "#ec4899",
  "#f43f5e", "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#64748b", "#78716c",
];

export default function ActivityPanel({ refreshTick = 0 }: { refreshTick?: number }) {
  const [list, setList] = useState<Activity[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [adding, setAdding] = useState({ name: "", icon: "🏷", color: "#eab308", defaultMin: 30 });
  // 新增/保存进行中锁，防连点重复提交
  const [busy, setBusy] = useState(false);
  // 删除两步确认（= web armDeleteId）：首点进入待确认态，3 秒内再点才真删
  const [armDeleteId, setArmDeleteId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    try {
      const j = await loadActivities();
      setList(j.activities ?? []);
    } catch (e: any) {
      // 失败置空列表 + 提示（不外抛）
      setList([]);
      showToast({ type: "err", text: e?.message ?? "加载失败" });
    }
  }
  useEffect(() => {
    void load();
  }, []);
  // 页面下拉刷新（面板常驻挂载，按 tick 重拉）
  useEffect(() => {
    if (refreshTick > 0) void load();
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  async function add() {
    if (!adding.name.trim()) {
      showToast({ type: "err", text: "名称必填" });
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await createActivity(adding);
    } catch (e: any) {
      setBusy(false);
      showToast({ type: "err", text: e instanceof ApiError ? (e.message === "操作失败" ? "新增失败" : e.message) : "网络异常，请稍后重试" });
      return;
    }
    setBusy(false);
    showToast({ type: "ok", text: `✅ 已新增分类「${adding.name.trim()}」` });
    setAdding({ name: "", icon: "🏷", color: "#eab308", defaultMin: 30 });
    await load();
  }

  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    try {
      await patchActivity(editing.id, { name: editing.name, icon: editing.icon, color: editing.color, defaultMin: editing.defaultMin });
    } catch (e: any) {
      setBusy(false);
      showToast({ type: "err", text: e instanceof ApiError ? (e.message === "操作失败" ? "保存失败" : e.message) : "网络异常，请稍后重试" });
      return;
    }
    setBusy(false);
    setEditing(null);
    showToast({ type: "ok", text: "💾 已保存" });
    await load();
  }

  async function remove(a: Activity) {
    try {
      await deleteActivity(a.id);
    } catch (e: any) {
      showToast({ type: "err", text: e instanceof ApiError ? (e.message === "操作失败" ? "删除失败" : e.message) : "网络异常，请稍后重试" });
      return;
    }
    showToast({ type: "ok", text: `🗑 已删除「${a.name}」` });
    setArmDeleteId(null);
    await load();
  }

  function onDeleteClick(a: Activity) {
    if (armDeleteId === a.id) {
      if (armTimer.current) clearTimeout(armTimer.current);
      void remove(a);
      return;
    }
    setArmDeleteId(a.id);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmDeleteId(null), 3000);
  }

  /** 颜色/时长编辑行（新增与行内编辑共用一套字段） */
  function draftFields(
    value: { icon: string; color: string; defaultMin: number },
    onChange: (patch: Partial<{ icon: string; color: string; defaultMin: number }>) => void,
    compact: boolean,
  ) {
    return (
      <>
        <IconPicker value={value.icon} onChange={(icon) => onChange({ icon })} />
        <View className={`ap-palette ${compact ? "sm" : ""}`}>
          {PALETTE.map((c) => (
            <View
              key={c}
              className={`ap-swatch ${value.color.toLowerCase() === c.toLowerCase() ? "active" : ""}`}
              style={{ backgroundColor: c }}
              onTap={() => onChange({ color: c })}
            />
          ))}
        </View>
        <Input
          className="ap-min-input"
          type="number"
          value={String(value.defaultMin)}
          onInput={(e) => onChange({ defaultMin: Number(e.detail.value) || 0 })}
        />
        <Text className="hint">分钟</Text>
      </>
    );
  }

  return (
    <View>
      <Text className="ap-intro hint">
        预设分类不可删除（可改名称/图标/颜色/默认时长）；自定义分类删除后其记录归入「其他」
      </Text>

      {/* 新增（移动端纵向堆叠、控件全宽，触控目标 ≥40px，= web 注释同款要求） */}
      <View className="glass add-act">
        <Input
          className="ap-input"
          value={adding.name}
          maxlength={30}
          placeholder="新分类名称（如：带娃 / 冥想 / 副业）"
          placeholderClass="input-placeholder"
          onInput={(e) => setAdding({ ...adding, name: e.detail.value })}
          onConfirm={add}
        />
        <View className="ap-fields">
          {draftFields(adding, (p) => setAdding({ ...adding, ...p }), false)}
        </View>
        <View className={`btn-primary ap-add-btn ${busy ? "disabled" : ""}`} onTap={busy ? undefined : add}>
          新增
        </View>
      </View>

      {/* 列表 */}
      <View className="ap-list">
        {list.map((a) =>
          editing?.id === a.id ? (
            <View key={a.id} className="ap-editing">
              <Input
                className="ap-input sm"
                value={editing.name}
                maxlength={30}
                onInput={(e) => setEditing({ ...editing, name: e.detail.value })}
              />
              <View className="ap-fields">{draftFields(editing, (p) => setEditing({ ...editing, ...p }), true)}</View>
              <View className="ap-editing-actions">
                <View className="te-btn mute" onTap={() => setEditing(null)}>
                  取消
                </View>
                <View className={`te-btn save ${busy ? "disabled" : ""}`} onTap={busy ? undefined : save}>
                  保存
                </View>
              </View>
            </View>
          ) : (
            <View key={a.id} className="ap-row glass">
              <View className="ap-dot" style={{ backgroundColor: a.color }} />
              <Text className="ap-icon">{a.icon}</Text>
              <View className="ap-name">
                <Text>{a.name}</Text>
                {a.is_preset && <Text className="ap-preset">预设</Text>}
              </View>
              <Text className="ap-min dim">默认 {a.default_min ?? 30} 分钟</Text>
              {/* 触屏无 hover：操作按钮常显（web @media (hover:none) 同款行为） */}
              <View
                className="ap-action"
                onTap={() => setEditing({ id: a.id, name: a.name, icon: a.icon, color: a.color, defaultMin: a.default_min ?? 30 })}
              >
                ✏️
              </View>
              {!a.is_preset && (
                <View
                  className={`ap-action ${armDeleteId === a.id ? "armed" : ""}`}
                  onTap={() => onDeleteClick(a)}
                >
                  {armDeleteId === a.id ? "确认删除?" : "🗑"}
                </View>
              )}
            </View>
          ),
        )}
      </View>
    </View>
  );
}
