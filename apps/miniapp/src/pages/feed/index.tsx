/**
 * 动态 feed 页（完整版）：发布区（文字 + 图片 + 语音）+ 动态流（MomentCard 完整识别产物）。
 * 发布顺序对齐 web publish-sheet 真实契约：先 POST /api/parse 文字落库秒回拿 entryId，
 * 再并行上传图片到 POST /api/entries/:id/images（该端点要求 entry 已存在，不能先传图）；
 * 单张失败自动重试一次，仍失败标红留缩略图供手动补传。
 */
import { useRef, useState } from "react";
import { View, Text, Textarea, Button, Image } from "@tarojs/components";
import Taro, { usePullDownRefresh, useReachBottom, useShareAppMessage } from "@tarojs/taro";
import { loadFeed, parseText, type FeedMoment } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { uploadEntryImage } from "./api";
import MomentCard from "./moment-card";
import VoiceButton from "./voice-button";
import "./index.scss";

const PAGE_SIZE = 20;
const MAX_PICS = 9; // 服务端硬上限：单条动态最多 9 张（apps/api addEntryImages）

/** 已选图片：path 是本地临时文件；status 驱动缩略图状态（ready 可删 / uploading 遮罩 / error 可重试） */
interface Pic {
  path: string;
  status: "ready" | "uploading" | "error";
}

export default function Feed() {
  const [moments, setMoments] = useState<FeedMoment[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pics, setPics] = useState<Pic[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 最近一次发布成功的 entryId：图片失败后的「↻ 补传」要靠它（文字已发布、entry 已存在）
  const lastEntryIdRef = useRef<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const j = await loadFeed(PAGE_SIZE, 0);
      setMoments(j.moments ?? []);
      setDone((j.moments ?? []).length < PAGE_SIZE);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "加载失败" });
    } finally {
      setLoading(false);
    }
  }

  // 首次进入加载（token 就绪后）
  const [inited, setInited] = useState(false);
  if (!inited && getSessionToken()) {
    setInited(true);
    void refresh();
  }

  // 分享卡片（docs/15 小程序独有增量）：带来源标记，好友点开落登录页
  useShareAppMessage(() => ({ title: "拾光 —— 钱 · 时间 · 人，一句话记录生活", path: "/pages/login/index" }));

  async function loadMore() {
    if (loading || done || !getSessionToken()) return;
    setLoading(true);
    try {
      const j = await loadFeed(PAGE_SIZE, moments.length);
      const more = j.moments ?? [];
      setMoments((m) => [...m, ...more]);
      setDone(more.length < PAGE_SIZE);
    } catch {
      /* 加载更多失败静默，下次触底重试 */
    } finally {
      setLoading(false);
    }
  }
  useReachBottom(loadMore);

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh());
  });

  /* ---------- 发布：图片 ---------- */

  async function addPics() {
    if (sending) return;
    const left = MAX_PICS - pics.length;
    if (left <= 0) {
      setMsg({ ok: false, text: "最多 9 张" });
      return;
    }
    try {
      // count 按「9 - 已选数」收口：服务端按单条累计张数校验，超了直接 400
      const res = await Taro.chooseMedia({
        count: left,
        mediaType: ["image"],
        sizeType: ["compressed"], // 微信侧先压一轮，缓解服务端单张 5MB 校验
        sourceType: ["album", "camera"],
      });
      const all = res.tempFiles ?? [];
      // 超 5MB 的图服务端必拒（单张上限），本地先拦掉省一次必败上传
      const sized = all.filter((f) => (f.size ?? 0) <= 5 * 1024 * 1024);
      const paths = sized.map((f) => f.tempFilePath).slice(0, left);
      if (all.length > sized.length) setMsg({ ok: false, text: "单张图片不能超过 5MB，已忽略超大图片" });
      if (paths.length) setPics((prev) => [...prev, ...paths.map((p) => ({ path: p, status: "ready" as const }))]);
    } catch (e: any) {
      // 用户在选图面板点取消也走 reject：静默，只有真失败才报
      if (!String(e?.errMsg ?? "").includes("cancel")) setMsg({ ok: false, text: e?.errMsg ?? "选图失败" });
    }
  }

  function removePic(i: number) {
    if (sending) return; // 上传中删图会和上传结果回写打架
    setPics((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** 并行上传 + 失败自动重试一次；返回最终仍失败的本地路径 */
  async function uploadWithRetry(entryId: string, paths: string[]): Promise<string[]> {
    const attempt = (list: string[]) => Promise.allSettled(list.map((p) => uploadEntryImage(entryId, p)));
    const results = await attempt(paths);
    const failedOnce = paths.filter((_, i) => results[i].status === "rejected");
    if (!failedOnce.length) return [];
    // 瞬时网络抖动居多：自动重试一次，仍失败才留给用户手动重试
    const retry = await attempt(failedOnce);
    return failedOnce.filter((_, i) => retry[i].status === "rejected");
  }

  /** 把失败图回写成 error 态（保留缩略图供 ↻ 补传） */
  function keepFailed(all: Pic[], failed: string[]) {
    const s = new Set(failed);
    setPics(all.filter((p) => s.has(p.path)).map((p) => ({ path: p.path, status: "error" as const })));
  }

  /* ---------- 发布 ---------- */

  /** 语音转写结果填入发布框：追加不覆盖（保住手输内容）、不自动发布（转写可能有误，用户确认后手动发） */
  function fillVoiceText(text: string) {
    setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return; // 服务端 text 必填：纯图片发不了（对齐 web，发布键同样依赖非空文字）
    setSending(true);
    setMsg(null);
    try {
      // 顺序契约：文字先落库秒回（图片端点要求 entry 已存在），再传图
      const j = await parseText(text);
      const entryId = j.entry.id;
      lastEntryIdRef.current = entryId;
      setDraft("");

      const toSend = pics.filter((p) => p.status !== "error");
      if (toSend.length) {
        setPics((prev) => prev.map((p) => ({ ...p, status: "uploading" as const })));
        const failed = await uploadWithRetry(entryId, toSend.map((p) => p.path));
        if (failed.length) {
          keepFailed(toSend, failed);
          setMsg({ ok: false, text: `动态已发布，但 ${failed.length} 张图片上传失败，点缩略图「↻」补传` });
        } else {
          setPics([]);
          setMsg({ ok: true, text: "✅ 已发布，AI 识别中…" });
        }
      } else {
        setMsg({ ok: true, text: "✅ 已发布，AI 识别中…" });
      }
      // 对齐 web/Expo：识别落库有延迟，6s 先刷一次、16s 补一次
      setTimeout(() => void refresh(), 6000);
      setTimeout(() => void refresh(), 16000);
    } catch (e: any) {
      // 文字没发出去：draft 保留可直接重试（已选图片态不动）
      setMsg({ ok: false, text: e?.message ?? "发布失败" });
    } finally {
      setSending(false);
    }
  }

  /** 图片发布失败后的手动补传（沿用 lastEntryIdRef，只传 error 态的图） */
  async function retryPics() {
    const entryId = lastEntryIdRef.current;
    const errs = pics.filter((p) => p.status === "error");
    if (!entryId || !errs.length || sending) return;
    setSending(true);
    try {
      setPics((prev) => prev.map((p) => ({ ...p, status: "uploading" as const })));
      const failed = await uploadWithRetry(entryId, errs.map((p) => p.path));
      if (failed.length) {
        keepFailed(errs, failed);
        setMsg({ ok: false, text: `仍有 ${failed.length} 张上传失败，请稍后再试` });
      } else {
        setPics([]);
        setMsg({ ok: true, text: "✅ 图片已补传完成" });
      }
    } catch (e: any) {
      keepFailed(errs, errs.map((p) => p.path));
      setMsg({ ok: false, text: e?.message ?? "重试失败" });
    } finally {
      setSending(false);
    }
  }

  return (
    <View className="page-pad">
      {msg && <View className={`banner ${msg.ok ? "banner-ok" : "banner-err"}`}>{msg.text}</View>}

      {/* 发布区：文字 + 图片 + 语音（转写只填框，不自动发布） */}
      <View className="card">
        <Textarea
          className="composer"
          value={draft}
          maxlength={2000}
          placeholder="记录此刻：花钱、待办、日程、心情…（如「打车花了30」）"
          placeholderClass="dim"
          onInput={(e) => setDraft(e.detail.value)}
        />

        {/* 已选图片缩略条：可删 / 上传中遮罩 / 失败 ↻ 补传 */}
        {pics.length > 0 && (
          <View className="pic-strip">
            {pics.map((p, i) => (
              <View key={`${p.path}-${i}`} className={`pic-cell ${p.status === "error" ? "error" : ""}`}>
                <Image className="pic-img" src={p.path} mode="aspectFill" />
                {p.status === "ready" && (
                  <View className="pic-del" onClick={() => removePic(i)}>
                    <Text>✕</Text>
                  </View>
                )}
                {p.status === "uploading" && (
                  <View className="pic-mask">
                    <Text>上传中…</Text>
                  </View>
                )}
                {p.status === "error" && (
                  <View className="pic-mask" onClick={retryPics}>
                    <Text>↻ 重试</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <View className="tools-row">
          <View className={`tool-btn ${pics.length >= MAX_PICS ? "disabled" : ""}`} onClick={addPics}>
            <Text>🖼 图片{pics.length > 0 ? ` ${pics.length}/${MAX_PICS}` : ""}</Text>
          </View>
          <VoiceButton onText={fillVoiceText} onError={(t) => setMsg({ ok: false, text: t })} disabled={sending} />
        </View>

        <View className="composer-row">
          <Text className="dim">{draft.length}/2000</Text>
          <Button
            className={`btn-primary send-btn ${!draft.trim() || sending ? "disabled" : ""}`}
            disabled={!draft.trim() || sending}
            onClick={send}
          >
            {sending ? "发布中…" : "发布"}
          </Button>
        </View>
      </View>

      {/* 动态流 */}
      {moments.length === 0 && !loading && (
        <View className="empty">
          <Text className="dim">{getSessionToken() ? "还没有动态 —— 上面记一条试试" : "未登录，请先登录"}</Text>
        </View>
      )}
      {moments.map((m) => (
        <MomentCard key={m.id} m={m} onDeleted={(id) => setMoments((list) => list.filter((x) => x.id !== id))} />
      ))}
      {loading && (
        <View className="empty">
          <Text className="dim">加载中…</Text>
        </View>
      )}
      {done && moments.length > 0 && (
        <View className="empty">
          <Text className="dim">—— 到底了 ——</Text>
        </View>
      )}
    </View>
  );
}
