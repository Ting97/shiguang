/**
 * 动态卡（完整版）：原文 + 心情 + 图片 + AI 识别产物（收支/待办/日程/人情）+ 待确认区 + 长按删除。
 *
 * 字段契约核对自 apps/api/src/server/timeline/service.ts 的 listFeed SQL（feed 接口真实返回，camelCase）：
 * - transactions[].amountCents —— 不是 amount_cents（旧版卡片按 amount_cents 取值恒为 NaN）
 * - todos[].status === "done" 表示完成（无 done 布尔字段）
 * - blocks[].startAt/endAt/activityName
 * - 人情（interactions）聚合成 people[]：{interactionId, name, summary}——「类型」信息在 summary
 * - images[] 是 {storageKey} 对象数组，URL 走 fileUrl()
 * - recognitions：{ [domain]: {status, confidence, ...} }——待确认数据确实随 feed 下发，
 *   status === "pending" 即待确认域（对齐 web pending-confirms.tsx），无需再发请求拉取
 */
import { useState } from "react";
import { View, Text, Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { deleteEntry, previewImage, yuan, type FeedMoment } from "@/lib/api";
import {
  confirmEntry,
  fileUrl,
  type FeedBlock,
  type FeedImageObj,
  type FeedPerson,
  type FeedTodo,
  type FeedTx,
  type RecognitionInfo,
} from "./api";
import "./moment-card.scss";

/* ---- 北京时间工具（对齐 web lib/bj-time / moment-feed kit：UTC getter + 8h，海外设备日界不错 8 小时） ---- */
const pad = (n: number) => String(n).padStart(2, "0");
const bjDayIdx = (t: number) => Math.floor((t + 8 * 3600_000) / 86_400_000);

function bjClock(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 跨天时间块的日期前缀：非今天 →「9月17日 」（凌晨记录的「昨天下午」不被误读为今天，web dayPrefix 同口径） */
function dayPrefix(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + 8 * 3600_000);
  return bjDayIdx(Date.now()) - bjDayIdx(t) === 0 ? "" : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 `;
}

/** 待办时间标签：起止同日 →「9:10–9:30」区间；否则退回单时刻（web todoTimeLabel 简版） */
function todoTimeLabel(startAt?: string | null, dueAt?: string | null): string | null {
  if (!dueAt) return null;
  if (startAt) {
    const a = Date.parse(startAt);
    const b = Date.parse(dueAt);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b && bjDayIdx(a) === bjDayIdx(b)) {
      return `${bjClock(startAt)}–${bjClock(dueAt)}`;
    }
  }
  return `${dayPrefix(dueAt)}${bjClock(dueAt)}`;
}

/** 识别域中文名（对齐 web moment-feed/kit.ts DOMAIN_LABELS） */
const DOMAIN_LABELS: Record<string, string> = {
  schedule: "日程",
  todo: "todo",
  finance: "收支",
  mood: "心情",
  diet: "饮食",
  people: "关系",
};

export default function MomentCard({ m, onDeleted }: { m: FeedMoment; onDeleted: (id: string) => void }) {
  // 已确认/忽略的 pending 域：本地摘除即可（确认只改登记簿与 is_draft，不影响卡片其余展示，不必整页刷新）
  const [settled, setSettled] = useState<string[]>([]);
  const [busyDomain, setBusyDomain] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cardMsg, setCardMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const imgs = (m.images ?? []) as FeedImageObj[];
  const txs = (m.transactions ?? []) as FeedTx[];
  const todos = (m.todos ?? []) as FeedTodo[];
  const blocks = (m.blocks ?? []) as FeedBlock[];
  const people = (m.people ?? []) as FeedPerson[];

  const recs = (m.recognitions ?? {}) as Record<string, RecognitionInfo>;
  const pendings = Object.entries(recs).filter(([domain, v]) => v?.status === "pending" && !settled.includes(domain));

  const d = new Date(new Date(m.created_at).getTime() + 8 * 3600_000);
  const day = `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

  /** 确认入账 / 忽略：POST /api/entries/:id/confirm {domain, ignore}（真实契约是 POST，见 ./api.ts 注释） */
  async function settle(domain: string, ignore: boolean) {
    if (busyDomain) return; // 防双击双发（第二次会因登记簿状态已变而报错）
    setBusyDomain(domain);
    setCardMsg(null);
    try {
      await confirmEntry(m.id, domain, ignore);
      setSettled((prev) => [...prev, domain]);
      setCardMsg({ ok: true, text: ignore ? "已忽略" : "✅ 已确认入账" });
    } catch (e: any) {
      setCardMsg({ ok: false, text: e?.message ?? "操作失败" });
    } finally {
      setBusyDomain(null);
    }
  }

  /** 长按卡片 → 行内操作。编辑面板本期简化为「仅删除」（web 端的编辑/重识别走 PC） */
  function onCardLongPress() {
    if (deleting) return;
    Taro.showActionSheet({ itemList: ["删除这条动态"] })
      .then(() => {
        // 两步确认：actionSheet 选删除 → modal 再拦一道（删除会连识别产物一起清，不可恢复）
        Taro.showModal({
          title: "删除动态",
          content: "将删除原文及其全部识别产物（流水 / todo / 日程等），不可恢复",
          confirmText: "删除",
          confirmColor: "#fb7185",
        }).then((r) => {
          if (r.confirm) void doDelete();
        });
      })
      .catch(() => {
        /* 用户取消 actionSheet 走 reject：静默 */
      });
  }

  async function doDelete() {
    if (deleting) return; // 防双击双发 DELETE（第二次会 404）
    setDeleting(true);
    setCardMsg(null);
    try {
      await deleteEntry(m.id);
      onDeleted(m.id);
    } catch (e: any) {
      setCardMsg({ ok: false, text: e?.message ?? "删除失败" });
    } finally {
      setDeleting(false);
    }
  }

  const imgUrlList = imgs.map((g) => fileUrl(g.storageKey));

  return (
    <View className="card moment" onLongPress={onCardLongPress}>
      <View className="moment-head">
        <Text className="dim">{day}</Text>
        {m.mood && <Text className="mood">{String(m.mood)}</Text>}
      </View>

      <Text className="moment-text">{m.raw_text}</Text>

      {/* 图片：storageKey 拼门禁 URL（见 fileUrl 注释的 cookie 坑）；点击全屏预览 */}
      {imgUrlList.length > 0 && (
        <View className="grid">
          {imgUrlList.map((src, i) => (
            <Image key={imgs[i]?.id ?? i} className="grid-img" src={src} mode="aspectFill" onClick={() => previewImage(imgUrlList, src)} />
          ))}
        </View>
      )}

      {/* 后台识别中 / 识别超时：动态已上墙、产物随后出现（web moment-card 同款降级提示） */}
      {!m.analyzed_at && (
        <Text className="recog-state">
          {String(m.recognize_state ?? "") === "timeout" ? "🤖 AI 当时未返回识别结果" : "🤖 AI 识别中：日程 / 待办 / 收支 / 心情…"}
        </Text>
      )}

      {/* 收支 chips：方向着色（amountCents 是 camelCase，别改回 amount_cents） */}
      {txs.length > 0 && (
        <View className="chips">
          {txs.map((t, i) => (
            <Text key={t.id ?? i} className={`chip ${t.direction === "out" ? "money-out" : "money-in"}`}>
              {t.direction === "out" ? "-" : "+"}¥{yuan(t.amountCents)} · {t.category}
              {t.counterparty ? ` · ${t.counterparty}` : ""}
            </Text>
          ))}
        </View>
      )}

      {/* 待办 chips：状态是 status==="done"（feed 无 done 布尔） */}
      {todos.length > 0 && (
        <View className="chips">
          {todos.map((t, i) => {
            const tl = todoTimeLabel(t.startAt, t.dueAt);
            return (
              <Text key={t.id ?? i} className="chip dim">
                {t.status === "done" ? "☑" : "☐"} {t.title}
                {tl ? ` · ${tl}` : ""}
              </Text>
            );
          })}
        </View>
      )}

      {/* 日程块 chips：title + 北京时间 HH:MM（跨天带日期前缀） */}
      {blocks.length > 0 && (
        <View className="chips">
          {blocks.map((b, i) => (
            <Text key={b.id ?? i} className="chip">
              ⏰ {b.title}
              {b.startAt ? ` · ${dayPrefix(b.startAt)}${bjClock(b.startAt)}${b.endAt ? `–${bjClock(b.endAt)}` : ""}` : ""}
            </Text>
          ))}
        </View>
      )}

      {/* 人情 chips：对方 + 类型/摘要（feed 把 interactions 聚合成 people，见 ./api.ts 类型注释） */}
      {people.length > 0 && (
        <View className="chips">
          {people.map((p, i) => (
            <Text key={p.interactionId ?? i} className="chip">
              👥 {p.name}
              {p.summary ? ` · ${p.summary}` : ""}
            </Text>
          ))}
        </View>
      )}

      {/* 待确认区：低置信 pending 识别逐域「确认入账 / 忽略」 */}
      {pendings.map(([domain, info]) => (
        <View key={domain} className="pending-row">
          <Text className="pending-text">
            🤔 识别到{DOMAIN_LABELS[domain] ?? domain}（置信度 {Math.round(Number(info?.confidence ?? 0) * 100)}%），确认吗？
          </Text>
          <Text className="pending-btn" onClick={() => void settle(domain, false)}>
            {busyDomain === domain ? "…" : "确认"}
          </Text>
          <Text className="pending-btn-ghost" onClick={() => void settle(domain, true)}>
            忽略
          </Text>
        </View>
      ))}

      {/* 卡内操作反馈：确认/删除的结果就地展示（错也在这里，不用滚到页顶看 banner） */}
      {cardMsg && <View className={`card-msg ${cardMsg.ok ? "card-msg-ok" : "card-msg-err"}`}>{cardMsg.text}</View>}

      <Text className="moment-hint">长按卡片可删除</Text>
    </View>
  );
}
