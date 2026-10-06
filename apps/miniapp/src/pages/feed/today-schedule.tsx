/**
 * 今日日程（= web app/home/today-schedule.tsx + day-timeline.tsx + day-donut.tsx 的页面局部实现）：
 * - 头部：段数/总时长 + 今日 kcal chip + 「时间轴 / 列表」pill 切换
 * - 时间轴：环形图（活动时长占比）+ 24h 纵向时间轴（缺口补录 / 点块改 / 当前时刻红线）
 * - 列表：＋ 新增日程（自动找下一个空闲整点槽位）/ 行内编辑 / 两步删除
 * 数据由页面 load() 聚合下发（blocks/activities/todayKcal），提交后经 load 刷新。
 */
import { useEffect, useState } from "react";
import { View, Text, ScrollView, Input, Picker } from "@tarojs/components";
import { createBlock as apiCreateBlock, deleteBlock as apiDeleteBlock, patchBlock as apiPatchBlock, type Activity, type TodayBlock } from "./api";
import { showToast } from "@/components/toast";
import { TagChip } from "./chip";
import LucideIcon from "../../components/lucide-icon";
import { bjClock, bjToday, combineHM, zhDuration } from "./kit";

/** web 0.75px/分钟 → 750 稿 1.5 单位/分钟；一天高 2160，容器高 960（= web 1080px/480px） */
const UNIT_PER_MIN = 1.5;

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
const hmOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** 当前北京时刻的分钟数（UTC+8 推算，禁本地 getter） */
function bjNowMin(): number {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** 表单值：HH:MM 两段 + 活动类别（= web BlockDraftValue） */
interface Draft {
  title: string;
  start: string;
  end: string;
  activityId: string;
}

export default function TodaySchedule({
  blocks,
  activities,
  todayKcal,
  load,
}: {
  blocks: TodayBlock[];
  activities: Activity[];
  todayKcal: number;
  load: () => Promise<void>;
}) {
  const [view, setView] = useState<"timeline" | "list">("timeline");
  // 时间轴自动定位到当前时刻（只在拿到数据后做一次）
  const [autoTop, setAutoTop] = useState<number | null>(null);
  // 缺口补录 / 新增日程的草稿表单
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 行内编辑（列表视图）与删除两步确认
  const [editing, setEditing] = useState<{ id: string; title: string; start: string; end: string; activityId: string } | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);

  const totalMin = blocks.reduce((s, b) => s + (b.duration_min ?? 0), 0);

  useEffect(() => {
    if (autoTop === null && blocks) setAutoTop(Math.max(0, bjNowMin() * UNIT_PER_MIN - 320));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  /** ISO → 当天分钟数（基点北京零点；跨午夜块可为负，钳到 0~1440） */
  const minOfDay = (iso: string) => {
    const m = Math.floor((new Date(iso).getTime() - Date.parse(`${bjToday()}T00:00:00+08:00`)) / 60_000);
    return Math.max(0, Math.min(1440, Number.isFinite(m) ? m : 0));
  };

  /** 合并已记录区间 → 未记录缺口（>2 分钟），供时间轴画虚线补录区（= web gaps useMemo） */
  const gaps = (() => {
    const sorted = blocks.map((b) => ({ s: minOfDay(b.start_at), e: minOfDay(b.end_at) })).sort((a, b) => a.s - b.s);
    const merged: { s: number; e: number }[] = [];
    for (const seg of sorted) {
      const last = merged[merged.length - 1];
      if (last && seg.s <= last.e) last.e = Math.max(last.e, seg.e);
      else merged.push({ ...seg });
    }
    const out: { s: number; e: number }[] = [];
    let cursor = 0;
    for (const seg of merged) {
      if (seg.s - cursor > 2) out.push({ s: cursor, e: Math.min(seg.s, 1440) });
      cursor = Math.max(cursor, seg.e);
    }
    if (1440 - cursor > 2) out.push({ s: cursor, e: 1440 });
    return out;
  })();

  /** 在缺口处打开补录：定位到该时刻所在的 1 小时整点区间（= web openSlotAt） */
  function openSlotAt(absMin: number) {
    const gap = gaps.find((g) => absMin >= g.s && absMin <= g.e);
    if (!gap) return;
    const hourStart = Math.floor(absMin / 60) * 60;
    let s = Math.max(gap.s, hourStart);
    let e = Math.min(gap.e, hourStart + 60);
    if (e - s < 5) {
      s = Math.max(gap.s, gap.e - 60);
      e = gap.e;
    }
    setDraftErr(null);
    setDraft({ title: "", start: hmOf(s), end: hmOf(e), activityId: activities[0]?.id ?? "other" });
  }

  /** 提交补录/新增（POST /api/blocks；409=时间重叠，服务端文案就地展示） */
  async function submitDraft() {
    if (!draft || !draft.title.trim() || saving) return;
    if (draft.end <= draft.start) {
      setDraftErr("结束时间必须晚于开始时间");
      return;
    }
    setSaving(true);
    try {
      const [sh, sm] = draft.start.split(":").map(Number);
      const [eh, em] = draft.end.split(":").map(Number);
      // 北京今天 0 点作基（Date.parse 的 T00:00:00Z 即北京午夜），本地午夜基在海外设备会整体错 8 小时
      const dayMs = Date.parse(`${bjToday()}T00:00:00Z`);
      await apiCreateBlock({
        title: draft.title.trim(),
        startAt: new Date(dayMs + (sh * 60 + sm) * 60_000).toISOString(),
        endAt: new Date(dayMs + (eh * 60 + em) * 60_000).toISOString(),
        activityId: draft.activityId,
      });
      setDraft(null);
      showToast({ type: "ok", text: `✍️ 已补录：${draft.title.trim()}` });
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "补录失败" });
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editing || saving) return;
    if (editing.end <= editing.start) {
      showToast({ type: "err", text: "结束时间必须晚于开始时间" });
      return;
    }
    const b = blocks.find((x) => x.id === editing.id);
    if (!b) return;
    setSaving(true);
    try {
      await apiPatchBlock(editing.id, {
        title: editing.title.trim() || b.title,
        startAt: combineHM(b.start_at, editing.start),
        endAt: combineHM(b.end_at, editing.end),
        activityId: editing.activityId,
      });
      setEditing(null);
      showToast({ type: "ok", text: "💾 日程已更新" });
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "保存失败" });
    } finally {
      setSaving(false);
    }
  }

  async function removeBlock(b: TodayBlock) {
    if (armedId !== b.id) {
      setArmedId(b.id);
      setTimeout(() => setArmedId((cur) => (cur === b.id ? null : cur)), 3000);
      return;
    }
    setArmedId(null);
    try {
      await apiDeleteBlock(b.id);
      showToast({ type: "ok", text: `🗑 已删除「${b.title}」` });
      await load();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "删除失败" });
    }
  }

  /** 从当前小时起找第一个空闲的整点 1 小时槽位（= web nextFreeSlot，「当前」取北京小时） */
  function nextFreeSlot(): Draft {
    const curH = new Date(Date.now() + 8 * 3600_000).getUTCHours();
    const spans = blocks.map((b) => [minOfDay(b.start_at), minOfDay(b.end_at)]);
    for (let h = curH; h < 24; h++) {
      if (!spans.some(([s, e]) => h * 60 < e && (h + 1) * 60 > s)) {
        return { title: "", start: hmOf(h * 60), end: hmOf((h + 1) * 60), activityId: activities[0]?.id ?? "other" };
      }
    }
    return { title: "", start: hmOf(curH * 60), end: hmOf(Math.min(24, curH + 1) * 60), activityId: activities[0]?.id ?? "other" };
  }

  /** 环形图分段：活动分钟占比 → conic-gradient 色标（SVG 不可用时的小程序画法） */
  const donutSegments = (() => {
    const byActivity = blocks.reduce<Record<string, number>>((acc, b) => {
      acc[b.activity_id] = (acc[b.activity_id] ?? 0) + (b.duration_min ?? 0);
      return acc;
    }, {});
    const total = Object.values(byActivity).reduce((s, v) => s + v, 0);
    const actMap = new Map(activities.map((a) => [a.id, a]));
    let cursor = 0;
    return Object.entries(byActivity)
      .filter(([, m]) => m > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, min]) => {
        const frac = total > 0 ? min / total : 0;
        const seg = {
          id,
          min,
          total,
          color: actMap.get(id)?.color ?? "#64748b",
          icon: actMap.get(id)?.icon ?? "📌",
          name: actMap.get(id)?.name ?? "其他",
          from: cursor,
          to: cursor + frac * 100,
        };
        cursor = seg.to;
        return seg;
      });
  })();
  const donutTotal = donutSegments.reduce((s, x) => s + x.min, 0);
  const donutGradient = donutSegments.length
    ? `conic-gradient(${donutSegments.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(", ")})`
    : "none";

  return (
    // = web section.glass.rounded-2xl.p-5
    <View className="ts glass glass-p5">
      <View className="ts-head">
        <View className="ts-head-left">
          <View className="ico-row">
            <LucideIcon name="clock" size={14} color="var(--accent)" />
            <Text className="ts-title">
              今日日程{" "}
              <Text className="ts-sub">
                {blocks.length} 段 · 共 {zhDuration(totalMin)}
              </Text>
            </Text>
          </View>
          {todayKcal > 0 ? <TagChip lucide="utensils" label={`今日 ≈${todayKcal} kcal`} tone="amber" size="sm" /> : null}
        </View>
        {/* 视图切换：pill-nav + pill/pill_active 全局类（= web FilterChip variant=pill 组） */}
        <View className="pill-nav">
          <Text className={`pill${view === "timeline" ? " pill-active" : ""}`} onClick={() => setView("timeline")}>
            时间轴
          </Text>
          <Text className={`pill${view === "list" ? " pill-active" : ""}`} onClick={() => setView("list")}>
            列表
          </Text>
        </View>
      </View>

      {view === "timeline" ? (
        <View>
          {/* 环形图 + 图例（= web DayDonut：SVG 环在小程序用 conic-gradient 承载，图例同构） */}
          <View className="ts-donut-box">
            <View className="ts-donut">
              <View className="ts-donut-ring" style={{ background: donutGradient }}>
                <View className="ts-donut-hole" />
              </View>
              <View className="ts-legend">
                {donutTotal === 0 ? <Text className="ts-legend-empty">暂无记录</Text> : null}
                {donutSegments.slice(0, 5).map((s) => (
                  <View key={s.id} className="ts-legend-row">
                    <View className="ts-legend-dot" style={{ backgroundColor: s.color }} />
                    <Text className="ts-legend-name">
                      {s.icon} {s.name}
                    </Text>
                    <Text className="ts-legend-pct">{Math.round((s.min / donutTotal) * 100)}%</Text>
                  </View>
                ))}
                {donutSegments.length > 5 ? <Text className="ts-legend-more">等 {donutSegments.length - 5} 类未展示</Text> : null}
              </View>
            </View>
          </View>

          {/* 24h 时间轴：小时刻度 + 缺口补录区 + 日程块 + 当前时刻红线 */}
          <ScrollView className="ts-axis" scrollY scrollTop={autoTop ?? 0} enhanced showScrollbar={false}>
            <View className="ts-axis-inner" style={{ height: `${1440 * UNIT_PER_MIN}px` }}>
              {Array.from({ length: 25 }, (_, h) => (
                <View key={h} className="ts-hour" style={{ top: `${h * 60 * UNIT_PER_MIN}px` }}>
                  {h % 3 === 0 ? <Text className="ts-hour-label">{h}点</Text> : null}
                </View>
              ))}

              {/* 缺口：点击按整点定位 1 小时补录 */}
              {gaps.map((g, i) => (
                <View
                  key={`gap-${i}`}
                  className="ts-gap"
                  style={{ top: `${g.s * UNIT_PER_MIN}px`, height: `${Math.max((g.e - g.s) * UNIT_PER_MIN - 4, 16)}px` }}
                  onClick={() => openSlotAt(g.s)}
                >
                  {(g.e - g.s) * UNIT_PER_MIN >= 44 ? (
                    <Text className="ts-gap-label">
                      ✦ 未记录 {hmOf(g.s)}–{hmOf(g.e)}（{(g.e - g.s) >= 60 ? `${Math.floor((g.e - g.s) / 60)}小时${(g.e - g.s) % 60 || ""}` : `${g.e - g.s}分钟`}）
                    </Text>
                  ) : null}
                </View>
              ))}

              {/* 日程块：点击切列表视图并打开编辑器 */}
              {blocks.map((b) => {
                const s = minOfDay(b.start_at);
                const e = Math.max(minOfDay(b.end_at), s + 2);
                const h = (e - s) * UNIT_PER_MIN;
                return (
                  <View
                    key={b.id}
                    className="ts-block"
                    style={{
                      top: `${s * UNIT_PER_MIN}px`,
                      height: `${Math.max(h - 4, 12)}px`,
                      backgroundColor: `${b.color}40`,
                      borderColor: b.color,
                    }}
                    onClick={() => {
                      setView("list");
                      setEditing({ id: b.id, title: b.title, start: bjClock(b.start_at), end: bjClock(b.end_at), activityId: b.activity_id });
                    }}
                  >
                    {h >= 36 ? (
                      <View className="ts-block-row">
                        <Text>{b.icon}</Text>
                        <Text className="ts-block-title">{b.title}</Text>
                        <Text className="ts-block-time">
                          {hmOf(s)}–{hmOf(e)}
                        </Text>
                      </View>
                    ) : h >= 18 ? (
                      <Text className="ts-block-icon">{b.icon}</Text>
                    ) : null}
                  </View>
                );
              })}

              {/* 当前时刻红线 */}
              <View className="ts-now" style={{ top: `${bjNowMin() * UNIT_PER_MIN}px` }}>
                <Text className="ts-now-label">{hmOf(bjNowMin())}</Text>
              </View>
            </View>
          </ScrollView>
          <Text className="ts-axis-hint">提示：点击彩色块可修改 · 点击虚线缺口补录 · 红线为当前时刻</Text>
        </View>
      ) : (
        <>
          {/* ＋ 新增日程（自动找空闲整点槽位） */}
          <View className="ts-list-tools">
            <Text
              className="ts-add"
              onClick={() => {
                setDraftErr(null);
                setDraft(nextFreeSlot());
              }}
            >
              ＋ 新增日程
            </Text>
          </View>
          {blocks.length === 0 ? (
            <Text className="ts-empty">还没有记录 —— 说句"刚做完…"，点「＋ 新增日程」，或去完成一个 todo</Text>
          ) : null}

          {/* 列表行 / 行内编辑（= web 列表视图） */}
          <View className="ts-list">
            {blocks.map((b) =>
              editing?.id === b.id ? (
                <View key={b.id} className="ts-edit-box">
                  <Input className="at-edit-input" value={editing.title} placeholder="标题" onInput={(e) => setEditing({ ...editing, title: e.detail.value })} />
                  <View className="ts-edit-row">
                    <Picker mode="time" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.detail.value })}>
                      <View className="at-edit-pick">{editing.start}</View>
                    </Picker>
                    <Text className="ts-draft-sep">至</Text>
                    <Picker mode="time" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.detail.value })}>
                      <View className="at-edit-pick">{editing.end}</View>
                    </Picker>
                    <Picker
                      mode="selector"
                      range={activities.map((a) => `${a.icon} ${a.name}`)}
                      value={Math.max(0, activities.findIndex((a) => a.id === editing.activityId))}
                      onChange={(e) => setEditing({ ...editing, activityId: activities[Number(e.detail.value)]?.id ?? editing.activityId })}
                    >
                      <View className="at-edit-pick">{activities.find((a) => a.id === editing.activityId)?.name ?? "类别"}</View>
                    </Picker>
                  </View>
                  <View className="ts-draft-actions">
                    <Text className="at-edit-cancel" onClick={() => setEditing(null)}>
                      取消
                    </Text>
                      <Text className="at-edit-save" onClick={() => void saveEdit()}>
                        {saving ? "保存中…" : "保存"}
                      </Text>
                  </View>
                </View>
              ) : (
                <View key={b.id} className="ts-row">
                  <View className="ts-row-dot" style={{ backgroundColor: b.color }} />
                  <Text className="ts-row-time">
                    {bjClock(b.start_at)}–{bjClock(b.end_at)}
                  </Text>
                  <Text className="ts-row-icon">{b.icon}</Text>
                  <Text className="ts-row-title">{b.title}</Text>
                  <Text className="ts-row-dur">{b.duration_min} 分钟</Text>
                  <View className="row-actions">
                    <View
                      className="row-action-btn"
                      onClick={() => setEditing({ id: b.id, title: b.title, start: bjClock(b.start_at), end: bjClock(b.end_at), activityId: b.activity_id })}
                    >
                      <LucideIcon name="pencil" size={11} color="var(--accent)" />
                    </View>
                    <View className={`row-action-btn${armedId === b.id ? " row-action-armed" : ""}`} onClick={() => void removeBlock(b)}>
                      {armedId === b.id ? "确认删除?" : <LucideIcon name="trash_2" size={11} color="var(--danger)" />}
                    </View>
                  </View>
                </View>
              ),
            )}
          </View>
        </>
      )}

      {/* 补录/新增表单（两视图共用，= web BlockDraftForm；列表头显示「新增」、缺口入口显示「补录」） */}
      {draft ? (
        <View className="ts-draft">
          <View className="ts-draft-row">
            <Text className="ts-draft-label">
              {view === "timeline" ? "补录" : "新增"} {draft.start}–{draft.end}
            </Text>
            <Input className="ts-draft-input" value={draft.title} placeholder="这段时间在做什么？" onInput={(e) => setDraft({ ...draft, title: e.detail.value })} />
          </View>
          <View className="ts-draft-row">
            <Picker mode="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.detail.value })}>
              <View className="at-edit-pick">{draft.start}</View>
            </Picker>
            <Text className="ts-draft-sep">至</Text>
            <Picker mode="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.detail.value })}>
              <View className="at-edit-pick">{draft.end}</View>
            </Picker>
            <Picker
              mode="selector"
              range={activities.map((a) => `${a.icon} ${a.name}`)}
              value={Math.max(0, activities.findIndex((a) => a.id === draft.activityId))}
              onChange={(e) => setDraft({ ...draft, activityId: activities[Number(e.detail.value)]?.id ?? draft.activityId })}
            >
              <View className="at-edit-pick">{activities.find((a) => a.id === draft.activityId)?.name ?? "类别"}</View>
            </Picker>
          </View>
          <View className="ts-draft-actions">
            <Text className="at-edit-cancel" onClick={() => setDraft(null)}>
              取消
            </Text>
              <Text className="at-edit-save" onClick={() => void submitDraft()}>
                {saving ? "保存中…" : view === "timeline" ? "补录" : "保存"}
              </Text>
          </View>
          {draftErr ? <Text className="ts-draft-err">{draftErr}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}
