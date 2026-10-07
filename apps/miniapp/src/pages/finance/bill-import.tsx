/**
 * 账单导入弹层（= web components/bill-import.tsx 小程序形态，REQ-小程序不从简）：
 * 从微信聊天记录选账单 CSV（chooseMessageFile）或直接粘贴文本 → dryRun 预览（平台识别/
 * 去重/分类全在服务端）→ 确认导入。文件读取走 base64 原样上送，UTF-8/GBK 解码由服务端
 * TextDecoder 完成（小程序运行时无 GBK 表；与 web「替换符回退 GBK」同判据，判据在服务端实现）。
 * 导入语义与 web 完全一致：流水只作记录，不挂账户不入账（is_draft=false, source=csv_import）。
 */
import { useState } from "react";
import { View, Text, Button, Textarea, ScrollView } from "@tarojs/components";
import Taro from "@tarojs/taro";
import LucideIcon from "@/components/lucide-icon";
import { importBill, yuan, type ImportPreview } from "@/lib/api";
import "./bill-import.scss";

const PLATFORM_LABEL: Record<string, string> = { alipay: "🅰 支付宝", wechat: "💬 微信" };
const PLATFORM_COLOR: Record<string, string> = { alipay: "#1677ff", wechat: "#07c160" };
const MAX_SIZE = 5 * 1024 * 1024; // 与服务端 5MB 上限一致

const fmtMoney = (cents: number) => (cents < 0 ? `-¥${yuan(-cents)}` : `¥${yuan(cents)}`);

export default function BillImport({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; size: number; base64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  /** 从微信聊天记录选 CSV（文件传输助手收到的账单文件）；读 base64 原样上送 */
  function pickFile() {
    setError(null);
    Taro.chooseMessageFile({
      count: 1,
      type: "file",
      extension: [".csv", ".txt"],
      success: (res) => {
        const f = res.tempFiles?.[0];
        if (!f) return;
        if (f.size > MAX_SIZE) {
          setError("账单文件过大（>5MB），请分段导出后导入");
          return;
        }
        try {
          const base64 = Taro.getFileSystemManager().readFileSync(f.path, "base64") as string;
          setFile({ name: f.name, size: f.size, base64 });
          setText("");
          setPreview(null);
        } catch {
          setError("文件读取失败，请重新选择");
        }
      },
      fail: () => {
        /* 用户取消选择：不打扰 */
      },
    });
  }

  async function doPreview() {
    setError(null);
    setBusy(true);
    try {
      const j = await importBill({ text: text || undefined, base64: file?.base64, dryRun: true });
      setPreview(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const j = await importBill({ text: text || undefined, base64: file?.base64, dryRun: false });
      setResult(
        (j.imported ?? 0) > 0
          ? `✅ 已导入 ${j.imported} 笔${j.dbDup ? ` · 跳过重复 ${j.dbDup} 笔` : ""}`
          : `ℹ️ ${j.message ?? "没有新流水"}`,
      );
      setPreview(null);
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const dupTotal = (preview?.batchDup ?? 0) + (preview?.dbDup ?? 0);
  const canParse = (file?.base64?.length ?? 0) > 0 || text.trim().length >= 10;

  return (
    <>
      <View className="overlay" onClick={onClose} />
      <View className="sheet billimp safe-bottom">
        <View className="billimp-head">
          <View className="chip billimp-chip">
            <LucideIcon name="download" size={12} color="var(--warn)" />
            <Text>导入支付宝/微信账单</Text>
          </View>
        </View>

        {result ? (
          <View className="billimp-result">
            <Text className="billimp-result-text">{result}</Text>
            <Button className="btn-reset btn-primary billimp-done" hoverClass="press" onClick={onClose}>
              完成
            </Button>
          </View>
        ) : !preview ? (
          <View className="billimp-pick">
            <View className="billimp-drop" hoverClass="press" onClick={pickFile}>
              {file ? (
                <>
                  <Text className="billimp-file">📄 {file.name}（{(file.size / 1024).toFixed(0)} KB）</Text>
                  <Text className="billimp-drop-hint">点击更换</Text>
                </>
              ) : (
                <>
                  <Text className="billimp-drop-main">从聊天记录选择账单 CSV 文件</Text>
                  <Text className="billimp-drop-hint">支付宝 / 微信官方导出，编码自动识别（先把文件发到微信里）</Text>
                </>
              )}
            </View>

            <Textarea
              className="billimp-textarea"
              value={text}
              maxlength={-1}
              placeholder="或粘贴账单 CSV 文本（含表头行）…"
              placeholderClass="input-placeholder"
              onInput={(e) => {
                setText(e.detail.value);
                setFile(null);
                setPreview(null);
              }}
            />

            <Text className="hint billimp-note">
              账单来源：支付宝「我的 → 账单 → 开具交易流水」；微信「我 → 服务 → 钱包 → 账单 → 下载账单（用于个人对账）」。导入自动去重、分类，商家记入对方。
            </Text>
            {error && <Text className="msg msg-err billimp-err">{error}</Text>}
            <View className="billimp-foot">
              <Button className="btn-reset billimp-cancel" hoverClass="press" onClick={onClose}>
                取消
              </Button>
              <Button
                className={`btn-reset btn-primary billimp-parse${!canParse || busy ? " disabled" : ""}`}
                hoverClass="press"
                disabled={!canParse || busy}
                onClick={() => void doPreview()}
              >
                {busy ? "解析中…" : "解析预览"}
              </Button>
            </View>
          </View>
        ) : (
          <View className="billimp-pv">
            <View className="billimp-pv-head ico-row">
              <Text className="billimp-platform" style={{ backgroundColor: PLATFORM_COLOR[preview.platform] }}>
                {PLATFORM_LABEL[preview.platform]}
              </Text>
              <Text className="billimp-pv-sum">
                {preview.total} 笔 · 可导入 <Text className="billimp-pv-n">{preview.importable}</Text>
                {dupTotal > 0 ? ` · 重复跳过 ${dupTotal}` : ""}
                {preview.skipped > 0 ? ` · 不可导入 ${preview.skipped}` : ""}
              </Text>
            </View>

            <View className="billimp-pv-grid">
              <View className="billimp-pv-cell">
                <Text className="hint">可导入支出</Text>
                <Text className="billimp-pv-money out">{fmtMoney(preview.outCents)}</Text>
              </View>
              <View className="billimp-pv-cell">
                <Text className="hint">可导入收入</Text>
                <Text className="billimp-pv-money in">{fmtMoney(preview.inCents)}</Text>
              </View>
            </View>

            <ScrollView className="billimp-sample" scrollY>
              {(preview.sample ?? []).map((s, i) => (
                <View key={i} className="billimp-sample-row">
                  <Text className={`billimp-dir ${s.direction === "out" ? "out" : "in"}`}>
                    {s.direction === "out" ? "支" : "收"}
                  </Text>
                  <Text className="billimp-sample-cat">
                    {s.category}
                    {s.counterparty ? ` · ${s.counterparty}` : ""}
                  </Text>
                  <Text className="billimp-sample-amt">
                    {fmtMoney(s.direction === "out" ? -s.amountCents : s.amountCents)}
                  </Text>
                </View>
              ))}
            </ScrollView>

            {error && <Text className="msg msg-err billimp-err">{error}</Text>}
            <View className="billimp-foot">
              <Button
                className="btn-reset billimp-cancel"
                hoverClass="press"
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                重新选择
              </Button>
              <Button
                className={`btn-reset btn-primary billimp-parse${busy || preview.importable === 0 ? " disabled" : ""}`}
                hoverClass="press"
                disabled={busy || preview.importable === 0}
                onClick={() => void doImport()}
              >
                {busy ? "导入中…" : `确认导入 ${preview.importable} 笔`}
              </Button>
            </View>
          </View>
        )}
      </View>
    </>
  );
}
