/**
 * 感悟分区（= web reflection-section.tsx + space-reflections.tsx + reflection-editor.tsx 移动端形态）：
 * 右上「✍️ 写感悟」入口 → 感悟列表卡（时间倒序 / 点条目拉全文展开 / ✏️ 编辑 🗑 两步删除 / 加载更多）
 * → 底部抽屉编辑器（字数 5 万码点上限，超限禁存；取消有改动轻提示）。
 */
import { useCallback, useEffect, useState } from "react";
import { View, Text, Textarea, Button } from "@tarojs/components";
import {
  addReflection,
  deleteReflection,
  getReflection,
  loadReflections,
  patchReflection,
  type ReflectionItem,
} from "./api";
import { useArmConfirm } from "../shared";
import { showToast } from "@/components/toast";
import "./reflection-tab.scss";

const PAGE_SIZE = 20;

/** 码点计数（= Array.from().length，与 DB char_length 同口径） */
const charsOf = (s: string) => Array.from(s).length;

export default function ReflectionTab(opts: {
  spaceId: string;
  onChanged: () => void;
  /** 外部刷新信号（FR-4.1：保存/删除后 bump，列表立即重拉） */
  rev: number;
}) {
  const { spaceId, onChanged, rev } = opts;
  const [items, setItems] = useState<ReflectionItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, string>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const armDelete = useArmConfirm();
  // 编辑器（底部抽屉）：null=关闭；editing 存编辑目标全文，""=新建
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; initial: string } | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      try {
        const j = await loadReflections(spaceId, PAGE_SIZE, offset);
        setLoadErr(null);
        setTotal(j.total ?? 0);
        setItems((prev) => (offset === 0 ? j.items ?? [] : [...(prev ?? []), ...(j.items ?? [])]));
      } catch (e: any) {
        setLoadErr(`感悟加载失败：${e?.message ?? e}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaceId],
  );

  useEffect(() => {
    setItems(null);
    setLoadErr(null);
    setExpanded({});
    void load(0);
  }, [load, rev]);

  /** 点条目展开/收起全文（GET 单篇拉全文） */
  async function toggleExpand(it: ReflectionItem) {
    if (expanded[it.id] !== undefined) {
      setExpanded((s) => {
        const n = { ...s };
        delete n[it.id];
        return n;
      });
      return;
    }
    try {
      const j = await getReflection(spaceId, it.id);
      setExpanded((s) => ({ ...s, [it.id]: j.reflection.content }));
    } catch (e: any) {
      showToast({ type: "err", text: `全文加载失败：${e?.message ?? e}` });
    }
  }

  async function remove(it: ReflectionItem) {
    if (!armDelete.arm(it.id)) return;
    try {
      await deleteReflection(spaceId, it.id);
    } catch {
      showToast({ type: "err", text: "删除失败" });
      return;
    }
    showToast({ type: "ok", text: "🗑 感悟已删除" });
    onChanged();
    await load(0);
  }

  /** 打开编辑器：编辑模式先拉全文回填 */
  async function openEdit(it: ReflectionItem) {
    try {
      const j = await getReflection(spaceId, it.id);
      setEditing({ id: it.id, initial: j.reflection.content });
      setValue(j.reflection.content);
      setEditorOpen(true);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "全文加载失败" });
    }
  }

  function openNew() {
    setEditing({ id: null, initial: "" });
    setValue("");
    setEditorOpen(true);
  }

  function cancelEditor() {
    // N3.5：有改动时轻提示「已取消，未保存」
    if (editing && value !== editing.initial) showToast({ type: "info", text: "已取消，未保存" });
    setEditorOpen(false);
  }

  async function save() {
    const content = value.trim();
    if (!content || busy || charsOf(content) > 50_000 || !editing) return;
    setBusy(true);
    try {
      if (editing.id) await patchReflection(spaceId, editing.id, content);
      else await addReflection(spaceId, content);
      showToast({ type: "ok", text: editing.id ? "✏️ 感悟已更新" : "📝 感悟已保存" });
      setEditorOpen(false);
      onChanged();
      await load(0);
    } catch (e: any) {
      showToast({ type: "err", text: e?.message ?? "保存失败" });
    } finally {
      setBusy(false);
    }
  }

  /** 北京时间展示（= web fmtDay/fmtTime：UTC getter + 8h） */
  const fmtDay = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  };
  const fmtTime = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };

  const chars = charsOf(value);
  const over = chars > 50_000;

  return (
    <View>
      {/* 写感悟入口（web 靠右 btn-primary） */}
      <View className="rf-entry">
        <Button className="btn-reset btn-primary rf-entry-btn" hoverClass="press" onClick={openNew}>
          ✍️ 写感悟
        </Button>
      </View>

      <View className="glass glass-p5 rf-section">
        <View className="rf-head">
          <Text className="rf-title">📝 感悟</Text>
          <Text className="rf-count">{total} 篇</Text>
        </View>

        {items === null ? (
          loadErr ? (
            <View className="rf-center">
              <Text className="rf-err">{loadErr}</Text>
              <Button className="btn-reset rf-retry" hoverClass="press" onClick={() => void load(0)}>重试</Button>
            </View>
          ) : (
            <Text className="rf-empty">加载中…</Text>
          )
        ) : items.length === 0 ? (
          <Text className="rf-empty">还没有感悟 —— 阶段心得、踩坑复盘、自我对话，写给未来某个时刻的自己</Text>
        ) : (
          <>
            <View className="rf-list">
              {items.map((it) => {
                const full = expanded[it.id];
                return (
                  <View key={it.id} className="rf-item">
                    <View className="rf-item-head">
                      <Text className="rf-time">
                        {fmtDay(it.created_at)} {fmtTime(it.created_at)}
                        {it.edited ? " · 已编辑" : ""}
                      </Text>
                      <View className="rf-item-ops">
                        <Text className="rf-op" onClick={() => void openEdit(it)}>✏️</Text>
                        <Text
                          className={`rf-op del ${armDelete.armedId === it.id ? "armed" : ""}`}
                          onClick={() => void remove(it)}
                        >
                          {armDelete.armedId === it.id ? "确认删除?" : "🗑"}
                        </Text>
                      </View>
                    </View>
                    <Text
                      className={`rf-body ${full === undefined ? "clamp" : ""}`}
                      onClick={() => void toggleExpand(it)}
                    >
                      {full ?? it.preview}
                    </Text>
                    <Text className="rf-chars">{it.chars} 字{it.edited ? " · 已编辑" : ""}</Text>
                  </View>
                );
              })}
            </View>
            {items.length < total && (
              <Button
                className={`btn-reset rf-more ${loadingMore ? "disabled" : ""}`}
                disabled={loadingMore}
                onClick={() => {
                  if (loadingMore) return; // 双击守卫：避免重复追加同一页
                  setLoadingMore(true);
                  load(items.length).finally(() => setLoadingMore(false));
                }}
              >
                {loadingMore ? "加载中…" : `加载更多（${total - items.length} 篇）`}
              </Button>
            )}
          </>
        )}
      </View>

      {/* 感悟编辑器（底部抽屉，= web ReflectionEditor 移动端形态） */}
      {editorOpen && <View className="overlay" onClick={cancelEditor} />}
      {editorOpen && (
        <View className="sheet rf-editor safe-bottom">
          <View className="rf-editor-head">
            <Text className="rf-editor-title">{editing?.initial ? "编辑感悟" : "写感悟"}</Text>
            <Text className="rf-editor-close" onClick={cancelEditor}>✕</Text>
          </View>
          <Textarea
            className="rf-editor-input"
            value={value}
            focus
            maxlength={-1}
            placeholder="记录阶段心得、踩坑复盘、自我对话……（纯文本，单篇 ≤50000 字）"
            placeholderClass="input-placeholder"
            onInput={(e) => {
              const next = e.detail.value;
              if (charsOf(next) > 50_000) {
                setValue(Array.from(next).slice(0, 50_000).join(""));
                return;
              }
              setValue(next);
            }}
          />
          <View className="rf-editor-foot">
            <Text className={`rf-editor-count ${over ? "over" : chars > 45_000 ? "warn" : ""}`}>
              {chars}/50000{over ? " · 超出上限" : ""}
            </Text>
            <View className="rf-editor-btns">
              <Button className="btn-reset rf-editor-cancel" hoverClass="press" onClick={cancelEditor}>取消</Button>
              <Button
                className={`btn-reset btn-primary rf-editor-save ${busy || over || !value.trim() ? "disabled" : ""}`}
                hoverClass="press"
                disabled={busy || over || !value.trim()}
                onClick={() => void save()}
              >
                {busy ? "保存中…" : "保存"}
              </Button>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
