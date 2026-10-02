/**
 * 补一笔往来弹层（= web components/contacts/interaction-form-modal.tsx 移动端形态：底部弹层）。
 * 类型 + 时间（默认北京现在）+ 一句话摘要；不涉及金额（金额走财务页记一笔并填「对方」）。
 * web 的 datetime-local → 小程序拆成日期 + 时间双 Picker。
 */
import { useState } from "react";
import { View, Text, Input, Button, Picker } from "@tarojs/components";
import { addInteraction } from "./api";
import { TYPE_EMOJI, INTERACTION_TYPES } from "../shared";
import "./interaction-modal.scss";

/** ISO → 北京 {date,time}（= web isoToBjInput；本地 getter 组串会错 8 小时） */
function bjParts(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
  };
}

/** 北京 {date,time} → ISO（显式 +08:00 解析，= web bjInputToIso） */
function toIso(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00+08:00`)).toISOString();
}

export default function InteractionModal(opts: {
  contactId: string;
  contactName: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { contactId, contactName, onClose, onSaved } = opts;
  const [type, setType] = useState("见面");
  const [summary, setSummary] = useState("");
  // 默认值与解析都走北京墙上时间口径（web 同注释）
  const now = bjParts(new Date().toISOString());
  const [date, setDate] = useState(now.date);
  const [time, setTime] = useState(now.time);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await addInteraction(contactId, { type, summary, occurredAt: toIso(date, time) });
      onSaved("🤝 已补记一笔往来");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <View className="overlay" onClick={onClose} />
      <View className="sheet it-sheet safe-bottom">
        <View className="it-head">
          <Text className="it-title">补一笔往来 · {contactName}</Text>
          <Text className="it-close" onClick={onClose}>✕</Text>
        </View>
        <View className="it-form">
          <View className="it-row">
            <Picker
              mode="selector"
              range={INTERACTION_TYPES.map((t) => `${TYPE_EMOJI[t]} ${t}`)}
              value={Math.max(0, INTERACTION_TYPES.indexOf(type as (typeof INTERACTION_TYPES)[number]))}
              onChange={(e) => setType(INTERACTION_TYPES[Number(e.detail.value)])}
            >
              <View className="it-pick"><Text>{TYPE_EMOJI[type] ?? "•"} {type}</Text></View>
            </Picker>
            <Picker mode="date" value={date} onChange={(e) => setDate(e.detail.value)}>
              <View className="it-pick flex1"><Text>{date}</Text></View>
            </Picker>
            <Picker mode="time" value={time} onChange={(e) => setTime(e.detail.value)}>
              <View className="it-pick"><Text>{time}</Text></View>
            </Picker>
          </View>
          <Input
            className="input it-summary"
            value={summary}
            placeholder="记点什么（如：一起看了场电影）"
            placeholderClass="input-placeholder"
            onInput={(e) => setSummary(e.detail.value)}
          />
          {!!err && <Text className="it-err">{err}</Text>}
          <View className="it-foot">
            <Button className="btn-reset it-cancel" hoverClass="press" onClick={onClose}>取消</Button>
            <Button
              className={`btn-reset btn-primary it-save ${busy ? "disabled" : ""}`}
              hoverClass="press"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "记入"}
            </Button>
          </View>
        </View>
      </View>
    </>
  );
}
