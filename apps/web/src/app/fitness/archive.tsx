"use client";

/**
 * fitness 目标&档案 tab（REQ-016 FR-A/FR-F）：基本情况表单、每模块目标（标题/目标日期/归档；
 * 策略档案已下线——REQ-019 追加，用户不可理解；chat 工具仍读存量 strategy 供教练参考）、
 * 动作库浏览（肌群 + 收益「练什么对哪里有好处」）。
 */
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { api } from "@/shared/api";
import { toast } from "@/shared/ui/toast";
import type { FitnessExercise, FitnessGoal, FitnessModule, FitnessProfile } from "@shiguangri/shared/fitness-types";

function GoalCard({
  goal,
  mod,
  onSaved,
}: {
  goal: FitnessGoal | undefined;
  mod: FitnessModule;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(goal?.title ?? "");
  const [targetDate, setTargetDate] = useState(goal?.target_date ?? "");

  /** 打开编辑时按最新 goal 重置表单：state 仅首渲染初始化，新建保存后 goal prop 才有值，
   *  不重置则再点「编辑」是空表单（十一轮检视修复） */
  function openEdit() {
    setTitle(goal?.title ?? "");
    setTargetDate(goal?.target_date ?? "");
    setEditing(true);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      if (goal) {
        await api(`/api/fitness/goals/${goal.id}`, "PATCH", {
          title: title.trim() || undefined,
          targetDate: targetDate || null,
        });
      } else {
        await api("/api/fitness/goals", "POST", {
          moduleCode: mod.code,
          title: title.trim(),
          targetDate: targetDate || null,
        });
      }
      toast(goal ? "✅ 目标已更新" : `✅ 已创建 ${mod.name}目标`);
      setEditing(false);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!goal || busy) return;
    setBusy(true);
    try {
      await api(`/api/fitness/goals/${goal.id}`, "PATCH", { status: "archived" });
      toast("已归档目标");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          {mod.icon} {mod.name}
        </h3>
        <button className="tap-lg inline-block py-1 text-xs text-accent hover:underline" onClick={openEdit}>
          {goal ? "编辑" : "+ 设定目标"}
        </button>
      </div>
      {goal ? (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">{goal.title}</span>
            {goal.target_date ? <span className="ml-2 text-xs text-ink-mute">目标日 {goal.target_date}</span> : null}
          </p>
          {goal.status !== "active" && <p className="text-xs text-ink-mute">（{goal.status === "archived" ? "已归档" : "已达成"}）</p>}
        </div>
      ) : (
        <p className="text-xs text-ink-mute">还没有活跃目标——设定后助手会结合你的目标与执行记录编排训练。</p>
      )}
      {editing && (
        <Modal title={`${mod.name}目标`} onClose={() => setEditing(false)}>
          <div className="space-y-3">
            <label className="block text-xs text-ink-mute">
              目标标题
              <input
                className="input-glow mt-1 w-full"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={mod.code === "run" ? "珠海半马破 2" : "薄肌 60-62kg · 体脂 13-15%"}
                maxLength={60}
              />
            </label>
            <label className="block text-xs text-ink-mute">
              目标日期
              <input
                type="date"
                className="input-glow mt-1 w-full"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              {goal ? (
                <button className="tap-lg inline-block py-1 text-xs text-danger hover:underline disabled:opacity-50" onClick={archive} disabled={busy}>
                  归档
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setEditing(false)}>
                  取消
                </button>
                <button className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50" onClick={save} disabled={busy || !title.trim()}>
                  保存
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function ProfileForm({ profile, onSaved }: { profile: FitnessProfile | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [height, setHeight] = useState(profile?.height_cm != null ? String(profile.height_cm) : "");
  const [experience, setExperience] = useState(profile?.experience ?? "");
  const [equipment, setEquipment] = useState((profile?.equipment ?? []).join("、"));
  const [weeklyDays, setWeeklyDays] = useState(profile?.weekly_days ?? "");
  const [constraints, setConstraints] = useState(profile?.constraints ?? "");

  async function save() {
    if (busy) return;
    // 身高前置校验：NaN 会被 JSON.stringify 静默序列化成 null——请求 200 toast 成功实则没存；
    // 范围/整数口径对齐服务端 zod（int 50~260），英文原文不得直达界面；器械每项 ≤30 字 ≤10 项同守
    if (height) {
      const h = Number(height);
      if (!Number.isFinite(h) || !Number.isInteger(h) || h < 50 || h > 260) {
        toast("身高需为 50~260 的整数（厘米）", "err");
        return;
      }
    }
    const equipList = equipment ? equipment.split(/[,，、\s]+/).filter(Boolean) : [];
    if (equipList.some((e) => e.length > 30) || equipList.length > 10) {
      toast("器械每项最长 30 字，最多 10 项", "err");
      return;
    }
    setBusy(true);
    try {
      await api("/api/fitness/profile", "PUT", {
        heightCm: height ? Number(height) : null,
        experience: experience || null,
        equipment: equipList,
        weeklyDays: weeklyDays || null,
        constraints: constraints || null,
      });
      toast("✅ 基本情况已保存");
      setOpen(false);
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">🧍 基本情况</h3>
        <button className="tap-lg inline-block py-1 text-xs text-accent hover:underline" onClick={() => setOpen(true)}>
          {profile ? "编辑" : "+ 填写"}
        </button>
      </div>
      {profile ? (
        <div className="space-y-1 text-xs text-ink-mute">
          {profile.height_cm ? <p>身高 {profile.height_cm}cm</p> : null}
          {profile.experience ? <p>经验：{profile.experience}</p> : null}
          {profile.equipment?.length ? <p>器械：{profile.equipment.join("、")}</p> : null}
          {profile.weekly_days ? <p>每周安排：{profile.weekly_days}</p> : null}
          {profile.constraints ? <p>约束：{profile.constraints}</p> : null}
        </div>
      ) : (
        <p className="text-xs text-ink-mute">填写身高/经验/器械/每周安排——AI 生成计划的基本输入。</p>
      )}
      {open && (
        <Modal title="基本情况" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <label className="block text-xs text-ink-mute">
              身高（cm）
              <input className="input-glow mt-1 w-full" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="168" />
            </label>
            <label className="block text-xs text-ink-mute">
              训练经验
              <input className="input-glow mt-1 w-full" value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="力量零基础，跑步有基础" maxLength={60} />
            </label>
            <label className="block text-xs text-ink-mute">
              器械条件（顿号分隔）
              <input className="input-glow mt-1 w-full" value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="健身房、哑铃、杠铃、器械" />
            </label>
            <label className="block text-xs text-ink-mute">
              每周安排
              <input className="input-glow mt-1 w-full" value={weeklyDays} onChange={(e) => setWeeklyDays(e.target.value)} placeholder="周中 3 练力量 + 跑步按佳明" maxLength={60} />
            </label>
            <label className="block text-xs text-ink-mute">
              约束 / 伤病
              <input className="input-glow mt-1 w-full" value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="膝盖上楼偶有不适" maxLength={200} />
            </label>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50" onClick={save} disabled={busy}>
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** 目标&档案 tab 主体 */
export default function FitnessArchive({
  modules,
  goals,
  profile,
  exercises,
  onGoalsChanged,
  onProfileChanged,
}: {
  modules: FitnessModule[];
  goals: FitnessGoal[];
  profile: FitnessProfile | null;
  exercises: FitnessExercise[];
  onGoalsChanged: () => void;
  onProfileChanged: () => void;
}) {
  const [modFilter, setModFilter] = useState<string>("all");
  const shown = useMemo(() => (modFilter === "all" ? exercises : exercises.filter((e) => e.module_code === modFilter)), [modFilter, exercises]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {modules.map((m) => (
          <GoalCard key={m.code} mod={m} goal={goals.find((g) => g.module_code === m.code && g.status === "active")} onSaved={onGoalsChanged} />
        ))}
      </div>
      <ProfileForm profile={profile} onSaved={onProfileChanged} />

      <section className="rounded-2xl border border-line-soft bg-surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">📚 动作库</h3>
          <div className="flex gap-1">
            {[
              { k: "all", label: "全部" },
              ...modules.map((m) => ({ k: m.code, label: m.name })),
            ].map((f) => (
              <button
                key={f.k}
                className={`tap-lg rounded-full px-2.5 py-1 text-xs transition ${
                  modFilter === f.k ? "bg-sky-500/15 font-medium text-sky-600 dark:text-sky-400" : "text-ink-mute hover:bg-wash"
                }`}
                onClick={() => setModFilter(f.k)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {shown.map((e) => (
            <div key={e.id} className="rounded-xl border border-line-soft/60 bg-wash/40 p-3">
              <p className="text-sm font-medium">
                {e.name}
                <span className="ml-2 text-[10px] text-ink-mute">{e.equipment ?? ""}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-mute">
                主练：{e.muscle_primary.join("、")}
                {e.muscle_secondary.length ? ` · 兼带：${e.muscle_secondary.join("、")}` : ""}
              </p>
              <p className="mt-1 text-xs leading-relaxed">{e.benefit}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
