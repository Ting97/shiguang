/**
 * 建档/编辑联系人弹层（= web components/contact-form.tsx 移动端形态：底部弹层 glass p-5）。
 * 列表页（建档）与 TA 档案页（编辑）共用。
 * 生日双历法：阳历=日期选择；农历=月/日选择 + 闰月标记（payload 同 web birthdayPayload）。
 * web 的 <select> → Taro Picker；type=date → Picker mode=date。
 */
import { useState } from "react";
import { View, Text, Input, Textarea, Button, Picker } from "@tarojs/components";
import LucideIcon from "../../components/lucide-icon";
import { request } from "@/lib/request";
import type { ContactRow } from "./shared";
import {
  CONTACT_GROUPS,
  GROUP_EMOJI,
  IMPORTANCE_TIERS,
  importanceLabel,
  lunarDayLabel,
  lunarMonthLabel,
} from "./shared";
import "./form-modal.scss";

const LUNAR_MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const LUNAR_DAY_OPTIONS = Array.from({ length: 30 }, (_, i) => i + 1);

export default function ContactFormModal(opts: {
  initial: ContactRow | null; // null=新建
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { initial, onClose, onSaved } = opts;
  const [name, setName] = useState(initial?.name ?? "");
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [group, setGroup] = useState(initial?.group_tag ?? "朋友");
  const [bdayCal, setBdayCal] = useState<"solar" | "lunar">(initial?.birthday_cal === "lunar" ? "lunar" : "solar");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [lunarMonth, setLunarMonth] = useState(initial?.lunar_month ?? 1);
  const [lunarDay, setLunarDay] = useState(initial?.lunar_day ?? 1);
  const [lunarLeap, setLunarLeap] = useState(!!initial?.lunar_leap);
  const [anniversary, setAnniversary] = useState(initial?.anniversary ?? "");
  const [importance, setImportance] = useState(initial?.importance ?? 3);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** 生日字段统一打包（= web birthdayPayload） */
  const birthdayPayload = () => ({
    birthdayCal: bdayCal,
    birthday: bdayCal === "solar" ? birthday || null : null,
    lunarMonth: bdayCal === "lunar" ? lunarMonth : undefined,
    lunarDay: bdayCal === "lunar" ? lunarDay : undefined,
    lunarLeap: bdayCal === "lunar" ? lunarLeap : undefined,
  });

  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setErr(null);
    const body = {
      name: name.trim(),
      alias,
      group,
      ...birthdayPayload(),
      anniversary: anniversary || null,
      importance,
      notes,
    };
    try {
      if (initial) {
        await request(`/api/contacts/${initial.id}`, { method: "PATCH", body });
        onSaved("💾 档案已更新");
      } else {
        await request("/api/contacts", { method: "POST", body });
        onSaved(`✅ 已建档：${name.trim()}`);
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View className="overlay" onClick={onClose} />
      <View className="sheet cf-sheet safe-bottom">
        <View className="cf-head">
          <Text className="cf-title">{initial ? "编辑联系人" : "新建联系人"}</Text>
          <View className="cf-close" onClick={onClose}>
            <LucideIcon name="x" size={14} color="var(--ink-dim)" />
          </View>
        </View>
        <View className="cf-form">
          {/* 姓名 + 备注名（= web 双 input 行） */}
          <View className="cf-row">
            <Input
              className="input cf-input"
              value={name}
              maxlength={30}
              focus
              placeholder="姓名（必填）"
              placeholderClass="input-placeholder"
              onInput={(e) => setName(e.detail.value)}
            />
            <Input
              className="input cf-input"
              value={alias ?? ""}
              placeholder="备注名（如：老王）"
              placeholderClass="input-placeholder"
              onInput={(e) => setAlias(e.detail.value)}
            />
          </View>
          {/* 分组 + 纪念日（= web select + date 行） */}
          <View className="cf-row">
            <Picker
              mode="selector"
              range={CONTACT_GROUPS.map((g) => `${GROUP_EMOJI[g]} ${g}`)}
              value={Math.max(0, CONTACT_GROUPS.indexOf(group as (typeof CONTACT_GROUPS)[number]))}
              onChange={(e) => setGroup(CONTACT_GROUPS[Number(e.detail.value)])}
            >
              <View className="input cf-input pick"><Text>{GROUP_EMOJI[group] ?? "👤"} {group}</Text></View>
            </Picker>
            <View className="cf-anniv">
              <Picker mode="date" value={anniversary || "2000-01-01"} onChange={(e) => setAnniversary(e.detail.value)}>
                <View className="input cf-input pick"><Text>{anniversary || "纪念日"}</Text></View>
              </Picker>
              {!!anniversary && (
                <View className="cf-anniv-clear" onClick={() => setAnniversary("")}>
                  <LucideIcon name="x" size={12} color="var(--ink-mute)" />
                </View>
              )}
            </View>
          </View>
          {/* 生日：历法切换 + 阳历日期 / 农历月日 + 闰 */}
          <View>
            <View className="cf-row">
              <View className="cf-cal">
                <View className={`cf-cal-btn ${bdayCal === "solar" ? "on" : ""}`} onClick={() => setBdayCal("solar")}>
                  <Text>阳历</Text>
                </View>
                <View className={`cf-cal-btn ${bdayCal === "lunar" ? "on" : ""}`} onClick={() => setBdayCal("lunar")}>
                  <Text>农历</Text>
                </View>
              </View>
              {bdayCal === "solar" ? (
                <View className="cf-bday">
                  <Picker mode="date" value={birthday || "2000-01-01"} onChange={(e) => setBirthday(e.detail.value)}>
                    <View className="input cf-input pick"><Text>{birthday || "生日（阳历）"}</Text></View>
                  </Picker>
                  {!!birthday && <View className="cf-anniv-clear" onClick={() => setBirthday("")}>
                  <LucideIcon name="x" size={12} color="var(--ink-mute)" />
                </View>}
                </View>
              ) : (
                <View className="cf-bday lunar">
                  <Picker
                    mode="selector"
                    range={LUNAR_MONTH_OPTIONS.map(lunarMonthLabel)}
                    value={lunarMonth - 1}
                    onChange={(e) => setLunarMonth(LUNAR_MONTH_OPTIONS[Number(e.detail.value)])}
                  >
                    <View className="input cf-input pick"><Text>{lunarMonthLabel(lunarMonth)}</Text></View>
                  </Picker>
                  <Picker
                    mode="selector"
                    range={LUNAR_DAY_OPTIONS.map(lunarDayLabel)}
                    value={lunarDay - 1}
                    onChange={(e) => setLunarDay(LUNAR_DAY_OPTIONS[Number(e.detail.value)])}
                  >
                    <View className="input cf-input pick"><Text>{lunarDayLabel(lunarDay)}</Text></View>
                  </Picker>
                  <View className={`cf-leap ${lunarLeap ? "on" : ""}`} onClick={() => setLunarLeap((v) => !v)}>
                    <Text>闰</Text>
                  </View>
                </View>
              )}
            </View>
            <Text className="cf-hint">
              {bdayCal === "lunar"
                ? "农历生日每年公历日期不同，到时提醒以农历为准 · 闰月生日无闰月年份按平月过"
                : "生日（可空）"}
            </Text>
          </View>
          {/* 重要程度（= web 五档按钮组，亲密…简单） */}
          <View>
            <Text className="cf-imp-label">
              重要程度 · 决定图谱中与你的距离 · 当前：{importanceLabel(importance)}
            </Text>
            <View className="cf-imp-row">
              {[...IMPORTANCE_TIERS].reverse().map((t) => (
                <View
                  key={t.level}
                  className={`cf-imp-btn ${importance === t.level ? "on" : ""}`}
                  onClick={() => setImportance(t.level)}
                >
                  <Text>{t.label}</Text>
                </View>
              ))}
            </View>
          </View>
          <Textarea
            className="cf-notes"
            value={notes ?? ""}
            maxlength={2000}
            autoHeight
            placeholder="备注：喜好/忌讳/重要的事…"
            placeholderClass="input-placeholder"
            onInput={(e) => setNotes(e.detail.value)}
          />
          {!!err && <Text className="cf-err">{err}</Text>}
          <View className="cf-foot">
            <Button className="btn-reset cf-cancel" hoverClass="press" onClick={onClose}>取消</Button>
            <Button
              className={`btn-reset btn-primary cf-save ${busy || !name.trim() ? "disabled" : ""}`}
              hoverClass="press"
              disabled={busy || !name.trim()}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : initial ? "保存" : "建档"}
            </Button>
          </View>
        </View>
      </View>
    </>
  );
}
