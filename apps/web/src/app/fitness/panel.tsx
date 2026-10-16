"use client";

/**
 * 健身训练面板（REQ-016/018）：渲染于内置「运动」空间的训练栏（同页受控四 tab：今日/计划/趋势/目标&档案）。
 * 今日 = 粘贴导入（AI 解析草稿 → 预览确认入库）+ 当日计划卡（确认/打卡/跳过）+ 周一体重腰围；
 * 计划 = 按周分组的计划 vs 实际对照；计划落库自动联动首页「今日行动」（后端 syncPlanTodos）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import SubNav from "@/components/sub-nav";
import Skeleton from "@/components/skeleton";
import { Modal } from "@/components/ui/modal";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import { blobToDataUrl, compressImage } from "@/lib/image";
import { bjAddDays, bjMondayOf, bjToday } from "@shiguangri/shared/date";
import FitnessTrends from "./charts";
import FitnessArchive from "./archive";
import {
  cm,
  exerciseMeta,
  groupByWeek,
  hours,
  kg,
  km,
  mdLabel,
  pace,
  PLAN_STATUS_META,
  planTitle,
  RUN_WORKOUT_LABELS,
  type FitnessBodyMetric,
  type FitnessExercise,
  type FitnessGoal,
  type FitnessModule,
  type FitnessPlan,
  type FitnessProfile,
  type FitnessSessionLog,
  type RunPlanContent,
  type StrengthPlanContent,
} from "./kit";

const TABS = [
  { key: "today", label: "今日" },
  { key: "plans", label: "计划" },
  { key: "trends", label: "趋势" },
  { key: "archive", label: "目标&档案" },
];

interface PageData {
  modules: FitnessModule[];
  goals: FitnessGoal[];
  profile: FitnessProfile | null;
  plans: FitnessPlan[];
  logs: FitnessSessionLog[];
  metrics: FitnessBodyMetric[];
  exercises: FitnessExercise[];
}

export default function FitnessPanel() {
  const [today, setToday] = useState<string | null>(null); // mounted 后再取（SSG 防 hydration mismatch）
  const [tab, setTab] = useState("today");
  const [data, setData] = useState<PageData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [xunjiEnabled, setXunjiEnabled] = useState(false); // 训记集成配置（REQ-017 按钮显隐）

  useEffect(() => setToday(bjToday()), []);
  useEffect(() => {
    api<{ enabled: boolean }>("/api/fitness/xunji-status")
      .then((r) => setXunjiEnabled(Boolean(r.enabled)))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!today) return;
    setLoadErr(null);
    try {
      const from = bjAddDays(today, -13);
      const to = bjAddDays(today, 1);
      const mFrom = bjAddDays(today, -180);
      const [mods, goals, prof, plans, logs, metrics, exs] = await Promise.all([
        api<{ modules: FitnessModule[] }>("/api/fitness/modules"),
        api<{ goals: FitnessGoal[] }>("/api/fitness/goals"),
        api<{ profile: FitnessProfile | null }>("/api/fitness/profile"),
        api<{ plans: FitnessPlan[] }>(`/api/fitness/plans?from=${from}&to=${to}`),
        api<{ logs: FitnessSessionLog[] }>(`/api/fitness/logs?from=${from}&to=${to}`),
        api<{ metrics: FitnessBodyMetric[] }>(`/api/fitness/metrics?from=${mFrom}&to=${today}`),
        api<{ exercises: FitnessExercise[] }>("/api/fitness/exercises"),
      ]);
      setData({
        modules: mods.modules ?? [],
        goals: goals.goals ?? [],
        profile: prof.profile ?? null,
        plans: plans.plans ?? [],
        logs: logs.logs ?? [],
        metrics: metrics.metrics ?? [],
        exercises: exs.exercises ?? [],
      });
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [today]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <SubNav items={TABS} value={tab} onChange={setTab} ariaLabel="健身子导航" className="mb-5" />

        {loadErr ? (
          <div className="rounded-2xl border border-line-soft bg-surface p-6 text-center">
            <p className="text-sm text-danger">{loadErr}</p>
            <button className="btn-ghost mt-3 px-4 py-1.5 text-sm" onClick={load}>
              重试
            </button>
          </div>
        ) : !data || !today ? (
          <Skeleton rows={4} />
        ) : (
          <>
            {tab === "today" && <TodayTab today={today} data={data} reload={load} xunjiEnabled={xunjiEnabled} />}
            {tab === "plans" && <PlansTab today={today} data={data} reload={load} xunjiEnabled={xunjiEnabled} />}
            {tab === "trends" && <FitnessTrends metrics={data.metrics} plans={data.plans} today={today} />}
            {tab === "archive" && (
              <FitnessArchive
                modules={data.modules}
                goals={data.goals}
                profile={data.profile}
                exercises={data.exercises}
                onGoalsChanged={load}
                onProfileChanged={load}
              />
            )}
          </>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 今日 tab
// ---------------------------------------------------------------------------

function TodayTab({ today, data, reload, xunjiEnabled }: { today: string; data: PageData; reload: () => void; xunjiEnabled: boolean }) {
  const tomorrow = bjAddDays(today, 1);
  const todays = data.plans.filter((p) => p.plan_date === today);
  const tomorrows = data.plans.filter((p) => p.plan_date === tomorrow);
  const lastMetric = data.metrics[data.metrics.length - 1] ?? null;

  return (
    <div className="space-y-5">
      <ImportCard today={today} tomorrow={tomorrow} reload={reload} />

      <section>
        <h2 className="mb-2 text-sm font-medium">今天 · {mdLabel(today)}</h2>
        {todays.length ? (
          <div className="space-y-3">
            {todays.map((p) => (
              <PlanCard key={p.id} plan={p} exercises={data.exercises} logs={data.logs} reload={reload} xunjiEnabled={xunjiEnabled} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-line-soft bg-surface/50 p-4 text-xs text-ink-mute">
            今天还没有计划——粘贴佳明课表导入，或在拾光助手里让 AI 生成（「今天有间歇课，力量怎么排？」）。
          </p>
        )}
      </section>

      {tomorrows.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">明天 · {mdLabel(tomorrow)}</h2>
          <div className="space-y-3">
            {tomorrows.map((p) => (
              <PlanCard key={p.id} plan={p} exercises={data.exercises} logs={data.logs} reload={reload} xunjiEnabled={xunjiEnabled} />
            ))}
          </div>
        </section>
      )}

      <MetricCard today={today} last={lastMetric} reload={reload} />
    </div>
  );
}

/** 粘贴导入：AI 解析 → 草稿预览 → 确认入库（文字课表或佳明训练截图，REQ-020） */
function ImportCard({ today, tomorrow, reload }: { today: string; tomorrow: string; reload: () => void }) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ mimeType: string; base64: string; previewUrl: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<{ moduleCode: string; content: RunPlanContent | StrengthPlanContent; rationale: string | null } | null>(null);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  async function pickImage(files: FileList | null) {
    const file = files?.[0];
    if (!file || picking) return;
    setPicking(true);
    try {
      // 佳明截图文字密集：沿用动态图压缩（长边 ≤1920 / JPEG 0.85）保证 OCR 可读
      const { blob } = await compressImage(file);
      const dataUrl = await blobToDataUrl(blob);
      setImage({ mimeType: blob.type || "image/jpeg", base64: dataUrl.split(",")[1] ?? "", previewUrl: dataUrl });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setPicking(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function parse() {
    if (parsing || (!text.trim() && !image)) return;
    setParsing(true);
    try {
      const res = await api<{ draft: { moduleCode: string; content: RunPlanContent | StrengthPlanContent; rationale: string | null } }>(
        "/api/fitness/plans/parse",
        "POST",
        {
          text: text.trim() || undefined,
          image: image ? { mimeType: image.mimeType, base64: image.base64 } : undefined,
        },
      );
      setDraft(res.draft);
      setDate(today);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (busy || !draft) return;
    setBusy(true);
    try {
      const res = await api<{ syncedActions: number }>("/api/fitness/plans", "POST", {
        planDate: date,
        moduleCode: draft.moduleCode,
        source: "import",
        content: draft.content,
        rationale: draft.rationale,
      });
      toast(`✅ 已导入${res.syncedActions ? `，联动 ${res.syncedActions} 条今日行动` : ""}`);
      setDraft(null);
      setText("");
      setImage(null);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-4">
      <h2 className="mb-2 text-sm font-medium">📥 导入课表</h2>
      <p className="mb-2 text-xs text-ink-mute">把佳明当日课表文字粘进来，或上传佳明 App 训练详情截图，AI 解析成结构化计划草稿。</p>
      <textarea
        className="input-glow h-20 w-full text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="例：间歇跑 8 公里，55 分钟。热身 1 公里 @6:15；6×400 米 @5:20，组间 400 米慢跑；放松 1 公里"
        maxLength={2000}
      />
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickImage(e.target.files)} />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
          onClick={() => fileInputRef.current?.click()}
          disabled={picking || parsing}
        >
          {picking ? "处理中…" : "📷 佳明截图识别"}
        </button>
        <button
          className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
          onClick={parse}
          disabled={parsing || (!text.trim() && !image)}
        >
          {parsing ? "解析中…" : "AI 解析"}
        </button>
      </div>
      {image && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-line-soft bg-wash/40 p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.previewUrl} alt="课表截图预览" className="h-20 w-14 rounded-lg border border-line-soft object-cover" />
          <div className="min-w-0 flex-1 text-xs text-ink-mute">
            已附截图，可与文字备注一起解析（如「明天的课」）
            <button className="mt-1 block text-accent hover:underline" onClick={() => setImage(null)}>
              移除截图
            </button>
          </div>
        </div>
      )}
      {draft && (
        <Modal title="解析草稿（确认后入库）" onClose={() => setDraft(null)} size="lg">
          <div className="space-y-3">
            <label className="block text-xs text-ink-mute">
              计划日期
              <select className="input-glow mt-1 w-full" value={date} onChange={(e) => setDate(e.target.value)}>
                <option value={today}>今天 · {mdLabel(today)}</option>
                <option value={tomorrow}>明天 · {mdLabel(tomorrow)}</option>
              </select>
            </label>
            <div className="rounded-xl border border-line-soft bg-wash/40 p-3 text-sm">
              <ContentPreview content={draft.content} moduleCode={draft.moduleCode} />
            </div>
            {draft.rationale ? <p className="text-xs text-ink-mute">识别依据：{draft.rationale}</p> : null}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setDraft(null)}>
                放弃
              </button>
              <button className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50" onClick={save} disabled={busy}>
                {busy ? "保存中…" : "保存并联动今日行动"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** 分段时长展示：整分钟给 "10 分钟"；小数是秒级步骤（佳明 0:40 → 0.67），换算回 "40 秒" */
function fmtStepMinutes(min: number): string {
  if (Number.isInteger(min)) return `${min} 分钟`;
  return `${Math.round(min * 60)} 秒`;
}

/** 计划 content 预览（导入草稿与计划卡共用） */
function ContentPreview({
  content,
  moduleCode,
  exercises,
}: {
  content: RunPlanContent | StrengthPlanContent;
  moduleCode: string;
  exercises?: FitnessExercise[];
}) {
  if (moduleCode === "run") {
    const c = content as RunPlanContent;
    return (
      <div className="space-y-1">
        <p className="font-medium">
          {RUN_WORKOUT_LABELS[c.workoutType] ?? c.workoutType} · {c.title}
          {c.totalDistanceM ? <span className="ml-2 text-xs text-ink-mute">{km(c.totalDistanceM)}{c.durationMin ? ` / ${c.durationMin} 分钟` : ""}</span> : c.durationMin ? <span className="ml-2 text-xs text-ink-mute">{c.durationMin} 分钟</span> : null}
        </p>
        {c.segments?.map((s, i) => (
          <p key={i} className="text-xs text-ink-mute">
            {s.label}
            {s.reps ? ` ×${s.reps}` : ""}
            {s.distanceM ? ` ${km(s.distanceM)}` : ""}
            {s.durationMin ? ` ${fmtStepMinutes(s.durationMin)}` : ""}
            {s.paceSPerKm ? ` @ ${pace(s.paceSPerKm)}/km` : ""}
            {s.hrZone ? `（心率 ${s.hrZone} 区）` : ""}
            {s.hrBpmText ? `（目标心率 ${s.hrBpmText} bpm）` : ""}
          </p>
        ))}
        {c.note ? <p className="text-xs text-ink-mute">备注:{c.note}</p> : null}
      </div>
    );
  }
  const c = content as StrengthPlanContent;
  return (
    <div className="space-y-1">
      <p className="font-medium">
        {c.title}
        {c.durationMin ? <span className="ml-2 text-xs text-ink-mute">{c.durationMin} 分钟</span> : null}
      </p>
      {c.exercises.map((e, i) => {
        const meta = exercises ? exerciseMeta(e, exercises) : undefined;
        return (
          <p key={i} className="text-xs">
            {e.name}
            {e.weightG ? ` ${kg(e.weightG)}` : ""}
            {e.sets || e.repsText ? ` × ${[e.sets, e.repsText].filter(Boolean).join("×")}` : ""}
            {e.rir != null ? <span className="text-ink-mute">（RIR {e.rir}）</span> : null}
            {meta ? <span className="ml-1 text-ink-mute">· {meta.muscle_primary.join("/")}</span> : null}
            <span className="block pl-2 text-[11px] leading-snug text-ink-mute/80">{meta?.benefit}</span>
            {e.note ? <span className="block pl-2 text-[11px] leading-snug text-ink-mute/80">{e.note}</span> : null}
          </p>
        );
      })}
      {c.note ? <p className="text-xs text-ink-mute">备注:{c.note}</p> : null}
    </div>
  );
}

/** 单条计划卡：状态徽标 + 内容 + 状态流转按钮 + 打卡表单 + 训记同步（REQ-017） */
function PlanCard({
  plan,
  exercises,
  logs,
  reload,
  xunjiEnabled,
}: {
  plan: FitnessPlan;
  exercises: FitnessExercise[];
  logs: FitnessSessionLog[];
  reload: () => void;
  xunjiEnabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  /** REQ-023 同步确认：目录外动作名 → 用户挑官方名/跳过；picks 记录每个名字的选择 */
  const [xunjiConfirm, setXunjiConfirm] = useState<{ name: string; candidates: { name: string; type: string | null }[] }[] | null>(null);
  const [xunjiPicks, setXunjiPicks] = useState<Record<string, string>>({});
  const meta = PLAN_STATUS_META[plan.status];
  const log = logs.find((l) => l.plan_id === plan.id) ?? null;
  const xunjiSynced = Boolean(plan.xunji_sync?.localids?.length);

  async function syncXunji(confirm?: { mappings: Record<string, string>; skips: string[] }) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{
        synced?: boolean;
        updated?: boolean;
        movements?: number;
        skipped?: string[];
        needsConfirmation?: boolean;
        unmatched?: { name: string; candidates: { name: string; type: string | null }[] }[];
      }>(`/api/fitness/plans/${plan.id}/sync-xunji`, "POST", confirm);
      if (r.needsConfirmation && r.unmatched?.length) {
        // 默认选第一个候选；无候选的动作只能跳过
        const defaults: Record<string, string> = {};
        for (const u of r.unmatched) defaults[u.name] = u.candidates[0]?.name ?? "__skip__";
        setXunjiPicks(defaults);
        setXunjiConfirm(r.unmatched);
        return;
      }
      const skippedNote = r.skipped?.length ? `，跳过 ${r.skipped.length} 项` : "";
      toast(`${r.updated ? "已更新训记训练" : "已写入训记 App"}（${r.movements ?? 0} 项${skippedNote}），训练时在训记里打勾`);
      setXunjiConfirm(null);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  function confirmXunjiMappings() {
    if (!xunjiConfirm) return;
    const mappings: Record<string, string> = {};
    const skips: string[] = [];
    for (const u of xunjiConfirm) {
      const pick = xunjiPicks[u.name] ?? "__skip__";
      if (pick === "__skip__") skips.push(u.name);
      else mappings[u.name] = pick;
    }
    syncXunji({ mappings, skips });
  }

  async function patch(body: Record<string, unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/fitness/plans/${plan.id}`, "PATCH", body);
      toast(okMsg);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/fitness/plans/${plan.id}`, "DELETE");
      toast("已删除计划，联动行动已清理");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`rounded-2xl border border-line-soft bg-surface p-4 ${plan.status === "skipped" ? "opacity-55" : ""}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium">{planTitle(plan)}</h3>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${meta.cls}`}>{meta.label}</span>
      </div>
      <ContentPreview content={plan.content} moduleCode={plan.module_code} exercises={exercises} />
      {plan.rationale && plan.source === "ai" ? (
        <p className="mt-2 rounded-lg bg-sky-500/5 p-2 text-[11px] leading-snug text-ink-mute">💡 {plan.rationale}</p>
      ) : null}

      {log ? (
        <div className="mt-2 rounded-lg bg-emerald-500/5 p-2 text-xs text-ink-mute">
          实际:
          {log.actual?.distanceM ? ` ${km(log.actual.distanceM)}` : ""}
          {log.actual?.paceSPerKm ? ` @ ${pace(log.actual.paceSPerKm)}/km` : ""}
          {log.actual?.avgHr ? ` · 心率 ${log.actual.avgHr}` : ""}
          {log.actual?.exercises?.length ? ` · ${log.actual.exercises.length} 个动作` : ""}
          {log.fatigue ? ` · 疲劳 ${log.fatigue}/10` : ""}
          {log.sleep_h_x10 ? ` · 睡眠 ${hours(log.sleep_h_x10)}` : ""}
          {log.soreness ? ` · 酸痛:${log.soreness}` : ""}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {plan.status !== "skipped" && plan.status !== "done" && plan.status !== "partial" && (
          <>
            {plan.status === "draft" && (
              <button className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => patch({ status: "confirmed" }, "已确认计划")}>
                确认
              </button>
            )}
            <button
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => setChecking(true)}
            >
              打卡
            </button>
            {xunjiEnabled ? (
              <>
                <button className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => syncXunji()}>
                  {xunjiSynced ? "更新训记" : "同步训记"}
                </button>
                <button className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => setPulling(true)}>
                  从训记同步完成
                </button>
              </>
            ) : null}
            <button className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => patch({ status: "skipped" }, "已跳过（联动行动已清理）")}>
              跳过
            </button>
          </>
        )}
        <button className="btn-ghost px-3 py-1.5 text-xs text-danger disabled:opacity-50" disabled={busy} onClick={() => setConfirmDel(true)}>
          删除
        </button>
      </div>
      <p className="mt-2 text-[11px] text-ink-mute/70">
        ✅ 已同步到首页「今日行动」，打卡后行动自动完成
        {xunjiSynced ? " · 📲 训记已同步" : ""}
      </p>

      {checking && <CheckInModal plan={plan} onClose={() => setChecking(false)} onDone={() => { setChecking(false); reload(); }} />}
      {pulling && <PullXunjiModal plan={plan} onClose={() => setPulling(false)} onDone={() => { setPulling(false); reload(); }} />}
      {xunjiConfirm && (
        <Modal title="确认训记动作名" onClose={() => setXunjiConfirm(null)} size="lg">
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-ink-mute">
              以下动作在训记官方动作库里没有同名项（多为佳明截图的自重/循环动作）。请为每个动作挑一个训记官方名——
              确认后记住映射，以后自动套用；没有合适候选可以跳过，该动作不写入训记 App。
            </p>
            {xunjiConfirm.map((u) => (
              <label key={u.name} className="block text-sm">
                <span className="mb-1 block font-medium">{u.name}</span>
                <select
                  className="input-glow w-full text-sm"
                  value={xunjiPicks[u.name] ?? u.candidates[0]?.name ?? "__skip__"}
                  onChange={(e) => setXunjiPicks((p) => ({ ...p, [u.name]: e.target.value }))}
                >
                  {u.candidates.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                      {c.type ? `（${c.type}）` : ""}
                    </option>
                  ))}
                  <option value="__skip__">跳过——不写入训记</option>
                </select>
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setXunjiConfirm(null)}>
                取消
              </button>
              <button className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={confirmXunjiMappings}>
                {busy ? "同步中…" : "确认并同步训记"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDel && (
        <Modal title={`删除计划 · ${planTitle(plan)}`} onClose={() => setConfirmDel(false)}>
          <div className="space-y-3">
            <p className="text-sm leading-relaxed">
              确定删除这条计划？删除后不可恢复，联动的今日行动会一并清理。
              {log ? " 该计划已打卡，执行记录将保留为独立打卡历史（趋势统计不受影响）。" : ""}
              {xunjiSynced ? " 已同步到训记的训练不受影响，如需可在训记 App 里删除。" : ""}
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setConfirmDel(false)}>
                取消
              </button>
              <button
                className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
                disabled={busy}
                onClick={remove}
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </article>
  );
}

/** 打卡表单：跑步实际（距离/时长/心率→自动配速）或力量逐动作组次 + 感受 */
function CheckInModal({ plan, onClose, onDone }: { plan: FitnessPlan; onClose: () => void; onDone: () => void }) {
  const isRun = plan.module_code === "run";
  const runContent = plan.content as RunPlanContent;
  const strengthContent = plan.content as StrengthPlanContent;
  const [distanceKm, setDistanceKm] = useState(runContent.totalDistanceM ? String(runContent.totalDistanceM / 1000) : "");
  const [durationMin, setDurationMin] = useState(runContent.durationMin ? String(runContent.durationMin) : "");
  const [avgHr, setAvgHr] = useState("");
  const [actuals, setActuals] = useState<Record<number, string>>(
    Object.fromEntries((strengthContent.exercises ?? []).map((e, i) => [i, [e.sets, e.repsText].filter(Boolean).join("×")])),
  );
  const [fatigue, setFatigue] = useState("");
  const [sleepHours, setSleepHours] = useState("");
  const [soreness, setSoreness] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(partial: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const actual: Record<string, unknown> = {};
      if (isRun) {
        const dKm = Number(distanceKm) || 0;
        const durS = Math.round((Number(durationMin) || 0) * 60);
        if (dKm > 0) actual.distanceM = Math.round(dKm * 1000);
        if (durS > 0) actual.durationS = durS;
        if (dKm > 0 && durS > 0) actual.paceSPerKm = Math.round(durS / dKm);
        if (avgHr) actual.avgHr = Number(avgHr);
      } else {
        actual.exercises = (strengthContent.exercises ?? [])
          .map((e, i) => ({ name: e.name, sets: e.sets ?? null, repsText: actuals[i] || (e.repsText ?? null), weightG: e.weightG ?? null }))
          .filter((e) => e.repsText);
      }
      await api(`/api/fitness/plans/${plan.id}`, "PATCH", {
        status: partial ? "partial" : "done",
        actual,
        fatigue: fatigue ? Number(fatigue) : null,
        sleepHours: sleepHours ? Number(sleepHours) : null,
        soreness: soreness || null,
        note: note || null,
      });
      toast(partial ? "已记录部分完成" : "✅ 打卡完成，联动行动已自动完成");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "input-glow w-full text-sm";

  return (
    <Modal title={`打卡 · ${planTitle(plan)}`} onClose={onClose}>
      <div className="space-y-3">
        {isRun ? (
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-ink-mute">
              距离(km)
              <input className={inputCls} inputMode="decimal" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="8.2" />
            </label>
            <label className="text-xs text-ink-mute">
              时长(分)
              <input className={inputCls} inputMode="numeric" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="50" />
            </label>
            <label className="text-xs text-ink-mute">
              均心率
              <input className={inputCls} inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} placeholder="158" />
            </label>
          </div>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {(strengthContent.exercises ?? []).map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-xs">
                  {e.name}
                  {e.weightG ? <span className="text-ink-mute"> {kg(e.weightG)}</span> : null}
                </span>
                <input
                  className={inputCls}
                  value={actuals[i] ?? ""}
                  onChange={(ev) => setActuals((prev) => ({ ...prev, [i]: ev.target.value }))}
                  placeholder={e.repsText ?? "10-12"}
                />
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-ink-mute">
            疲劳(1-10)
            <input className={inputCls} inputMode="numeric" value={fatigue} onChange={(e) => setFatigue(e.target.value)} placeholder="6" />
          </label>
          <label className="text-xs text-ink-mute">
            睡眠(小时)
            <input className={inputCls} inputMode="decimal" value={sleepHours} onChange={(e) => setSleepHours(e.target.value)} placeholder="6.5" />
          </label>
          <label className="text-xs text-ink-mute">
            酸痛部位
            <input className={inputCls} value={soreness} onChange={(e) => setSoreness(e.target.value)} placeholder="大腿前侧" />
          </label>
        </div>
        <label className="block text-xs text-ink-mute">
          一句话备注
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="最后一组间歇顶住了" />
        </label>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onClose}>
            取消
          </button>
          <button className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => submit(true)}>
            部分完成
          </button>
          <button className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => submit(false)}>
            完成打卡
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 训记完成数据预览 → 确认自动打卡（REQ-017）：拉取打勾组实练明细，确认后落日志+完成联动行动 */
function PullXunjiModal({ plan, onClose, onDone }: { plan: FitnessPlan; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ status: string; summary: string; actual: Record<string, unknown> } | null>(null);

  useEffect(() => {
    api<{ status: string; summary: string; actual: Record<string, unknown> }>(`/api/fitness/plans/${plan.id}/pull-xunji`, "POST", { preview: true })
      .then(setPreview)
      .catch((e) => {
        toast(e instanceof Error ? e.message : String(e), "err");
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/fitness/plans/${plan.id}/pull-xunji`, "POST", { preview: false });
      toast("✅ 已按训记实练打卡，联动行动自动完成");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  const exs = (preview?.actual?.exercises as { name: string; sets: number; repsText: string; weightG: number | null }[] | undefined) ?? [];
  const kgOf = (g: number | null) => (g ? `${Math.round(g / 100) / 10}kg` : "");

  return (
    <Modal title={`从训记同步 · ${planTitle(plan)}`} onClose={onClose}>
      <div className="space-y-3">
        {loading ? <p className="py-6 text-center text-xs text-ink-mute">正在读取训记当日记录…</p> : null}
        {preview ? (
          <>
            <p className="text-xs text-ink-mute">
              {preview.summary} · 判定为 <span className="font-medium text-ink">{preview.status === "done" ? "全部完成" : "部分完成"}</span>
            </p>
            {exs.length ? (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-wash/60 p-2.5">
                {exs.map((e, i) => (
                  <p key={i} className="text-xs">
                    · {e.name}
                    {e.weightG ? ` ${kgOf(e.weightG)}` : ""} × {e.sets} 组
                    {e.repsText ? `（${e.repsText}）` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            {preview.actual?.distanceM ? (
              <p className="text-xs text-ink-mute">
                跑步 {(preview.actual.distanceM as number) / 1000}km
                {preview.actual?.durationS ? ` · ${Math.round((preview.actual.durationS as number) / 60)} 分钟` : ""}
                {preview.actual?.paceSPerKm ? ` · 配速 ${pace(preview.actual.paceSPerKm as number)}/km` : ""}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={onClose}>
                取消
              </button>
              <button className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={confirm}>
                {busy ? "打卡中…" : "按训记实练打卡"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** 周一晨重腰围快录（019 起补身高/体脂率） */
function MetricCard({ today, last, reload }: { today: string; last: FitnessBodyMetric | null; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [weightKg, setWeightKg] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/fitness/metrics", "POST", {
        measuredOn: today,
        weightKg: weightKg ? Number(weightKg) : null,
        waistCm: waistCm ? Number(waistCm) : null,
        heightCm: heightCm ? Number(heightCm) : null,
        bodyFatPct: bodyFatPct ? Number(bodyFatPct) : null,
      });
      toast("✅ 已记录身体指标");
      setOpen(false);
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">⚖️ 身体指标</h2>
        <button className="text-xs text-accent hover:underline" onClick={() => setOpen(true)}>
          {last ? "记一笔" : "+ 录入"}
        </button>
      </div>
      {last ? (
        <p className="mt-2 text-xs text-ink-mute">
          最近（{mdLabel(last.measured_on)}）：体重 {kg(last.weight_g)} · 腰围 {cm(last.waist_mm)}cm
          {last.body_fat_pct_x10 ? ` · 体脂 ${last.body_fat_pct_x10 / 10}%` : ""}
          {last.height_mm ? ` · 身高 ${cm(last.height_mm)}cm` : ""}
        </p>
      ) : (
        <p className="mt-2 text-xs text-ink-mute">每周一晨起空腹：体重 + 腰围（肚脐水平），可补身高与体脂率。</p>
      )}
      {open && (
        <Modal title={`身体指标 · ${mdLabel(today)}`} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-ink-mute">
                晨重（kg）
                <input className="input-glow w-full text-sm" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="68.4" />
              </label>
              <label className="text-xs text-ink-mute">
                腰围（cm）
                <input className="input-glow w-full text-sm" inputMode="decimal" value={waistCm} onChange={(e) => setWaistCm(e.target.value)} placeholder="88" />
              </label>
              <label className="text-xs text-ink-mute">
                身高（cm）
                <input className="input-glow w-full text-sm" inputMode="decimal" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="172" />
              </label>
              <label className="text-xs text-ink-mute">
                体脂率（%）
                <input className="input-glow w-full text-sm" inputMode="decimal" value={bodyFatPct} onChange={(e) => setBodyFatPct(e.target.value)} placeholder="18.5" />
              </label>
            </div>
            <p className="text-micro text-ink-faint">留空的项保持原值不被清除；身高体脂可只在变化时记录。</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
                disabled={busy || (!weightKg && !waistCm && !heightCm && !bodyFatPct)}
                onClick={save}
              >
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 计划 tab：按周分组（计划 vs 实际）
// ---------------------------------------------------------------------------

function PlansTab({ today, data, reload, xunjiEnabled }: { today: string; data: PageData; reload: () => void; xunjiEnabled: boolean }) {
  const weeks = groupByWeek(data.plans);
  const thisMonday = bjMondayOf(today);
  return (
    <div className="space-y-4">
      {weeks.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line-soft bg-surface/50 p-4 text-xs text-ink-mute">
          近两周还没有计划。去「今日」粘贴导入，或让拾光助手生成。
        </p>
      )}
      {weeks.map((w) => (
        <section key={w.monday} className="rounded-2xl border border-line-soft bg-surface/60 p-4">
          <h2 className="mb-3 text-sm font-medium">
            周 · {w.monday}
            {w.monday === thisMonday ? "（本周）" : ""}
          </h2>
          <div className="space-y-3">
            {w.items.map((p) => (
              <PlanCard key={p.id} plan={p} exercises={data.exercises} logs={data.logs} reload={reload} xunjiEnabled={xunjiEnabled} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
