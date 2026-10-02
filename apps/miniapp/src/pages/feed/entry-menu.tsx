/**
 * 「识别与补充」菜单（= web components/entry-menu.tsx，移动端底部弹层形态）：
 * 六域行 = 点行 AI 识别该域 / 点 ✏️ 展开手动补充表单；底部「所属空间」单选归属/移除。
 * 契约：AI 识别 POST /api/entries/:id/recognize（卡片 onAI 已封装）；手动 POST /api/entries/:id/manual
 * payload 逐域对齐 web entry-menu.submitManual（due 显式按北京口径转 ISO）。
 */
import { useState } from "react";
import { View, Text, Input, Picker, ScrollView } from "@tarojs/components";
import type { Activity, FeedMomentFull } from "./api";
import { loadActiveSpaces, type SpaceRow } from "./api";
import { bjInputToIso, COMMON_MOODS, MEALS, PEOPLE_TYPES, TX_CATEGORIES } from "./kit";

/** 六域定义（icon 用 emoji 代替 lucide，语义不变） */
const SIX = [
  { key: "schedule", icon: "🕒", label: "日程", hint: "做了什么事" },
  { key: "todo", icon: "📋", label: "todo", hint: "之后要做" },
  { key: "finance", icon: "💰", label: "收支", hint: "花了 / 收入" },
  { key: "mood", icon: "😊", label: "心情", hint: "此刻情绪" },
  { key: "people", icon: "👥", label: "关系", hint: "和谁在一起" },
  { key: "diet", icon: "🍽", label: "饮食", hint: "吃了什么" },
] as const;

type SixKey = (typeof SIX)[number]["key"];

export default function EntryMenu({
  m,
  activities,
  onAI,
  onManual,
  onSetSpace,
  onClose,
}: {
  m: FeedMomentFull;
  activities: Activity[];
  /** AI 识别某域（卡片 run 封装：成功/失败提示就地展示并刷新） */
  onAI: (domain: string) => Promise<void>;
  /** 手动添加；返回 false=失败（已提示），菜单不收起不清表单（= web submitManual 的 catch-return 语义） */
  onManual: (domain: string, payload: Record<string, unknown>) => Promise<boolean>;
  onSetSpace: (spaceId: string | null) => void;
  onClose: () => void;
}) {
  const [manualDomain, setManualDomain] = useState<SixKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  // 空间菜单：null=未拉取（= web spaceMenu 惰性加载）
  const [spaceMenu, setSpaceMenu] = useState<SpaceRow[] | null>(null);

  // 手动表单各域字段（= web 的 text/start/end/due/direction/yuan/category/mood/meal/pType）
  const [text, setText] = useState("");
  const [start, setStart] = useState("12:00");
  const [end, setEnd] = useState("13:00");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("09:00");
  const [direction, setDirection] = useState("out");
  const [yuan, setYuan] = useState("");
  const [category, setCategory] = useState("餐饮");
  const [mood, setMood] = useState("");
  const [meal, setMeal] = useState("午餐");
  const [pType, setPType] = useState("见面");

  /** 域状态：按已落库产物推断（= web domainState） */
  function domainState(key: SixKey): "applied" | "none" {
    switch (key) {
      case "schedule":
        return (m.blocks ?? []).length > 0 ? "applied" : "none";
      case "todo":
        return (m.todos ?? []).length > 0 ? "applied" : "none";
      case "finance":
        return (m.transactions ?? []).length > 0 ? "applied" : "none";
      case "mood":
        return m.mood ? "applied" : "none";
      case "people":
        return (m.people ?? []).length > 0 ? "applied" : "none";
      case "diet":
        return m.diet ? "applied" : "none";
    }
  }

  async function runAI(key: SixKey) {
    if (busyDomain) return;
    setBusyDomain(key);
    try {
      await onAI(key);
    } finally {
      setBusyDomain(null);
    }
  }

  async function submitManual(key: SixKey) {
    if (busy) return;
    setBusy(true);
    try {
      let payload: Record<string, unknown> = {};
      if (key === "schedule") payload = { title: text, startTime: start, endTime: end, activityId: activities[0]?.id ?? "other" };
      // due 是北京墙上时间串：显式按 +08:00 转 ISO（裸串按宿主时区解析，UTC 容器上统一错 8 小时）
      else if (key === "todo") payload = { title: text, dueAt: bjInputToIso(dueDate ? `${dueDate}T${dueTime}` : "") };
      else if (key === "finance") payload = { direction, yuan: Number(yuan), category };
      else if (key === "mood") payload = { label: mood };
      else if (key === "diet") payload = { meal, text, kcal: null };
      else if (key === "people") payload = { name: text, type: pType };
      const ok = await onManual(key, payload);
      if (!ok) return; // 失败已由 onManual 就地提示，表单保留可改
      setManualDomain(null);
      setText("");
      setYuan("");
      setMood("");
    } finally {
      setBusy(false);
    }
  }

  /** 各域手动表单（结构对齐 web manualForm；select→Picker、input→Input） */
  function manualForm(key: SixKey) {
    const addBtn = (disabled: boolean, onTap: () => void) => (
      <Text
        className={`em-add${disabled ? " disabled" : ""}`}
        onClick={() => {
          if (!disabled) onTap();
        }}
      >
        ＋ 添加
      </Text>
    );
    switch (key) {
      case "schedule":
        return (
          <View className="em-form">
            <Input className="em-input" value={text} placeholder="做了什么" onInput={(e) => setText(e.detail.value)} />
            <View className="em-form-row">
              <Picker mode="time" value={start} onChange={(e) => setStart(e.detail.value)}>
                <View className="em-pick">{start}</View>
              </Picker>
              <Picker mode="time" value={end} onChange={(e) => setEnd(e.detail.value)}>
                <View className="em-pick">{end}</View>
              </Picker>
              {addBtn(!text.trim(), () => void submitManual(key))}
            </View>
          </View>
        );
      case "todo":
        return (
          <View className="em-form">
            <Input className="em-input" value={text} placeholder="要做什么" onInput={(e) => setText(e.detail.value)} />
            <View className="em-form-row">
              <Picker mode="date" value={dueDate || ""} onChange={(e) => setDueDate(e.detail.value)}>
                <View className="em-pick">{dueDate || "截止日期(可空)"}</View>
              </Picker>
              <Picker mode="time" value={dueTime} onChange={(e) => setDueTime(e.detail.value)}>
                <View className="em-pick">{dueTime}</View>
              </Picker>
              {addBtn(!text.trim(), () => void submitManual(key))}
            </View>
          </View>
        );
      case "finance":
        return (
          <View className="em-form">
            <View className="em-form-row">
              <Picker mode="selector" range={["支出", "收入"]} value={direction === "in" ? 1 : 0} onChange={(e) => setDirection(Number(e.detail.value) === 1 ? "in" : "out")}>
                <View className="em-pick">{direction === "in" ? "收入" : "支出"}</View>
              </Picker>
              <Picker mode="selector" range={TX_CATEGORIES} value={Math.max(0, TX_CATEGORIES.indexOf(category))} onChange={(e) => setCategory(TX_CATEGORIES[Number(e.detail.value)])}>
                <View className="em-pick">{category}</View>
              </Picker>
            </View>
            <View className="em-form-row">
              <Input className="em-input" type="digit" value={yuan} placeholder="金额（元）" onInput={(e) => setYuan(e.detail.value)} />
              {addBtn(!yuan, () => void submitManual(key))}
            </View>
          </View>
        );
      case "mood":
        return (
          <View className="em-form">
            <View className="em-form-row em-form-wrap">
              {COMMON_MOODS.map((w) => (
                <Text key={w} className={`em-mood${mood === w ? " em-mood-on" : ""}`} onClick={() => setMood(w)}>
                  {w}
                </Text>
              ))}
            </View>
            {addBtn(!mood, () => void submitManual(key))}
          </View>
        );
      case "diet":
        return (
          <View className="em-form">
            <View className="em-form-row">
              <Picker mode="selector" range={MEALS} value={MEALS.indexOf(meal)} onChange={(e) => setMeal(MEALS[Number(e.detail.value)])}>
                <View className="em-pick">{meal}</View>
              </Picker>
              <Input className="em-input" value={text} placeholder="如 牛肉面一碗" onInput={(e) => setText(e.detail.value)} />
            </View>
            {addBtn(!text.trim(), () => void submitManual(key))}
          </View>
        );
      case "people":
        return (
          <View className="em-form">
            <View className="em-form-row">
              <Input className="em-input" value={text} placeholder="和谁在一起" onInput={(e) => setText(e.detail.value)} />
              <Picker mode="selector" range={PEOPLE_TYPES} value={PEOPLE_TYPES.indexOf(pType)} onChange={(e) => setPType(PEOPLE_TYPES[Number(e.detail.value)])}>
                <View className="em-pick">{pType}</View>
              </Picker>
            </View>
            {addBtn(!text.trim(), () => void submitManual(key))}
          </View>
        );
    }
  }

  return (
    <>
      {/* 遮罩：点空白关闭（= web useDismiss） */}
      <View className="overlay" onTap={onClose} />
      <View className="em-sheet">
        <ScrollView className="em-scroll" scrollY enhanced showScrollbar={false}>
          {/* 移动端拖拽指示条 */}
          <View className="em-grip" />
          <View className="em-head">
            <Text className="em-title">✨ 识别与补充</Text>
            <Text className="em-close" onClick={onClose}>
              ✕
            </Text>
          </View>

          <View className="em-list">
            {SIX.map(({ key, icon, label, hint }) => {
              const applied = domainState(key) === "applied";
              const isManual = manualDomain === key;
              return (
                <View key={key} className={`em-item${isManual ? " em-item-open" : ""}`}>
                  <View className="em-item-row">
                    {/* 点行 = AI 识别该域 */}
                    <View
                      className="em-item-main"
                      hoverClass="press"
                      onClick={() => {
                        if (busyDomain !== key) void runAI(key);
                      }}
                    >
                      <View className={`em-disc${applied ? " em-disc-applied" : ""}`}>
                        <Text>{icon}</Text>
                      </View>
                      <View className="em-item-text">
                        <Text className="em-item-label">{label}</Text>
                        <Text className="em-item-hint">{hint}</Text>
                      </View>
                      {busyDomain === key ? (
                        <Text className="em-busy">识别中…</Text>
                      ) : applied ? (
                        <Text className="em-applied">✓</Text>
                      ) : null}
                    </View>
                    {/* ✏️ = 展开手动表单 */}
                    <Text className={`em-pencil${isManual ? " em-pencil-on" : ""}`} onClick={() => setManualDomain(isManual ? null : key)}>
                      ✏️
                    </Text>
                  </View>
                  {isManual ? <View className="em-manual">{manualForm(key)}</View> : null}
                </View>
              );
            })}
          </View>

          {/* 所属空间：单选归属 / 移除（列表惰性拉取） */}
          <View className="em-space">
            <Text className="em-space-title">所属空间</Text>
            {spaceMenu === null ? (
              <Text className="em-space-load" onClick={() => loadActiveSpaces().then((j) => setSpaceMenu((j.spaces ?? []).filter((s) => s.status === "active"))).catch(() => setSpaceMenu([]))}>
                选择归属…
              </Text>
            ) : (
              <View className="em-space-list">
                {spaceMenu.length === 0 ? <Text className="em-space-empty">还没有进行中的空间</Text> : null}
                {spaceMenu.map((s) => (
                  <View
                    key={s.id}
                    className="em-space-row"
                    onClick={() => {
                      onSetSpace(s.id);
                      onClose();
                    }}
                  >
                    <Text>{s.icon}</Text>
                    <Text className="em-space-name">{s.name}</Text>
                    {m.space?.id === s.id ? <Text className="em-applied">✓</Text> : null}
                  </View>
                ))}
                {m.space ? (
                  <Text
                    className="em-space-remove"
                    onClick={() => {
                      onSetSpace(null);
                      onClose();
                    }}
                  >
                    移除归属
                  </Text>
                ) : null}
              </View>
            )}
          </View>

          <Text className="em-foot">点行 = AI 识别该类 · 点 ✏️ = 手动补充</Text>
        </ScrollView>
      </View>
    </>
  );
}
