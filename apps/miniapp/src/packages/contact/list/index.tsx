/**
 * 人际列表（= web contacts/page.tsx 移动端形态）：
 * hero（拾光·人际 + 列表|图谱 pill 切换）→ 分组 FilterChip 多选（带计数）+ 搜索框 + ＋建档
 * → msg/刷新失败横幅 → 联系人卡列表（44px emoji 圆头像 TONE_BG + 姓名/别名 + 分组 TagChip +
 * 生日倒计时 text-ai + 右侧 N 次 + 最近往来 relTime·summary + 人情往来金额）
 * 或 图谱视图（canvas 星图）→ 建档弹层（form-modal）。
 */
import { useEffect, useMemo, useState, useRef } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import LucideIcon from "@/components/lucide-icon";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import { showToast } from "@/components/toast";
import { loadContacts, yuan } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import ContactFormModal from "../form-modal";
import ContactGraph from "./graph";
import type { ContactRow } from "../shared";
import {
  CONTACT_GROUPS,
  GROUP_EMOJI,
  GROUP_TONE,
  birthdayLabel,
  displaySummary,
  relTime,
  toneClass,
} from "../shared";
import "./index.scss";

export default function ContactListPage() {
  const [contacts, setContacts] = useState<ContactRow[] | null>(null);
  const [groups, setGroups] = useState<Set<string>>(new Set()); // 多选；空集=全部分组
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "graph">("list");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactRow | "new" | null>(null);
  const [inited, setInited] = useState(false);
  const initedRef = useRef(false);

  async function load() {
    setLoadErr(null);
    try {
      const j = await loadContacts();
      setContacts((j.contacts as ContactRow[]) ?? []);
    } catch (e: any) {
      setLoadErr(e?.message ?? "加载失败");
    }
  }

  // 副作用移入 useEffect：render 期 setState+发请求在并发/StrictMode 下会双发
  useEffect(() => {
    if (inited || !getSessionToken()) return;
    setInited(true);
    initedRef.current = true;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 详情页删除/编辑后返回：非首次显示静默重拉（挂载只拉一次，返回即陈旧）
  Taro.useDidShow(() => {
    if (initedRef.current && getSessionToken()) void load();
  });

  usePullDownRefresh(() => {
    if (!getSessionToken()) {
      Taro.stopPullDownRefresh(); // 游客态无服务端通道，直接收起动画（防 401 错误横幅/toast）
      return;
    }
    load().finally(() => Taro.stopPullDownRefresh());
  });

  // 游客无服务端只读通道（/api 全 401）：给出登录引导出口（全部 hooks 之后早退）
  if (!getSessionToken()) {
    return (
      <PageShell active="contacts">
        <GuestGate title="人际" desc="联系人档案、星型关系图谱与往来记录" />
      </PageShell>
    );
  }

  /** 分组 chips（全部 + 有联系人的分组，带计数） */
  const groupChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of contacts ?? []) counts.set(c.group_tag ?? "其他", (counts.get(c.group_tag ?? "其他") ?? 0) + 1);
    return ["全部", ...CONTACT_GROUPS.filter((g) => counts.get(g))].map((g) => ({
      name: g,
      count: g === "全部" ? contacts?.length ?? 0 : counts.get(g) ?? 0,
    }));
  }, [contacts]);

  /** 筛选：分组多选 + 姓名/备注名/备注 关键字（= web filtered） */
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (contacts ?? []).filter(
      (c) =>
        (groups.size === 0 || groups.has(c.group_tag ?? "其他")) &&
        (!kw ||
          String(c.name).toLowerCase().includes(kw) ||
          String(c.alias ?? "").toLowerCase().includes(kw) ||
          String(c.notes ?? "").toLowerCase().includes(kw)),
    );
  }, [contacts, groups, q]);

  function go(id: string) {
    Taro.navigateTo({ url: `/packages/contact/detail/index?id=${id}` });
  }

  return (
    <PageShell active="contacts">
      {/* hero（= web header.mb-6.text-center） */}
      <View className="ct-head">
        <View className="hero text-gradient ct-hero">
          拾光
          <Text className="ct-hero-sub">人际</Text>
        </View>
        <View className="hint ct-head-sub">动态里提到的人都在这里 —— 分组档案、生日提醒、往来时间线</View>
        {/* 列表 | 图谱 视图切换（= FilterChip variant=pill 容器） */}
        <View className="pill-nav ct-view-switch">
          <View className={`ct-pill ${view === "list" ? "pill-active" : ""}`} onClick={() => setView("list")}>
            <LucideIcon name="list_todo" size={13} color={view === "list" ? "#fff" : "var(--ink-mute)"} />
            <Text>列表</Text>
          </View>
          <View className={`ct-pill ${view === "graph" ? "pill-active" : ""}`} onClick={() => setView("graph")}>
            <LucideIcon name="network" size={13} color={view === "graph" ? "#fff" : "var(--ink-mute)"} />
            <Text>图谱</Text>
          </View>
        </View>
      </View>

      {/* 分组筛选 + 搜索 + 建档（= web flex-wrap 工具行） */}
      <View className="ct-toolbar">
        <View className="ct-chips">
          {groupChips.map((g) => {
            const isAll = g.name === "全部";
            const selected = isAll ? groups.size === 0 : groups.has(g.name);
            return (
              <View
                key={g.name}
                className={`flt-chip ${selected ? "on" : ""}`}
                onClick={() => {
                  if (isAll) {
                    setGroups(new Set());
                    return;
                  }
                  setGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.name)) next.delete(g.name);
                    else next.add(g.name);
                    return next;
                  });
                }}
              >
                {!isAll && <Text className="flt-chip-icon">{GROUP_EMOJI[g.name] ?? "👤"}</Text>}
                <Text>{g.name}</Text>
                <Text className="flt-chip-count">{g.count}</Text>
              </View>
            );
          })}
        </View>
        <View className="ct-tools">
          <Input
            className="ct-search"
            value={q}
            placeholder="搜索姓名/备注…"
            placeholderClass="input-placeholder"
            onInput={(e) => setQ(e.detail.value)}
          />
          <Button className="btn-reset btn-primary ct-new-btn" hoverClass="press" onClick={() => setEditing("new")}>
            ＋ 建档
          </Button>
        </View>
      </View>

      {/* 已有数据时的刷新失败提示（首失败走下方整页错误态） */}
      {contacts !== null && loadErr && (
        <View className="msg-banner msg-banner-err">
          加载失败：{loadErr}
          <Text className="ct-retry" onClick={() => void load()}>重试</Text>
        </View>
      )}

      {contacts === null ? (
        loadErr ? (
          <View className="ct-center">
            <Text className="ct-load-err">加载失败：{loadErr}</Text>
            <Button className="btn-reset btn-primary ct-retry-btn" hoverClass="press" onClick={() => void load()}>
              重试
            </Button>
          </View>
        ) : (
          /* 骨架屏（= web Skeleton rows=4） */
          <View className="ct-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <View key={i} className="skeleton ct-skel-row" />
            ))}
          </View>
        )
      ) : view === "graph" ? (
        <>
          {/* 图谱视图：空数据也渲染轨道+中心「我」（= web 4-F/QA 注释同款） */}
          <ContactGraph contacts={filtered} onOpen={go} />
          {contacts.length === 0 && (
            <Text className="empty-state ct-empty-line">还没有联系人 —— 动态里说「和老王吃饭」，TA 会自动出现在这里</Text>
          )}
          {contacts.length > 0 && filtered.length === 0 && (
            <Text className="empty-state ct-empty-line">没有匹配的联系人</Text>
          )}
        </>
      ) : contacts.length === 0 ? (
        <Text className="empty-state ct-empty-line">
          还没有联系人 —— 动态里说「和老王吃饭」，TA 会自动出现在这里
        </Text>
      ) : filtered.length === 0 ? (
        <Text className="empty-state ct-empty-line">没有匹配的联系人</Text>
      ) : (
        <View className="ct-grid">
          {filtered.map((c) => {
            const bd = birthdayLabel(c);
            const tone = GROUP_TONE[c.group_tag ?? ""] ?? "sky";
            const gift = Number(c.gift_net_cents ?? 0);
            return (
              /* = web Link.glass.rounded-2xl.p-4 联系人卡 */
              <View key={c.id} className="glass glass-p4 ct-card fade-up" onClick={() => go(c.id)}>
                <View className="ct-card-top">
                  {/* 44px emoji 圆头像（TONE_BG = 分组语义 tinted 底） */}
                  <View className={`ct-avatar tone-bg-${tone}`}>
                    <Text>{GROUP_EMOJI[c.group_tag ?? ""] ?? "👤"}</Text>
                  </View>
                  <View className="ct-card-mid">
                    <View className="ct-name-row">
                      <Text className="ct-name">{c.name}</Text>
                      {!!c.alias && <Text className="ct-alias">（{c.alias}）</Text>}
                    </View>
                    <View className="ct-sub-row">
                      <Text className={`chip ct-tag ${toneClass(tone)}`}>{c.group_tag ?? "其他"}</Text>
                      {bd?.countdown && <Text className="ct-bd">{bd.countdown}</Text>}
                    </View>
                  </View>
                  <Text className="ct-times">{Number(c.interaction_count ?? 0)} 次</Text>
                </View>
                <Text className="ct-last">
                  {c.last_at ? (
                    `${relTime(c.last_at)} · ${displaySummary(c.last_summary) || "往来"}`
                  ) : (
                    "暂无往来记录"
                  )}
                </Text>
                {gift !== 0 && (
                  /* 与 web 同款展示：正数带 +、负数带 -（净送出裸显绝对值会被误读成净收入，009 轮三端体验同步修复） */
                  <Text className="ct-gift">
                    人情往来 {gift > 0 ? "+" : "-"}¥{yuan(Math.abs(gift))}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* 建档弹层 */}
      {editing && (
        <ContactFormModal
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            showToast({ type: "ok", text });
            void load();
          }}
        />
      )}

      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="users" label="人际" />
    </PageShell>
  );
}
