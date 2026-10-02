/**
 * 空间头部卡（= web detail/header-card.tsx）：
 * icon 圆底 + 名称就地重命名（InlineRename）+ 目标到期就地编辑（⏳ 日期可调/清）+
 * 「‹ 返回」文字链（web ← 列表 同位置；小程序用 navigateBack）+ ⋯ 菜单入口 + 双进度概览。
 */
import { useState } from "react";
import { View, Text, Input, Button, Picker } from "@tarojs/components";
import Taro from "@tarojs/taro";
import type { SpaceRow } from "../shared";
import { bjDate, bjToday, daysOf } from "../shared";
import "./header-card.scss";

export default function HeaderCard(opts: {
  space: SpaceRow;
  /** 重命名提交（false=失败保持编辑态，= web InlineRename onSave） */
  onRename: (name: string) => Promise<boolean>;
  /** 目标到期保存/清除（null=清除；false=失败保持编辑态） */
  onSaveTargetDate: (v: string | null) => Promise<boolean>;
  onOpenMenu: () => void;
}) {
  const { space, onRename, onSaveTargetDate, onOpenMenu } = opts;
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // 目标到期就地编辑（头部 ⏳ 日期可点击调整/清除）
  const [dateEdit, setDateEdit] = useState(false);
  const [dateDraft, setDateDraft] = useState("");

  const color = space.color || "#38bdf8";
  const todoProgress = space.todo_total ? Math.round(((space.todo_done ?? 0) / space.todo_total) * 100) : null;
  const actionProgress = space.action_total ? Math.round(((space.action_done ?? 0) / space.action_total) * 100) : null;
  const days = daysOf(space.started_at);

  async function saveRename() {
    if (busy) return;
    const name = nameDraft.trim();
    if (!name) {
      Taro.showToast({ title: "名称不能为空", icon: "none" });
      return;
    }
    setBusy(true);
    const ok = await onRename(name).finally(() => setBusy(false));
    if (ok) setRenaming(false);
  }

  return (
    <View className="glass glass-p5 hd-card">
      <View className="hd-top">
        <View className="hd-icon" style={{ backgroundColor: `${color}26` }}>
          <Text className="hd-icon-emoji">{space.icon || "🎯"}</Text>
        </View>
        <View className="hd-mid">
          {renaming ? (
            <View className="hd-rename">
              <Input
                className="input hd-rename-input"
                value={nameDraft}
                maxlength={40}
                focus
                onInput={(e) => setNameDraft(e.detail.value)}
              />
              <Text className="hd-rename-ok" onClick={() => void saveRename()}>✓</Text>
              <Text className="hd-rename-cancel" onClick={() => setRenaming(false)}>✕</Text>
            </View>
          ) : (
            <View
              className="hd-name-row"
              onClick={() => {
                setNameDraft(space.name);
                setRenaming(true);
              }}
            >
              <Text className="hd-name">{space.name}</Text>
              <Text className="hd-name-pen">✏️</Text>
            </View>
          )}
          {!!space.description && <Text className="hd-desc">{space.description}</Text>}
          <View className="hd-meta">
            {!!space.started_at && <Text>{bjDate(space.started_at)} 开始</Text>}
            {dateEdit ? (
              <View className="hd-date-edit">
                <Picker mode="date" value={dateDraft || bjToday()} onChange={(e) => setDateDraft(e.detail.value)}>
                  <View className="hd-date-input">
                    <Text>{dateDraft || "选日期"}</Text>
                  </View>
                </Picker>
                <Text
                  className="hd-date-save"
                  onClick={() => {
                    void onSaveTargetDate(dateDraft || null).then((ok) => ok && setDateEdit(false));
                  }}
                >
                  保存
                </Text>
                {!!space.target_date && (
                  <Text
                    className="hd-date-clear"
                    onClick={() => {
                      void onSaveTargetDate(null).then((ok) => ok && setDateEdit(false));
                    }}
                  >
                    清除
                  </Text>
                )}
              </View>
            ) : (
              <Text
                className="hd-date-btn"
                onClick={() => {
                  setDateDraft(space.target_date ? bjDate(space.target_date) : "");
                  setDateEdit(true);
                }}
              >
                {space.target_date ? (
                  <Text className={bjDate(space.target_date) < bjToday() ? "overdue" : ""}>
                    ⏳ {bjDate(space.target_date)}
                    {bjDate(space.target_date) < bjToday() ? " 已过期" : ""}
                  </Text>
                ) : (
                  <Text className="hd-date-none">＋ 设目标</Text>
                )}
              </Text>
            )}
            {days != null && <Text>第 {days} 天</Text>}
          </View>
        </View>
        <View className="hd-actions">
          {/* web 同位置的「← 列表」返回链 → 小程序返回上一页；无上级栈（直达落地）兜底回列表 */}
          <Text
            className="hd-back"
            onClick={() =>
              Taro.navigateBack().catch(() => Taro.redirectTo({ url: "/packages/space/list/index" }))
            }
          >
            ‹ 返回
          </Text>
          <Text className="hd-more" onClick={onOpenMenu}>⋯</Text>
        </View>
      </View>
      {/* 进度概览：todo（空间主色）/ 行动（emerald）双条 */}
      <View className="hd-prog-grid">
        <View>
          <View className="hd-prog-label">
            <Text>todo 完成率</Text>
            <Text>{todoProgress == null ? "—" : `${space.todo_done}/${space.todo_total} · ${todoProgress}%`}</Text>
          </View>
          <View className="hd-prog-bar">
            <View className="hd-prog-fill" style={{ width: `${todoProgress ?? 0}%`, backgroundColor: color }} />
          </View>
        </View>
        <View>
          <View className="hd-prog-label">
            <Text>行动完成率</Text>
            <Text>{actionProgress == null ? "—" : `${space.action_done}/${space.action_total} · ${actionProgress}%`}</Text>
          </View>
          <View className="hd-prog-bar">
            <View className="hd-prog-fill emerald" style={{ width: `${actionProgress ?? 0}%` }} />
          </View>
        </View>
      </View>
    </View>
  );
}
