/**
 * 联系人档案（= web contacts/[id]/detail.tsx 移动端形态）：
 * 「‹ 返回人际」文字链 → glass 头卡（emoji 圆头像 + 名称/别名/分组 TagChip/重要度渐变徽标 +
 * 生日/纪念日/往来次数/收送金额 TagChip + ✏️编辑/🗑两步删除）→ 亲密度渐变进度条（sky→pink）+ notes
 * → AI 交往画像卡（btn-purple-tinted 提炼；💚喜欢/⚠️忌讳/📌记住 彩色小徽）
 * → 一起经历过的事时间线（🤝 等类型圆点 + 连接线 + 摘要/金额）→ 关联人情账
 * → 编辑弹层（form-modal）/ 补一笔往来弹层（interaction-modal）。
 */
import { useEffect, useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import LucideIcon from "@/components/lucide-icon";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import { showToast } from "@/components/toast";
import { loadContactDetail, yuan } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import ContactFormModal from "../form-modal";
import InteractionModal from "./interaction-modal";
import { deleteContact, generateAiProfile, type AiProfile } from "./api";
import type { ContactRow } from "../shared";
import {
  GROUP_EMOJI,
  GROUP_TONE,
  TYPE_EMOJI,
  birthdayInfoOf,
  bjMDHM,
  displaySummary,
  importanceLabel,
  toneClass,
  useArmConfirm,
  zhDay,
} from "../shared";
import "./index.scss";

/** 删除/归档后的回列表：优先 navigateBack（入口是列表 navigateTo，栈里还有列表实例——
 * redirectTo 会再压一份新列表成 [list, list]，物理返回落在旧实例），栈空（分享直达）兜底 redirectTo */
function backToList(url: string) {
  Taro.navigateBack().catch(() => Taro.redirectTo({ url }));
}

/** 时间线行（= web TimelineItem） */
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
/** 人情账行（= web MoneyItem） */
interface MoneyRow {
  id: string;
  direction: "out" | "in";
  amount_cents: number | string;
  category: string;
  note?: string | null;
  occurred_at: string;
}

export default function ContactDetailPage() {
  const router = Taro.useRouter();
  const id = router.params.id ?? "";

  const [contact, setContact] = useState<ContactRow | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [money, setMoney] = useState<MoneyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0); // 重试信号：bump 触发重载
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [profiling, setProfiling] = useState(false); // AI 交往画像生成中
  const armDelete = useArmConfirm();
  const [inited, setInited] = useState(false);

  async function load() {
    const j = await loadContactDetail(id);
    setContact((j.contact as ContactRow) ?? null);
    setTimeline((j.timeline as TimelineRow[]) ?? []);
    setMoney((j.money as MoneyRow[]) ?? []);
  }

  useEffect(() => {
    if (!inited || !id) return;
    let stale = false;
    setLoading(true);
    setLoadErr(null);
    load()
      .catch((e: any) => {
        if (stale) return;
        // 404 才是「不存在」；其余失败置错误态（信息可见 + 重试），不伪装成 404
        if (e?.status === 404) setContact(null);
        else setLoadErr(e?.message ?? String(e));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inited, id, rev]);

  // inited 置位移入 effect（render 期 setState 在并发下不可靠）；游客在下方渲染层早退
  useEffect(() => {
    if (!inited) setInited(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullDownRefresh(() => {
    load()
      .catch((e: any) => setLoadErr(e?.message ?? String(e)))
      .finally(() => Taro.stopPullDownRefresh());
  });

  // 游客无服务端只读通道（/api 全 401）：给出登录引导出口（全部 hooks 之后早退）
  if (!getSessionToken()) {
    return (
      <PageShell active="contacts">
        <GuestGate title="联系人档案" desc="往来记录、人情账与生日提醒" />
      </PageShell>
    );
  }

  async function runProfile() {
    if (profiling) return;
    setProfiling(true);
    try {
      const j = await generateAiProfile(id);
      setContact((c) => (c ? { ...c, ai_profile: j.profile as AiProfile, ai_profile_at: new Date().toISOString() } : c));
      showToast({ type: "ok", text: "✨ 交往画像已更新" });
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setProfiling(false);
    }
  }

  async function removeContact() {
    if (!contact || !armDelete.arm(contact.id)) return;
    try {
      await deleteContact(contact.id);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? String(e) });
      return;
    }
    backToList("/packages/contact/list/index");
  }

  /* ---- 加载 / 失败 / 404 形态（= web detail 三分支） ---- */
  if (!inited || loading) {
    return (
      <PageShell active="contacts">
        <View className="cd-skel">
          {[0, 1, 2].map((i) => (
            <View key={i} className="skeleton cd-skel-row" />
          ))}
        </View>
      </PageShell>
    );
  }
  if (loadErr) {
    return (
      <PageShell active="contacts">
        <View className="cd-center">
          <Text className="cd-load-err">加载失败：{loadErr}</Text>
          <Button className="btn-reset btn-primary cd-retry" hoverClass="press" onClick={() => setRev((r) => r + 1)}>
            重试
          </Button>
        </View>
      </PageShell>
    );
  }
  if (!contact) {
    return (
      <PageShell active="contacts">
        <Text className="cd-notfound">联系人不存在</Text>
      </PageShell>
    );
  }

  const bd = birthdayInfoOf(contact);
  const giftIn = money.filter((m) => m.direction === "in").reduce((s, m) => s + Number(m.amount_cents), 0);
  const giftOut = money.filter((m) => m.direction === "out").reduce((s, m) => s + Number(m.amount_cents), 0);
  const tone = GROUP_TONE[contact.group_tag ?? ""] ?? "sky";
  const profile = contact.ai_profile ?? null;

  return (
    <PageShell active="contacts">
      {/* 返回链（web 同位置 ← 返回人际）；无上级栈（直达落地）时兜底回列表 */}
      <Text
        className="cd-back"
        onClick={() =>
          Taro.navigateBack().catch(() => Taro.redirectTo({ url: "/packages/contact/list/index" }))
        }
      >
        ‹ 返回人际
      </Text>

      {/* 档案头卡 */}
      <View className="glass glass-p5 cd-card">
        <View className="cd-top">
          <View className={`cd-avatar tone-bg-${tone}`}>
            <Text>{GROUP_EMOJI[contact.group_tag ?? ""] ?? "👤"}</Text>
          </View>
          <View className="cd-mid">
            <View className="cd-name-row">
              <Text className="cd-name">{contact.name}</Text>
              {!!contact.alias && <Text className="cd-alias">（{contact.alias}）</Text>}
            </View>
            <View className="cd-chips">
              <Text className={`chip cd-chip ${toneClass(tone)}`}>{contact.group_tag ?? "其他"}</Text>
              {/* 重要度渐变徽标（sky→indigo 20%） */}
              <Text className="cd-imp">{importanceLabel(Number(contact.importance ?? 3))}</Text>
            </View>
            <View className="cd-facts">
              {bd && (
                <>
                  <View className={`chip cd-chip tone-rose ico-row`}>
                  <LucideIcon name="cake" size={11} color="currentColor" />
                  <Text>生日 {bd.date}</Text>
                </View>
                  {bd.countdown != null && (
                    <Text className="cd-bd-count">
                      · {bd.countdown === 0 ? "今天生日" : bd.countdown === 1 ? "明天生日" : `${bd.countdown} 天后生日`}
                    </Text>
                  )}
                </>
              )}
              {!!contact.anniversary && (
                <View className="chip cd-chip tone-rose ico-row">
                  <LucideIcon name="heart" size={11} color="currentColor" />
                  <Text>
                    纪念日 {Number(String(contact.anniversary).slice(5, 7))}月{Number(String(contact.anniversary).slice(8, 10))}日
                  </Text>
                </View>
              )}
              <View className="chip cd-chip tone-sky ico-row">
                <LucideIcon name="calendar_days" size={11} color="currentColor" />
                <Text>{timeline.length} 次往来</Text>
              </View>
              {money.length > 0 && (
                <View className="chip cd-chip tone-rose ico-row">
                  <LucideIcon name="coins" size={11} color="currentColor" />
                  <Text>收 ¥{yuan(giftIn)} / 送 ¥{yuan(giftOut)}</Text>
                </View>
              )}
            </View>
          </View>
          <View className="cd-ops">
            <View className="cd-op" onClick={() => setEditing(true)}>
              <LucideIcon name="pencil" size={12} color="var(--accent)" />
            </View>
            <View
              className={`cd-op del ${armDelete.armedId ? "armed" : ""}`}
              onClick={() => void removeContact()}
            >
              {armDelete.armedId ? "确认删除?" : <LucideIcon name="trash_2" size={12} color="var(--danger)" />}
            </View>
          </View>
        </View>
        {/* 亲密度（渐变进度条 from-sky-500 to-pink-400） */}
        <View className="cd-intimacy">
          <View className="cd-intimacy-label">
            <Text>亲密度</Text>
            <Text>{Number(contact.intimacy ?? 0)}/100</Text>
          </View>
          <View className="cd-intimacy-bar">
            <View className="cd-intimacy-fill" style={{ width: `${Number(contact.intimacy ?? 0)}%` }} />
          </View>
        </View>
        {!!contact.notes && <Text className="cd-notes">{contact.notes}</Text>}
      </View>

      {/* AI 交往画像卡 */}
      <View className="glass glass-p5 cd-card">
        <View className="cd-sec-head">
          <View className="cd-sec-title ico-row">
            <LucideIcon name="sparkles" size={13} color="var(--ai)" />
            <Text>
              AI 交往画像
              {!!contact.ai_profile_at && <Text className="cd-sec-sub"> 提炼于 {bjMDHM(contact.ai_profile_at)}</Text>}
            </Text>
          </View>
          <Button
            className={`btn-reset btn-purple-tinted cd-profile-btn ${profiling ? "disabled" : ""}`}
            hoverClass="press"
            disabled={profiling}
            onClick={() => void runProfile()}
          >
            {profiling ? "提炼中…" : profile ? "重新提炼" : "提炼交往画像"}
          </Button>
        </View>
        {profiling && (
          <Text className="cd-profiling">正在通读往来记录，总结喜好 / 忌讳 / 值得记住的事…</Text>
        )}
        {!profiling && !profile && (
          <Text className="cd-profile-empty">
            让 AI 通读与 TA 的往来记录和人情账，提炼交往风格、喜好与忌讳 —— 见面前扫一眼。
          </Text>
        )}
        {!profiling && profile && (
          <View className="cd-profile">
            <Text className="cd-profile-summary">{profile.summary}</Text>
            {!!profile.likes?.length && (
              <View className="cd-profile-row">
                <View className="cd-profile-label ok ico-row">
                  <LucideIcon name="heart" size={11} color="var(--success)" />
                  <Text>喜欢</Text>
                </View>
                {profile.likes.map((x) => (
                  <Text key={x} className="chip cd-mini ok">{x}</Text>
                ))}
              </View>
            )}
            {!!profile.dislikes?.length && (
              <View className="cd-profile-row">
                <View className="cd-profile-label bad ico-row">
                  <LucideIcon name="triangle_alert" size={11} color="var(--danger)" />
                  <Text>忌讳</Text>
                </View>
                {profile.dislikes.map((x) => (
                  <Text key={x} className="chip cd-mini bad">{x}</Text>
                ))}
              </View>
            )}
            {!!profile.facts?.length && (
              <View className="cd-profile-row">
                <View className="cd-profile-label acc ico-row">
                  <LucideIcon name="star" size={11} color="var(--warn)" />
                  <Text>记住</Text>
                </View>
                {profile.facts.map((x) => (
                  <Text key={x} className="chip cd-mini acc">{x}</Text>
                ))}
              </View>
            )}
          </View>
        )}
      </View>

      {/* 一起经历过的事（往来时间线） */}
      <View className="glass glass-p5 cd-card">
        <View className="cd-sec-head">
          <View className="cd-sec-title ico-row">
            <LucideIcon name="clock" size={13} color="var(--accent)" />
            <Text>
              一起经历过的事
              <Text className="cd-sec-sub"> 来自动态识别 + 手动补记</Text>
            </Text>
          </View>
          <Button className="btn-reset btn-sky-tinted cd-add-btn" hoverClass="press" onClick={() => setAdding(true)}>
            ＋ 补一笔往来
          </Button>
        </View>
        {timeline.length === 0 ? (
          <Text className="cd-tl-empty">
            还没有往来记录 —— 动态里提到「{contact.name}」会自动记入，或点右上角补一笔
          </Text>
        ) : (
          <View className="cd-timeline">
            {timeline.map((t, idx) => {
              const when = t.occurred_at ?? t.created_at ?? "";
              return (
                <View key={t.id} className="cd-tl-row">
                  {idx < timeline.length - 1 && <View className="cd-tl-line" />}
                  <View className="cd-tl-dot">
                    <Text>{TYPE_EMOJI[t.type ?? ""] ?? "•"}</Text>
                  </View>
                  <View className="cd-tl-body">
                    <View className="cd-tl-meta">
                      <Text className="cd-tl-type">{t.type}</Text>
                      {!!when && <Text className="cd-tl-when">{zhDay(when)}</Text>}
                      {t.tx_amount_cents != null && (
                        <Text className={t.tx_direction === "out" ? "money-out" : "money-in"}>
                          {t.tx_direction === "out" ? "送出" : "收到"} ¥{yuan(t.tx_amount_cents ?? 0)}
                        </Text>
                      )}
                    </View>
                    {!!t.summary && <Text className="cd-tl-summary">{displaySummary(t.summary)}</Text>}
                    {!!t.entry_text && t.entry_text !== t.summary && (
                      <Text className="cd-tl-entry">「{t.entry_text}」</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* 关联人情账 */}
      {money.length > 0 && (
        <View className="glass glass-p5 cd-card">
          <View className="cd-money-head">
            <View className="chip cd-chip tone-rose ico-row">
              <LucideIcon name="wallet" size={11} color="currentColor" />
              <Text>关联人情账</Text>
            </View>
            <Text className="cd-money-sub">流水中「对方」为 TA 的人情往来 · 净额 {giftIn - giftOut < 0 ? "-" : ""}¥{yuan(Math.abs(giftIn - giftOut))}</Text>
          </View>
          <View className="cd-money-list">
            {money.map((m) => (
              <View key={m.id} className="cd-money-row">
                <Text className={`cd-money-dir ${m.direction === "out" ? "out" : "in"}`}>
                  {m.direction === "out" ? "送" : "收"}
                </Text>
                <Text className="cd-money-note">{m.note || m.category}</Text>
                <Text className="cd-money-when">{zhDay(m.occurred_at)}</Text>
                <Text className={`cd-money-amt ${m.direction === "out" ? "money-out" : "money-in"}`}>
                  {m.direction === "out" ? "-" : "+"}¥{yuan(m.amount_cents)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* 编辑弹层 / 补一笔往来弹层 */}
      {editing && (
        <ContactFormModal
          initial={contact}
          onClose={() => setEditing(false)}
          onSaved={(text) => {
            setEditing(false);
            showToast({ type: "ok", text });
            void load().catch((e: any) => setLoadErr(e?.message ?? String(e)));
          }}
        />
      )}
      {adding && (
        <InteractionModal
          contactId={id}
          contactName={contact.name}
          onClose={() => setAdding(false)}
          onSaved={(text) => {
            setAdding(false);
            showToast({ type: "ok", text });
            void load().catch((e: any) => setLoadErr(e?.message ?? String(e)));
          }}
        />
      )}
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="users" label="人际档案" />
    </PageShell>
  );
}
