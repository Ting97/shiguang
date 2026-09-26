import { useState } from "react";
import { View, Text } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { loadContactDetail, yuan } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { birthdayBadge, GROUP_EMOJI, IMPORTANCE_LABEL, TYPE_EMOJI } from "../shared";
import "./index.scss";

/**
 * 详情契约（grep apps/api/src/server/people/service.ts contactDetail + repo.ts 查证）：
 * GET /api/contacts/:id → {
 *   contact:  {id,name,alias,group_tag,birthday,birthday_cal,lunar_month,lunar_day,lunar_leap,
 *              anniversary,intimacy,importance,notes,created_at,ai_profile,ai_profile_at},
 *   timeline: [{id,type,summary,occurred_at,created_at,entry_text,tx_amount_cents,tx_direction,tx_category}]
 *             （往来时间线：left join 来源动态原文与关联流水，倒序 ≤100 条）,
 *   money:    [{id,direction,amount_cents,category,note,occurred_at}]（人情往来流水，≤50 条）
 * }
 * /api/contacts/:id/interactions 独立端点虽存在，但只回往来行本身；timeline 已含动态原文与金额，直接用。
 * 404（联系人不存在/已删除）走 catch 的 e.message 展示。
 */
interface TimelineRow {
  id: string;
  type?: string;
  summary?: string | null;
  occurred_at?: string | null;
  created_at?: string;
  entry_text?: string | null;
  tx_amount_cents?: number | string | null;
  tx_direction?: string | null;
  tx_category?: string | null;
}

/** timestamptz → 北京 M/D（occurred_at 可能被置 null，回退 created_at 再回退空串） */
function bjDay(iso?: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(5, 10).replace("-", "/");
}

export default function ContactDetailPage() {
  const router = Taro.useRouter();
  const id = router.params.id ?? "";

  const [contact, setContact] = useState<Record<string, any> | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [money, setMoney] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  async function refresh() {
    if (!id) return;
    try {
      const j = await loadContactDetail(id);
      setContact(j.contact ?? null);
      setTimeline(j.timeline ?? []);
      setMoney(j.money ?? []);
      setMsg(null);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
  }

  if (!inited && getSessionToken() && id) {
    setInited(true);
    void refresh();
  }

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh());
  });

  if (!contact) {
    return (
      <View className="page-pad">
        {/* 无 id（异常入口）直接当加载失败，避免停在"加载中…" */}
        {!id && <View className="banner banner-err">缺少联系人 id</View>}
        {id && msg && <View className="banner banner-err">{msg}</View>}
        {id && !msg && <View className="card"><Text className="dim">加载中…</Text></View>}
      </View>
    );
  }

  // 人情净额口径 = 列表页 gift_net_cents 的 SQL：out（送出）为负、其余为正（amount_cents 是 bigint 可能串化，先 Number）
  const netCents = money.reduce((acc, m) => acc + (m.direction === "out" ? -Number(m.amount_cents) : Number(m.amount_cents)), 0);
  const imp = contact.importance != null ? IMPORTANCE_LABEL[Number(contact.importance)] ?? "普通" : null;
  const bd = birthdayBadge(contact);
  const intimacy = contact.intimacy != null && Number(contact.intimacy) > 0 ? Number(contact.intimacy) : null;

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}

      {/* 档案头 */}
      <View className="card">
        <View className="head-row">
          <View className="avatar">
            <Text>{String(contact.name ?? "?").slice(0, 1)}</Text>
          </View>
          <View className="grow">
            <View className="name-line">
              <Text className="name">{contact.name}</Text>
              {imp && Number(contact.importance) >= 4 && <Text className="imp-tag">{imp}⭐</Text>}
            </View>
            {!!contact.alias && contact.alias !== contact.name && <Text className="dim">备注名 {contact.alias}</Text>}
          </View>
        </View>

        <View className="fields">
          <View className="field">
            <Text className="dim">分组</Text>
            <Text>{GROUP_EMOJI[contact.group_tag ?? ""] ?? "👤"} {contact.group_tag ?? "其他"}</Text>
          </View>
          <View className="field">
            <Text className="dim">重要度</Text>
            <Text>{imp ?? "-"}{contact.importance != null ? `（${contact.importance}/5）` : ""}</Text>
          </View>
          {intimacy != null && (
            <View className="field">
              <Text className="dim">亲密度</Text>
              <Text>{intimacy}/100</Text>
            </View>
          )}
          {(bd || contact.birthday) && (
            <View className="field">
              <Text className="dim">生日</Text>
              <Text>{contact.birthday && contact.birthday_cal !== "lunar" ? contact.birthday : ""}{bd ? ` ${bd}` : ""}</Text>
            </View>
          )}
          {contact.anniversary && (
            <View className="field">
              <Text className="dim">纪念日</Text>
              <Text>{contact.anniversary}</Text>
            </View>
          )}
          {!!contact.notes && (
            <View className="field col">
              <Text className="dim">档案备注</Text>
              <Text className="notes">{contact.notes}</Text>
            </View>
          )}
          <View className="field">
            <Text className="dim">人情往来净额</Text>
            {/* 正=收多（绿），负=送多（红）；0 或无人情账显示中性 */}
            <Text className={netCents > 0 ? "money-in" : netCents < 0 ? "money-out" : ""}>
              {money.length === 0 ? "暂无" : `${netCents > 0 ? "+" : netCents < 0 ? "-" : ""}¥${yuan(Math.abs(netCents))}`}
            </Text>
          </View>
        </View>
      </View>

      {/* 互动记录（往来时间线） */}
      <View className="card">
        <Text className="h2">互动记录（{timeline.length}）</Text>
        {timeline.length === 0 && <Text className="dim">还没有往来记录 —— 记动态时提及 TA 即可自动关联</Text>}
        {timeline.map((t) => (
          <View key={t.id} className="tl-row">
            <View className="grow">
              <Text className="tl-title">
                {TYPE_EMOJI[t.type ?? ""] ?? "•"} {t.type ?? "其他"}
                {t.summary ? ` · ${t.summary}` : ""}
              </Text>
              {/* 来源动态原文（识别关联的上下文）与关联流水金额 */}
              {!!t.entry_text && <Text className="dim tl-sub">{t.entry_text}</Text>}
              {t.tx_amount_cents != null && (
                <Text className={`tl-sub ${t.tx_direction === "out" ? "money-out" : "money-in"}`}>
                  {t.tx_direction === "out" ? "-" : "+"}¥{yuan(t.tx_amount_cents)} · {t.tx_category ?? ""}
                </Text>
              )}
            </View>
            <Text className="dim">{bjDay(t.occurred_at ?? t.created_at)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
