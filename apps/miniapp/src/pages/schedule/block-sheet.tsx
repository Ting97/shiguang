/**
 * 时间块编辑/补录弹层（= web block-editor.tsx + block-draft-form.tsx 的 overlay+sheet 形态）：
 * - BlockEditSheet：改标题/起止/分类，两步删除（3 秒内再点才真删，= web armDelete）；
 * - BlockDraftSheet：缺口补录表单（琥珀色调 = web border-amber），校验错误就地提示。
 * 时间用原生 Picker mode=time（对齐 web input type=time），分类用 selector picker（对齐 web select）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input, Picker, Text, View } from "@tarojs/components";
import type { Activity } from "./api";

export interface BlockDraft {
  id: string;
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}

export interface BlockDraftValue {
  title: string;
  start: string; // HH:MM
  end: string; // HH:MM
  activityId: string;
}

/** 分类 selector 的选中序号（id ↔ index 互查） */
function actIndex(activities: Activity[], id: string): number {
  const i = activities.findIndex((a) => a.id === id);
  return i >= 0 ? i : 0;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="bs-field">
      <Text className="bs-field-label">{label}</Text>
      {children}
    </View>
  );
}

/* ================= 编辑块（= web BlockEditor） ================= */

export function BlockEditSheet({
  draft,
  activities,
  onChange,
  onSave,
  onCancel,
  onDelete,
  saving,
  deleting,
}: {
  draft: BlockDraft;
  activities: Activity[];
  onChange: (d: BlockDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  saving?: boolean;
  deleting?: boolean;
}) {
  // 删除两步确认：首次点按只进入待确认态（3 秒内再点才真删）
  const [armDelete, setArmDelete] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    },
    [],
  );

  function onDeleteClick() {
    if (armDelete) {
      if (armTimer.current) clearTimeout(armTimer.current);
      onDelete();
      return;
    }
    setArmDelete(true);
    armTimer.current = setTimeout(() => setArmDelete(false), 3000);
  }

  const act = activities[actIndex(activities, draft.activityId)];

  return (
    <View>
      <View className="overlay" onTap={onCancel} />
      <View className="sheet">
        <View className="sheet-bar" />
        <Text className="sheet-title">修改日程块</Text>
        <Field label="标题">
          <Input
            className="bs-input"
            value={draft.title}
            maxlength={100}
            placeholder="标题"
            placeholderClass="input-placeholder"
            onInput={(e) => onChange({ ...draft, title: e.detail.value })}
            onConfirm={onSave}
          />
        </Field>
        <View className="bs-times">
          <Field label="开始">
            <Picker mode="time" value={draft.start} onChange={(e) => onChange({ ...draft, start: e.detail.value })}>
              <View className="bs-input bs-picker">{draft.start}</View>
            </Picker>
          </Field>
          <Text className="bs-to">至</Text>
          <Field label="结束">
            <Picker mode="time" value={draft.end} onChange={(e) => onChange({ ...draft, end: e.detail.value })}>
              <View className="bs-input bs-picker">{draft.end}</View>
            </Picker>
          </Field>
        </View>
        <Field label="分类">
          <Picker
            mode="selector"
            range={activities.map((a) => `${a.icon} ${a.name}`)}
            value={actIndex(activities, draft.activityId)}
            onChange={(e) => onChange({ ...draft, activityId: activities[Number(e.detail.value)]?.id ?? draft.activityId })}
          >
            <View className="bs-input bs-picker">{act ? `${act.icon} ${act.name}` : "选择分类"}</View>
          </Picker>
        </Field>
        <View className="bs-actions">
          {deleting ? (
            <Text className="bs-btn bs-btn-danger grow disabled">删除中…</Text>
          ) : armDelete ? (
            <View className="bs-btn bs-btn-armed grow" onTap={onDeleteClick}>
              确认删除？
            </View>
          ) : (
            <View className="bs-btn bs-btn-danger grow" onTap={onDeleteClick}>
              删除
            </View>
          )}
          <View className="bs-btn bs-btn-mute" onTap={onCancel}>
            取消
          </View>
          <View
            className={`bs-btn bs-btn-save grow ${saving ? "disabled" : ""}`}
            onTap={saving ? undefined : onSave}
          >
            {saving ? "保存中…" : "保存"}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ================= 补录块（= web BlockDraftForm） ================= */

export function BlockDraftSheet({
  value,
  activities,
  busy,
  err,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: BlockDraftValue;
  activities: Activity[];
  busy?: boolean;
  err?: string | null;
  onChange: (v: BlockDraftValue) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const act = activities[actIndex(activities, value.activityId)];
  return (
    <View>
      <View className="overlay" onTap={onCancel} />
      <View className="sheet sheet-amber">
        <View className="sheet-bar" />
        <Text className="sheet-title">
          补录 <Text className="tabnum">{value.start}–{value.end}</Text>
        </Text>
        <Input
          className="bs-input"
          value={value.title}
          maxlength={100}
          placeholder="这段时间在做什么？"
          placeholderClass="input-placeholder"
          onInput={(e) => onChange({ ...value, title: e.detail.value })}
          onConfirm={onSubmit}
        />
        <View className="bs-times">
          <Picker mode="time" value={value.start} onChange={(e) => onChange({ ...value, start: e.detail.value })}>
            <View className="bs-input bs-picker">{value.start}</View>
          </Picker>
          <Text className="bs-to">至</Text>
          <Picker mode="time" value={value.end} onChange={(e) => onChange({ ...value, end: e.detail.value })}>
            <View className="bs-input bs-picker">{value.end}</View>
          </Picker>
        </View>
        <Picker
          mode="selector"
          range={activities.map((a) => `${a.icon} ${a.name}`)}
          value={actIndex(activities, value.activityId)}
          onChange={(e) => onChange({ ...value, activityId: activities[Number(e.detail.value)]?.id ?? value.activityId })}
        >
          <View className="bs-input bs-picker">{act ? `${act.icon} ${act.name}` : "选择分类"}</View>
        </Picker>
        {err && <Text className="bs-err">{err}</Text>}
        <View className="bs-actions">
          <View className="bs-btn bs-btn-mute" onTap={onCancel}>
            取消
          </View>
          <View
            className={`bs-btn bs-btn-amber grow ${busy || !value.title.trim() ? "disabled" : ""}`}
            onTap={busy || !value.title.trim() ? undefined : onSubmit}
          >
            {busy ? "保存中…" : "补录"}
          </View>
        </View>
      </View>
    </View>
  );
}
