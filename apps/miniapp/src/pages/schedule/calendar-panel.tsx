/**
 * 日程页 · 日历子页（= web calendar-panel.tsx 整体平移）：
 * 工具条（‹›翻页 + 渐变标题 + 今天 + 日/周/月/年四视图 pill）+ 当前视图 + AI 复盘卡。
 * 数据：日/周用原始块（/api/blocks/range），月/年用聚合（/api/stats/range）；seq 守卫只让最新请求落地。
 * 块编辑/补录用 overlay+sheet（= web BlockEditor/BlockDraftForm 字段，见 block-sheet.tsx）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import DayDonut from "./day-donut";
import DayTimeline from "./day-timeline";
import MonthView from "./month-view";
import WeekView from "./week-view";
import YearView from "./year-view";
import ReviewCard from "./review-card";
import { BlockDraftSheet, BlockEditSheet, type BlockDraft, type BlockDraftValue } from "./block-sheet";
import {
  createBlock,
  deleteBlock,
  loadActivities,
  loadBlocksRange,
  loadStatsRange,
  patchBlock,
  type Activity,
  type Block,
  type DayStat,
} from "./api";
import { addDays, bjToday, combineHM, parseYmd, startOfMonth, startOfWeek, startOfYear, weekName, ymd, zhDate, zhDuration, zhTime } from "./date";
import { ApiError } from "@/lib/request";

type CalView = "day" | "week" | "month" | "year";
const VIEW_TABS: [CalView, string][] = [
  ["day", "日"],
  ["week", "周"],
  ["month", "月"],
  ["year", "年"],
];

export default function CalendarPanel({ initialAnchor, refreshTick = 0 }: { initialAnchor?: string; refreshTick?: number }) {
  const [view, setView] = useState<CalView>("day");
  const [anchor, setAnchor] = useState<string>(bjToday()); // 北京口径锚定（本地日海外会错 8 小时）
  // ?date= 直达锚定：参数在父层解析出来（晚于本组件首帧），定义后一次性采纳
  const anchoredRef = useRef(false);
  useEffect(() => {
    if (initialAnchor && !anchoredRef.current) {
      anchoredRef.current = true;
      setAnchor(initialAnchor);
    }
  }, [initialAnchor]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]); // 日/周视图原始块
  const [stats, setStats] = useState<Map<string, DayStat>>(new Map()); // 月/年聚合
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<BlockDraft | null>(null);
  const [creating, setCreating] = useState<BlockDraftValue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 保存/删除/补录进行中锁：防连点重复提交（透传给 sheet 禁用按钮）
  const [editSaving, setEditSaving] = useState(false);
  const [editDeleting, setEditDeleting] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);

  useEffect(() => {
    loadActivities()
      .then((j) => setActivities(j.activities ?? []))
      .catch(() => setActivities([]));
  }, []);

  // 区间计算（= web range useMemo）
  const range = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    if (view === "month") {
      const from = startOfMonth(anchor);
      const [y, m] = from.split("-").map(Number);
      return { from, to: ymd(new Date(y, m, 0)) };
    }
    const from = startOfYear(anchor);
    return { from, to: `${from.slice(0, 4)}-12-31` };
  }, [view, anchor]);

  // 加载数据；seq 守卫：锚定快速切换时只让最新请求落地
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErr(null);
    try {
      if (view === "day" || view === "week") {
        const j = await loadBlocksRange(range.from, range.to);
        if (seq !== loadSeq.current) return;
        setBlocks(j.blocks ?? []);
      } else {
        const j = await loadStatsRange(range.from, range.to);
        if (seq !== loadSeq.current) return;
        setStats(new Map((j.days ?? []).map((d: DayStat) => [d.date, d])));
      }
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setErr(e?.message ?? String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [view, range.from, range.to]);
  useEffect(() => {
    void load();
  }, [load]);

  // 页面下拉刷新（index.tsx 广播 refreshTick）：面板常驻挂载（display 切换），按 tick 重拉当前视图
  useEffect(() => {
    if (refreshTick > 0) void load();
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- 日期导航 -----
  function shift(dir: 1 | -1) {
    if (view === "day") setAnchor(addDays(anchor, dir));
    else if (view === "week") setAnchor(addDays(anchor, dir * 7));
    else if (view === "month") {
      const d = parseYmd(anchor);
      d.setDate(1); // 锚定在 29~31 日时 setMonth 会滚到下下月（如 1/31 → 3/3），先钉回 1 号再翻月
      d.setMonth(d.getMonth() + dir);
      setAnchor(ymd(d));
    } else setAnchor(`${Number(anchor.slice(0, 4)) + dir}-06-15`);
  }

  // ----- 日视图编辑/补录（web saveEdit/removeEdit/createBlock 平移） -----
  function startEdit(b: Block) {
    setEditing({ id: b.id, title: b.title, start: zhTime(b.start_at), end: zhTime(b.end_at), activityId: b.activity_id });
  }

  async function saveEdit() {
    if (!editing || editSaving) return;
    if (editing.end <= editing.start) {
      setErr("结束时间必须晚于开始时间");
      return;
    }
    const b = blocks.find((x) => x.id === editing.id);
    if (!b) return;
    setEditSaving(true);
    try {
      await patchBlock(editing.id, {
        title: editing.title.trim() || b.title,
        // 存储口径统一（北京 combineHM）：本地 setHours 在海外设备会存出错 8 小时的时刻
        startAt: combineHM(b.start_at, editing.start),
        endAt: combineHM(b.end_at, editing.end),
        activityId: editing.activityId,
      });
    } catch (e: any) {
      setEditSaving(false);
      setErr(e instanceof ApiError && e.message === "操作失败" ? "保存失败" : e?.message ?? "保存失败");
      return;
    }
    setEditSaving(false);
    setEditing(null);
    await load();
  }

  async function removeEdit() {
    if (!editing || editDeleting) return;
    setEditDeleting(true);
    try {
      await deleteBlock(editing.id);
    } catch (e: any) {
      setEditDeleting(false);
      setErr(e instanceof ApiError && e.message === "操作失败" ? "删除失败" : e?.message ?? "删除失败");
      return;
    }
    setEditDeleting(false);
    setEditing(null);
    await load();
  }

  async function submitCreate() {
    if (!creating || !creating.title.trim() || createBusy) return;
    // 结束必须晚于开始（同编辑校验口径），不合法就地提示并中止
    if (creating.end <= creating.start) {
      setDraftErr("结束时间必须晚于开始时间");
      return;
    }
    setDraftErr(null);
    setCreateBusy(true);
    const [sh, sm] = creating.start.split(":").map(Number);
    const [eh, em] = creating.end.split(":").map(Number);
    const ok = await createBlockPayload({
      title: creating.title.trim(),
      startAt: isoFromMinutes(sh * 60 + sm),
      endAt: isoFromMinutes(eh * 60 + em),
      activityId: creating.activityId,
    });
    setCreateBusy(false);
    if (ok) setCreating(null);
  }

  const dayStartMs = useMemo(() => new Date(`${anchor}T00:00:00+08:00`).getTime(), [anchor]);

  /** 补录槽位分钟 → ISO（基点北京零点） */
  function isoFromMinutes(minutes: number) {
    return new Date(dayStartMs + minutes * 60_000).toISOString();
  }

  async function createBlockPayload(payload: { title: string; startAt: string; endAt: string; activityId: string }) {
    try {
      await createBlock(payload);
    } catch (e: any) {
      // 与 saveEdit 同口径：接口错误就地提示，不外抛
      setErr(e instanceof ApiError && e.message === "操作失败" ? "补录失败" : e?.message === "request:fail" ? "网络异常，请稍后重试" : e?.message ?? "补录失败");
      return false;
    }
    await load();
    return true;
  }

  // ----- 标题与统计 -----
  // 统计口径与月/年视图统一（stats/range 的交集钳制）：跨天块只计落在当天的部分；
  // 基点北京零点（+08:00），本地零点在海外设备会把当天块算偏 8 小时
  const dayEndMs = dayStartMs + 86_400_000;
  const dayClampedMin = (b: { start_at: string; end_at: string }) => {
    const s = new Date(b.start_at).getTime();
    const e = new Date(b.end_at).getTime();
    return Math.max(0, Math.round((Math.min(e, dayEndMs) - Math.max(s, dayStartMs)) / 60_000));
  };
  const dayStat: Record<string, number> = {};
  for (const b of blocks) dayStat[b.activity_id] = (dayStat[b.activity_id] ?? 0) + dayClampedMin(b);
  const weekDays = useMemo(() => {
    const from = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [anchor]);

  const title =
    view === "day"
      ? `${anchor.slice(0, 4)}年${zhDate(anchor)} ${weekName(anchor)}`
      : view === "week"
        ? `${range.from.slice(0, 4)}年${zhDate(range.from)} – ${zhDate(range.to)}`
        : view === "month"
          ? `${anchor.slice(0, 4)}年${Number(anchor.slice(5, 7))}月`
          : `${anchor.slice(0, 4)}年`;

  /** 完整复盘页路由（小程序独有：packages/calendar 完整页） */
  function openFullReview(kind: "day" | "week" | "month" | "year", period: string) {
    Taro.navigateTo({ url: `/packages/calendar/index/index?kind=${kind}&period=${period}` });
  }

  return (
    <View>
      {/* 工具条：glass rounded-2xl px-4 py-3 = web mb-4 flex flex-wrap（窄屏两行） */}
      <View className="cal-bar glass">
        <View className="cal-nav">
          <View className="cal-arrow" onTap={() => shift(-1)}>
            ‹
          </View>
          <Text className="cal-title text-gradient">{title}</Text>
          <View className="cal-arrow" onTap={() => shift(1)}>
            ›
          </View>
          <View className="cal-today" onTap={() => setAnchor(bjToday())}>
            今天
          </View>
        </View>
        {/* 四视图 pill（激活渐变底） */}
        <View className="cal-views">
          {VIEW_TABS.map(([v, label]) => (
            <View
              key={v}
              className={`cal-view-pill ${view === v ? "active" : ""}`}
              onTap={() => setView(v)}
            >
              {label}
            </View>
          ))}
        </View>
      </View>

      {err && (
        <View className="msg-banner msg-banner-err">
          <Text>{err}</Text>
        </View>
      )}
      {loading && (
        <Text className="cal-loading dim">加载中…</Text>
      )}

      {!loading && view === "day" && (
        <View className="cal-day">
          {/* 移动端把当日结构与 AI 小结排在时间轴前（= web order-first） */}
          <View className="cal-aside glass">
            <Text className="cal-aside-title dim-soft">当日结构</Text>
            <DayDonut byActivity={dayStat} activities={activities} size={200} thickness={24} />
            <View className="cal-aside-foot">
              <Text className="hint">
                共 {blocks.length} 段 · {zhDuration(blocks.reduce((s, b) => s + dayClampedMin(b), 0))}
              </Text>
            </View>
            <ReviewCard
              kind="day"
              period={anchor}
              hasRecords={blocks.length > 0}
              notify={setErr}
              variant="inline"
              onOpenFull={() => openFullReview("day", anchor)}
            />
          </View>
          <View className="cal-timeline">
            <DayTimeline
              date={anchor}
              blocks={blocks}
              onEditBlock={startEdit}
              onOpenSlot={(startHm, endHm) => {
                setDraftErr(null);
                setCreating({ title: "", start: startHm, end: endHm, activityId: "other" });
              }}
            />
          </View>
        </View>
      )}
      {!loading && view === "week" && (
        <View>
          <WeekView
            days={weekDays}
            blocks={blocks}
            activities={activities}
            onPickDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
          <ReviewCard kind="week" period={weekDays[0]} subLabel={`${weekDays[0]} – ${weekDays[6]}`} hasRecords={blocks.length > 0} notify={setErr} />
        </View>
      )}
      {!loading && view === "month" && (
        <View>
          <MonthView
            month={startOfMonth(anchor)}
            stats={stats}
            activities={activities}
            onPickDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
          <ReviewCard kind="month" period={anchor.slice(0, 7)} subLabel={`${Number(anchor.slice(5, 7))} 月`} hasRecords={[...stats.values()].length > 0} notify={setErr} />
        </View>
      )}
      {!loading && view === "year" && (
        <View>
          <YearView
            year={anchor.slice(0, 4)}
            stats={stats}
            activities={activities}
            onPickDay={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
          <ReviewCard kind="year" period={anchor.slice(0, 4)} subLabel={`${anchor.slice(0, 4)} 年`} hasRecords={[...stats.values()].length > 0} notify={setErr} />
        </View>
      )}

      {/* 块编辑/补录弹层（overlay+sheet，= web 行内编辑的移动端形态） */}
      {editing && (
        <BlockEditSheet
          draft={editing}
          activities={activities}
          onChange={setEditing}
          onSave={saveEdit}
          onCancel={() => setEditing(null)}
          onDelete={removeEdit}
          saving={editSaving}
          deleting={editDeleting}
        />
      )}
      {creating && (
        <BlockDraftSheet
          value={creating}
          activities={activities}
          busy={createBusy}
          err={draftErr}
          onChange={(v) => {
            setDraftErr(null); // 用户改动即清除校验错误
            setCreating(v);
          }}
          onCancel={() => setCreating(null)}
          onSubmit={submitCreate}
        />
      )}
    </View>
  );
}
