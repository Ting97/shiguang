/**
 * 单条动态卡（= web components/moment-feed/moment-card.tsx 及其子组件的页面局部实现）：
 * 结构层级逐一对应 web——
 *   article.glass(头像位 + 右列) → CardHeader(意图 chip + 空间徽标 + 语音/离线 chip + 两步删除)
 *   → RawTextSection(原文，点按弹「识别与补充」菜单；长文折叠) → ImageGrid(九宫格，点击全屏预览)
 *   → 识别中/超时降级 → 日程冲突降级条 → MoodBlock(可改可删) → RecognitionSection(日程/todo/金额/人物/饮食，
 *   行内两步删除 + 行内编辑) → PendingConfirms(低置信待确认) → 交互提示 → 卡内操作反馈。
 *
 * 字段契约核对自 apps/api listFeed SQL：transactions[].amountCents(camelCase)、todos[].status==="done"、
 * people[] 聚合自 interactions、images[] 是 {storageKey}、recognitions[domain].status==="pending" 即待确认。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Image, Textarea, Input, Picker } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { deleteEntry } from "@/lib/api";
import { showToast } from "@/components/toast";
import {
  confirmEntry,
  deleteBlock,
  deleteDiet,
  deleteInteraction,
  deleteTodo,
  deleteTransaction,
  dismissConflict,
  fileUrl,
  patchBlock,
  patchFeedEntry,
  patchTodo,
  patchTransaction,
  recognizeEntryDomain,
  manualAddEntry,
  type Activity,
  type FeedBlock,
  type FeedMomentFull,
  type FeedTodo,
  type FeedTx,
} from "./api";
import { TagChip, type Tone } from "./chip";
import LucideIcon, { type LucideIconName } from "../../components/lucide-icon";
import EntryMenu from "./entry-menu";
import { bjClock, bjDateKey, bjInputToIso, combineHM, dayPrefix, DOMAIN_LABELS, COMMON_MOODS, isoToBjInput, moodEmoji, moodToneColor, todoTimeLabel, TX_CATEGORIES, yuanCents } from "./kit";
import "./moment-card.scss";

/** 行内小操作按钮（= web row-action.tsx）：删除两步确认（armed 时按钮变「确认删除?」，3 秒超时复位） */
function RowAction(props: { onEdit?: () => void; onDelete?: () => void; armed: boolean }) {
  const { onEdit, onDelete, armed } = props;
  return (
    <View className="row-actions">
      {onEdit ? (
        <View className="row-action-btn row-action-edit" onClick={onEdit}>
          <LucideIcon name="pencil" size={11} color="var(--accent)" />
        </View>
      ) : null}
      {onDelete ? (
        <View className={`row-action-btn${armed ? " row-action-armed" : ""}`} onClick={onDelete}>
          {armed ? (
            "确认删除?"
          ) : (
            <LucideIcon name="trash_2" size={11} color="var(--danger)" />
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function MomentCard({
  m,
  activities,
  onRefresh,
}: {
  m: FeedMomentFull;
  activities: Activity[];
  /** 卡内任何提交成功后整页刷新（= web onRefresh） */
  onRefresh: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  // 原文行内编辑：null=非编辑态；字符串=textarea 当前内容（= web editRaw）
  const [editRaw, setEditRaw] = useState<string | null>(null);
  // 「识别与补充」底部菜单（= web EntryMenu 移动端形态）
  const [menuOpen, setMenuOpen] = useState(false);
  // 长文折叠（= web textExpanded，>150 字默认收起 6 行）
  const [textExpanded, setTextExpanded] = useState(false);
  // 心情选择器开关（= web moodPicker）
  const [moodPicker, setMoodPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const blocks = m.blocks ?? [];
  const todos = m.todos ?? [];
  const txs = m.transactions ?? [];
  const people = m.people ?? [];
  const images = m.images ?? [];
  const recs = m.recognitions ?? {};

  /** 头部意图标签：todo > 日程 > 心情 > 动态（= web intent 推导） */
  const intent: { icon: LucideIconName; label: string; tone: Tone } = todos.length > 0
    ? { icon: "list_todo", label: "todo", tone: "sky" }
    : blocks.length > 0
      ? { icon: "clock", label: "日程", tone: "sky" }
      : m.mood
        ? { icon: "sparkles", label: "心情", tone: "violet" }
        : { icon: "notebook_pen", label: "动态", tone: "slate" };

  const isLongText = (m.raw_text ?? "").length > 150;

  /* ---- 卡内操作统一执行器（= web use-card-actions） ---- */

  // 操作反馈统一走全局 toast（= web use-card-actions：卡片可能滚出视口，就地横幅反而看不见）
  const run = async (fn: () => Promise<string>) => {
    try {
      showToast({ type: "ok", text: await fn() });
      onRefresh();
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "操作失败" });
    }
  };

  // 延迟刷新定时器：卸载时清理（= web refreshTimers；识别在后台进行，延迟两轮把新产物带上墙）
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      refreshTimers.current.forEach(clearTimeout);
      refreshTimers.current = [];
    },
    [],
  );
  const scheduleDelayedRefresh = () => {
    refreshTimers.current.forEach(clearTimeout);
    refreshTimers.current = [setTimeout(onRefresh, 6000), setTimeout(onRefresh, 14000)];
  };

  // 两步删除的待确认 key（3 秒超时自动复位）
  const [delArmed, setDelArmed] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );
  const del = (key: string, fn: () => Promise<unknown>) => {
    if (delArmed === key) {
      setDelArmed(null);
      void run(async () => {
        await fn();
        return "🗑 已删除";
      });
      return;
    }
    setDelArmed(key);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setDelArmed(null), 3000);
  };

  /** 菜单里点某域：AI 识别该域（busyDomain 由 EntryMenu 自管） */
  const recognizeDomain = (domain: string) =>
    run(async () => {
      const j = await recognizeEntryDomain(m.id, domain);
      return j.message ?? "已重新识别";
    });

  /** 菜单里手动添加某域产物；返回 false=失败（已就地提示，菜单保表单） */
  const manualAdd = async (domain: string, payload: Record<string, unknown>) => {
    try {
      const j = await manualAddEntry(m.id, domain, payload);
      showToast({ type: "ok", text: j.message ?? "已添加" });
      onRefresh();
      return true;
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "添加失败" });
      return false;
    }
  };

  /** 归属 / 移除空间（= web EntryMenu onSetSpace） */
  const setSpace = (spaceId: string | null) =>
    run(async () => {
      await patchFeedEntry(m.id, { spaceId });
      return spaceId ? "🎯 已归属空间" : "已移除空间归属";
    });

  /** 保存原文：后端清旧产物全域重识别（秒回），延迟刷新呈现新识别结果（= web saveRaw） */
  const saveRaw = () =>
    run(async () => {
      const text = (editRaw ?? "").trim();
      if (!text) throw new Error("内容不能为空");
      await patchFeedEntry(m.id, { raw_text: text });
      setEditRaw(null);
      scheduleDelayedRefresh();
      return "✏️ 已保存，AI 正在重新识别全部信息…";
    });

  /** 整条删除（防双击双发 DELETE，第二次会 404）；成功后由 run 里的 onRefresh 重载列表摘除本卡 */
  const confirmDelete = () => {
    if (deleting) return;
    setDeleting(true);
    void run(async () => {
      await deleteEntry(m.id);
      return "🗑 已删除这条动态及其识别结果";
    })
      .then(() => setConfirming(false))
      .finally(() => setDeleting(false));
  };

  /** 「⋯」操作入口：小程序无 hover 态、也不能用 portal 浮层，等价交互用原生 ActionSheet 承载
   *  （web 桌面是锚定浮层；移动端 web 该钮隐藏，这里保留是因为小程序版需要编辑/删除入口） */
  const openActions = () => {
    Taro.showActionSheet({ itemList: ["✏️ 编辑原文", "🗑 删除这条动态"] })
      .then((r) => {
        if (r.tapIndex === 0) {
          setEditRaw(m.raw_text);
          setMenuOpen(false);
        } else if (r.tapIndex === 1) {
          setConfirming(true);
        }
      })
      .catch(() => {
        /* 用户取消 actionSheet：静默 */
      });
  };

  /** 日程冲突降级条：识别时发现时间重叠未登记时间轴；「去调整」跳日程页（web 跳 /schedule?date=） */
  const scheduleRec = recs.schedule;
  const showConflict =
    !!m.analyzed_at &&
    scheduleRec?.status === "none" &&
    !scheduleRec.reasonDismissed &&
    (!!scheduleRec.reason?.includes("已有日程") || !!scheduleRec.reason?.includes("时间冲突"));

  /* ---- 识别产物行内编辑态 ---- */
  const [editBlock, setEditBlock] = useState<{ id: string; title: string; start: string; end: string; activityId: string } | null>(null);
  const [editTodo, setEditTodo] = useState<{ id: string; title: string; startDate: string; startTime: string; dueDate: string; dueTime: string; activityId: string } | null>(null);
  const [editTx, setEditTx] = useState<{ id: string; direction: string; amount: string; category: string; counterparty: string } | null>(null);

  /** 北京墙上串 "YYYY-MM-DDTHH:mm" → 日期/时间两段（微信 Picker 无 datetime-local，拆两个 Picker 承载） */
  const splitBjInput = (v: string) => ({ date: v.slice(0, 10), time: v.slice(11, 16) });

  return (
    // = web article.glass.flex.gap-3.rounded-2xl.p-4
    <View className="mc glass glass-p4">
      {/* 头像位：心情 emoji（无心情时用意图图标），bg-elevated 圆底 */}
      <View className="mc-avatar">
        <Text>{m.mood ? moodEmoji(m.mood) : intent.icon}</Text>
      </View>

      <View className="mc-main">
        {/* = web CardHeader：意图标签 + 空间徽标 + 语音/离线标记 + 两步删除 */}
        <View className="mc-head">
          <TagChip lucide={intent.icon} label={intent.label} tone={intent.tone} size="sm" maxWidth />
          {m.space ? (
            <View
              className="mc-space-badge"
              style={{ backgroundColor: `${m.space.color}26` /* web 同款 color+26 十六进制透明度 */ }}
              onClick={() => Taro.redirectTo({ url: "/packages/space/detail/index?id=" + m.space!.id })}
            >
              <Text className="mc-space-icon">{m.space.icon}</Text>
              <Text className="mc-space-name">{m.space.name}</Text>
            </View>
          ) : null}
          {m.source === "voice" ? <TagChip lucide="mic" label="语音" tone="slate" size="sm" /> : null}
          {Object.values(recs).some((v) => v?.engine === "rules") ? (
            <TagChip lucide="triangle_alert" label="离线识别" tone="amber" size="sm" />
          ) : null}
          <View className="mc-head-spacer" />
          {confirming ? (
            <View className="mc-confirm-del">
              <Text className="mc-confirm-del-btn" onClick={confirmDelete}>
                {deleting ? "删除中…" : "确认删除"}
              </Text>
              <Text className="mc-confirm-del-cancel" onClick={() => setConfirming(false)}>
                取消
              </Text>
            </View>
          ) : (
            editRaw === null && (
              <Text className="mc-more" onClick={openActions}>
                ⋯
              </Text>
            )
          )}
        </View>

        {/* = web RawTextSection：编辑态 textarea；否则点原文弹「识别与补充」菜单 */}
        {editRaw !== null ? (
          <View className="mc-raw-edit">
            <Textarea
              className="mc-raw-textarea"
              value={editRaw}
              maxlength={2000}
              autoHeight
              onInput={(e) => setEditRaw(e.detail.value)}
            />
            <View className="mc-raw-edit-row">
              <Text className="mc-raw-save" onClick={saveRaw}>
                保存并重新识别
              </Text>
              <Text className="mc-raw-cancel" onClick={() => setEditRaw(null)}>
                取消
              </Text>
            </View>
          </View>
        ) : (
          <Text
            className={`mc-raw${isLongText && !textExpanded ? " mc-raw-clamp" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {m.raw_text}
          </Text>
        )}
        {editRaw === null && isLongText ? (
          <Text className="mc-raw-toggle" onClick={() => setTextExpanded((v) => !v)}>
            {textExpanded ? "收起" : `展开全文（${m.raw_text.length} 字）`}
          </Text>
        ) : null}

        {/* = web ImageGrid：1 张大图 / 2-3 张横排 / 4-9 张三列；点击全屏预览（微信原生 previewImage） */}
        {images.length > 0 && editRaw === null ? (
          <View className={`mc-grid mc-grid-${images.length === 1 ? "one" : images.length <= 3 ? "few" : "many"}`}>
            {images.map((img, i) => (
              <View
                key={img.id ?? i}
                className="mc-grid-cell"
                onClick={() => Taro.previewImage({ urls: images.map((g) => fileUrl(g.storageKey)), current: fileUrl(images[i].storageKey) })}
              >
                <Image className="mc-grid-img" src={fileUrl(img.storageKey)} mode="aspectFill" lazyLoad />
              </View>
            ))}
          </View>
        ) : null}

        {/* 后台识别中 / 识别超时：动态已上墙，产物随后出现；超 10 分钟显示失败态不再转圈 */}
        {!m.analyzed_at &&
          (m.recognize_state === "timeout" ? (
            <View className="mc-recog-state">
              <TagChip lucide="sparkles" label="识别未完成" tone="slate" size="sm" />
              <Text className="mc-recog-state-text">AI 当时未返回结果 · 点击原文可重新识别</Text>
            </View>
          ) : (
            <View className="mc-recog-state mc-recog-state-live">
              <TagChip lucide="sparkles" label="AI 识别中" tone="violet" size="sm" />
              <Text className="mc-recog-state-text">正在提取 日程 / 关系 / todo / 收支 / 心情 / 饮食…</Text>
            </View>
          ))}

        {/* 日程冲突降级条（= web amber 警示条）：去调整 + 就地关闭 */}
        {showConflict ? (
          <View className="mc-conflict">
            <View className="mc-conflict-text ico-row">
              <LucideIcon name="triangle_alert" size={12} color="var(--warn)" />
              <Text>未生成日程：{scheduleRec?.reason}</Text>
            </View>
            <Text
              className="mc-conflict-go"
              onClick={() => Taro.redirectTo({ url: `/pages/schedule/index?date=${bjDateKey(m.created_at)}` })}
            >
              去调整 →
            </Text>
            <View className="mc-conflict-x" onClick={() => run(async () => { await dismissConflict(m.id); return "已关闭，不再提示"; })}>
              <LucideIcon name="x" size={12} color="var(--ink-dim)" />
            </View>
          </View>
        ) : null}

        {/* = web MoodBlock：可改可删（无心情且未打开选择器时整体不渲染） */}
        {m.mood || moodPicker ? (
          <View className="mc-mood-wrap">
            {moodPicker ? (
              <View className="mc-mood-picker">
                {COMMON_MOODS.map((w) => (
                  <Text
                    key={w}
                    className={`mc-mood-pill${m.mood === w ? " mc-mood-pill-on" : ""}`}
                    onClick={() =>
                      run(async () => {
                        await patchFeedEntry(m.id, { mood: w });
                        return `${moodEmoji(w)} 心情已改为「${w}」`;
                      }).then(() => setMoodPicker(false))
                    }
                  >
                    {moodEmoji(w)} {w}
                  </Text>
                ))}
                <Text
                  className="mc-mood-pill mc-mood-clear"
                  onClick={() =>
                    run(async () => {
                      await patchFeedEntry(m.id, { mood: null });
                      return "已清除心情";
                    }).then(() => setMoodPicker(false))
                  }
                >
                  清除
                </Text>
                <Text className="mc-mood-cancel" onClick={() => setMoodPicker(false)}>
                  取消
                </Text>
              </View>
            ) : (
              <View className="mc-mood-line" style={{ color: moodToneColor(m.mood_score) }}>
                <Text>
                  {moodEmoji(m.mood)} 此刻心情：{m.mood}
                </Text>
                <Text className="mc-mood-edit" onClick={() => setMoodPicker(true)}>
                  改
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {/* = web RecognitionSection：有任一产物才渲染 */}
        {blocks.length > 0 || todos.length > 0 || txs.length > 0 || people.length > 0 || m.diet ? (
          <View className="mc-recog">
            {/* ---- 日程块（= web BlockRows） ---- */}
            {blocks.map((b: FeedBlock) =>
              editBlock?.id === b.id ? (
                <View key={b.id} className="mc-edit-box">
                  <Input className="mc-edit-input" value={editBlock.title} placeholder="标题" onInput={(e) => setEditBlock({ ...editBlock, title: e.detail.value })} />
                  <View className="mc-edit-row">
                    <Picker mode="time" value={editBlock.start} onChange={(e) => setEditBlock({ ...editBlock, start: e.detail.value })}>
                      <View className="mc-edit-pick">{editBlock.start || "开始"}</View>
                    </Picker>
                    <Text className="mc-edit-sep">至</Text>
                    <Picker mode="time" value={editBlock.end} onChange={(e) => setEditBlock({ ...editBlock, end: e.detail.value })}>
                      <View className="mc-edit-pick">{editBlock.end || "结束"}</View>
                    </Picker>
                    <Picker
                      mode="selector"
                      range={activities.map((a) => `${a.icon} ${a.name}`)}
                      value={Math.max(0, activities.findIndex((a) => a.id === editBlock.activityId))}
                      onChange={(e) => setEditBlock({ ...editBlock, activityId: activities[Number(e.detail.value)]?.id ?? "" })}
                    >
                      <View className="mc-edit-pick">
                        {activities.find((a) => a.id === editBlock.activityId)?.name ?? "类别"}
                      </View>
                    </Picker>
                  </View>
                  <View className="mc-edit-actions">
                    <Text className="mc-edit-cancel" onClick={() => setEditBlock(null)}>
                      取消
                    </Text>
                    <Text
                      className="mc-edit-save"
                      onClick={() =>
                        run(async () => {
                          if (editBlock.end <= editBlock.start) throw new Error("结束时间必须晚于开始时间");
                          // startAt 兜底当前时刻：极端脏数据缺起始时间时 combineHM 需要一个合法日期基点
                          await patchBlock(b.id, {
                            title: editBlock.title.trim() || b.title,
                            startAt: combineHM(b.startAt ?? new Date().toISOString(), editBlock.start),
                            endAt: combineHM(b.endAt ?? b.startAt ?? new Date().toISOString(), editBlock.end),
                            activityId: editBlock.activityId,
                          });
                          setEditBlock(null);
                          return "💾 日程已更新";
                        })
                      }
                    >
                      保存
                    </Text>
                  </View>
                </View>
              ) : (
                <View key={b.id} className="mc-row">
                  <View className="mc-dot" style={{ backgroundColor: b.color ?? "var(--ink-mute)" }} />
                  <Text className="mc-row-main">
                    {b.icon} {b.activityName} · {b.title}
                  </Text>
                  <Text className="mc-row-time">
                    {b.startAt ? `${dayPrefix(String(b.startAt))}${bjClock(String(b.startAt))}–${bjClock(String(b.endAt ?? b.startAt))} · ${b.durationMin ?? ""} 分钟` : ""}
                  </Text>
                  <RowAction
                    armed={delArmed === `block:${b.id}`}
                    onEdit={() =>
                      setEditBlock({
                        id: b.id,
                        title: b.title,
                        start: b.startAt ? bjClock(String(b.startAt)) : "",
                        end: b.endAt ? bjClock(String(b.endAt)) : "",
                        activityId: activities.some((a) => a.id === b.activityId) ? String(b.activityId) : activities[0]?.id ?? "",
                      })
                    }
                    onDelete={() => del(`block:${b.id}`, () => deleteBlock(b.id))}
                  />
                </View>
              ),
            )}

            {/* ---- todo（= web TodoRows） ---- */}
            {todos.map((td: FeedTodo) =>
              editTodo?.id === td.id ? (
                <View key={td.id} className="mc-edit-box">
                  <Input className="mc-edit-input" value={editTodo.title} placeholder="标题" onInput={(e) => setEditTodo({ ...editTodo, title: e.detail.value })} />
                  <View className="mc-edit-row">
                    <Picker mode="date" value={editTodo.startDate ?? ""} onChange={(e) => setEditTodo({ ...editTodo, startDate: e.detail.value })}>
                      <View className="mc-edit-pick">{editTodo.startDate || "开始日期"}</View>
                    </Picker>
                    <Picker mode="time" value={editTodo.startTime} onChange={(e) => setEditTodo({ ...editTodo, startTime: e.detail.value })}>
                      <View className="mc-edit-pick">{editTodo.startTime || "时间"}</View>
                    </Picker>
                  </View>
                  <View className="mc-edit-row">
                    <Picker mode="date" value={editTodo.dueDate ?? ""} onChange={(e) => setEditTodo({ ...editTodo, dueDate: e.detail.value })}>
                      <View className="mc-edit-pick">{editTodo.dueDate || "到期日期"}</View>
                    </Picker>
                    <Picker mode="time" value={editTodo.dueTime} onChange={(e) => setEditTodo({ ...editTodo, dueTime: e.detail.value })}>
                      <View className="mc-edit-pick">{editTodo.dueTime || "时间"}</View>
                    </Picker>
                    <Picker
                      mode="selector"
                      range={activities.map((a) => `${a.icon} ${a.name}`)}
                      value={Math.max(0, activities.findIndex((a) => a.id === editTodo.activityId))}
                      onChange={(e) => setEditTodo({ ...editTodo, activityId: activities[Number(e.detail.value)]?.id ?? "" })}
                    >
                      <View className="mc-edit-pick">
                        {activities.find((a) => a.id === editTodo.activityId)?.name ?? "类别"}
                      </View>
                    </Picker>
                  </View>
                  <View className="mc-edit-actions">
                    <Text className="mc-edit-cancel" onClick={() => setEditTodo(null)}>
                      取消
                    </Text>
                    <Text
                      className="mc-edit-save"
                      onClick={() =>
                        run(async () => {
                          if (!editTodo.title.trim()) throw new Error("标题不能为空");
                          await patchTodo(td.id, {
                            title: editTodo.title.trim(),
                            startAt: bjInputToIso(`${editTodo.startDate}T${editTodo.startTime}`),
                            dueAt: bjInputToIso(`${editTodo.dueDate}T${editTodo.dueTime}`),
                            activityId: editTodo.activityId,
                          });
                          setEditTodo(null);
                          return "💾 todo 已更新";
                        })
                      }
                    >
                      保存
                    </Text>
                  </View>
                </View>
              ) : (
                <View key={td.id} className="mc-row">
                  <TagChip lucide="list_todo" label="todo" tone="sky" size="sm" />
                  <Text className="mc-row-main">{td.title}</Text>
                  <Text className="mc-row-time">{todoTimeLabel(td.startAt, td.dueAt) ?? "未定时间"}</Text>
                  {td.status === "done" ? <Text className="mc-row-done">已完成</Text> : null}
                  <RowAction
                    armed={delArmed === `todo:${td.id}`}
                    onEdit={() => {
                      // ISO → 北京墙上串再拆日期/时间两段（微信 Picker 无 datetime-local，用 date+time 双 Picker 承载）
                      const s = splitBjInput(isoToBjInput(td.startAt));
                      const d = splitBjInput(isoToBjInput(td.dueAt));
                      setEditTodo({
                        id: td.id,
                        title: td.title,
                        startDate: s.date,
                        startTime: s.time,
                        dueDate: d.date,
                        dueTime: d.time,
                        activityId: activities.some((a) => a.id === td.activityId) ? String(td.activityId) : activities[0]?.id ?? "",
                      });
                    }}
                    onDelete={() => del(`todo:${td.id}`, () => deleteTodo(td.id))}
                  />
                </View>
              ),
            )}

            {/* ---- 金额流水（= web TxRows；amountCents 可能是 string，比较前 Number()） ---- */}
            {txs.map((x: FeedTx) =>
              editTx?.id === x.id ? (
                <View key={x.id} className="mc-edit-box">
                  <View className="mc-edit-row">
                    <Picker
                      mode="selector"
                      range={["支出", "收入"]}
                      value={editTx.direction === "in" ? 1 : 0}
                      onChange={(e) => setEditTx({ ...editTx, direction: Number(e.detail.value) === 1 ? "in" : "out" })}
                    >
                      <View className="mc-edit-pick">{editTx.direction === "in" ? "收入" : "支出"}</View>
                    </Picker>
                    <Picker
                      mode="selector"
                      range={TX_CATEGORIES}
                      value={Math.max(0, TX_CATEGORIES.indexOf(editTx.category))}
                      onChange={(e) => setEditTx({ ...editTx, category: TX_CATEGORIES[Number(e.detail.value)] })}
                    >
                      <View className="mc-edit-pick">{editTx.category || "类别"}</View>
                    </Picker>
                  </View>
                  <View className="mc-edit-row">
                    <Input className="mc-edit-input mc-edit-amount" type="digit" value={editTx.amount} placeholder="金额(元)" onInput={(e) => setEditTx({ ...editTx, amount: e.detail.value })} />
                    <Input className="mc-edit-input" value={editTx.counterparty} placeholder="对方(可空)" onInput={(e) => setEditTx({ ...editTx, counterparty: e.detail.value })} />
                  </View>
                  <View className="mc-edit-actions">
                    <Text className="mc-edit-cancel" onClick={() => setEditTx(null)}>
                      取消
                    </Text>
                    <Text
                      className="mc-edit-save"
                      onClick={() =>
                        run(async () => {
                          const cents = Math.round(parseFloat(editTx.amount) * 100);
                          if (!Number.isFinite(cents) || cents <= 0) throw new Error("金额必须大于 0");
                          await patchTransaction(x.id, {
                            direction: editTx.direction,
                            amountCents: cents,
                            category: editTx.category,
                            counterparty: editTx.counterparty,
                          });
                          setEditTx(null);
                          return "💾 金额已更新";
                        })
                      }
                    >
                      保存
                    </Text>
                  </View>
                </View>
              ) : (
                <View key={x.id} className="mc-row">
                  <TagChip
                    lucide="coins"
                    label={`${x.direction === "out" ? "支出" : "收入"} ${yuanCents(x.amountCents)}`}
                    tone={x.direction === "out" ? "rose" : "emerald"}
                    size="sm"
                  />
                  <Text className="mc-row-main">
                    {x.category}
                    {x.counterparty ? ` · 对方：${x.counterparty}` : ""}
                  </Text>
                  <RowAction
                    armed={delArmed === `tx:${x.id}`}
                    onEdit={() =>
                      setEditTx({
                        id: x.id,
                        direction: x.direction,
                        amount: String(Number(x.amountCents) / 100),
                        category: TX_CATEGORIES.includes(x.category) ? x.category : "其他",
                        counterparty: x.counterparty ?? "",
                      })
                    }
                    onDelete={() => del(`tx:${x.id}`, () => deleteTransaction(x.id))}
                  />
                </View>
              ),
            )}

            {/* ---- 人物（= web people 行：👥 chip + 两步删除） ---- */}
            {people.length > 0 ? (
              <View className="mc-row">
                <TagChip lucide="users" label={people.map((p) => p.name).join("、")} tone="sky" size="sm" maxWidth />
                <RowAction
                  armed={delArmed === `people:${m.id}`}
                  onDelete={() =>
                    del(`people:${m.id}`, () =>
                      Promise.all(people.map((p) => deleteInteraction(p.interactionId))).then(() => undefined),
                    )
                  }
                />
              </View>
            ) : null}

            {/* ---- 饮食（= web diet 行：餐次 · 菜品 + kcal + 两步删除） ---- */}
            {m.diet ? (
              <View className="mc-row">
                <TagChip lucide="utensils" label="饮食" tone="amber" size="sm" />
                <Text className="mc-row-main">
                  {m.diet.meal !== "未知" ? `${m.diet.meal} · ` : ""}
                  {(m.diet.items ?? []).map((i) => `${i.name}${i.amount ?? ""}`).join(" + ")}
                  {m.diet.totalKcal != null ? ` · ≈${m.diet.totalKcal} kcal` : ""}
                </Text>
                <RowAction armed={delArmed === `diet:${m.id}`} onDelete={() => del(`diet:${m.id}`, () => deleteDiet(m.id))} />
              </View>
            ) : null}
          </View>
        ) : null}

        {/* = web PendingConfirms：低置信待确认域逐条「确认 / 忽略」 */}
        {(Object.entries(recs) as [string, { status?: string; confidence?: number }][]).filter(([, v]) => v?.status === "pending").length > 0 ? (
          <View className="mc-pendings">
            {(Object.entries(recs) as [string, { status?: string; confidence?: number }][])
              .filter(([, v]) => v?.status === "pending")
              .map(([domain, v]) => (
                <View key={domain} className="mc-pending">
                  <Text className="mc-pending-text">
                    🤔 识别到{DOMAIN_LABELS[domain] ?? domain}（置信度 {Math.round(Number(v?.confidence ?? 0) * 100)}%），确认吗？
                  </Text>
                  <Text
                    className="mc-pending-ok"
                    onClick={() =>
                      run(async () => {
                        await confirmEntry(m.id, domain);
                        return "✅ 已确认入账";
                      })
                    }
                  >
                    确认
                  </Text>
                  <Text
                    className="mc-pending-ignore"
                    onClick={() =>
                      run(async () => {
                        await confirmEntry(m.id, domain, true);
                        return "已忽略";
                      })
                    }
                  >
                    忽略
                  </Text>
                </View>
              ))}
          </View>
        ) : null}

        {/* 交互提示（= web 底部 border-t 提示行） */}
        {!menuOpen ? (
          <Text className="mc-hint">点击动态内容 → 打开识别菜单（AI 识别 / 手动补充六类信息）</Text>
        ) : null}

        {/* 卡内操作反馈已统一到全局 toast（= web use-card-actions 注释：卡片滚出视口就地横幅看不见） */}
      </View>

      {/* = web EntryMenu（识别与补充）：移动端为底部弹层 */}
      {menuOpen ? (
        <EntryMenu
          m={m}
          activities={activities}
          onAI={recognizeDomain}
          onManual={manualAdd}
          onSetSpace={setSpace}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </View>
  );
}
