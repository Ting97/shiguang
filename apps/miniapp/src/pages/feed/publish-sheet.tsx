/**
 * 移动端发布输入面板（底部抽屉，= web components/publish-sheet.tsx）：
 * 悬浮圆圈点按=空面板；长按语音松开=转写文字带入预览，用户确认/修改后点「发布」才真正提交。
 * 附带图片（REQ-001 R1）：相册/拍照 ≤9 张；文字秒发后并行上传（uploadWithRetry 内置失败重试一次），
 * 仍失败标红缩略图可「↻ 重试」（沿用 lastEntryId 补传）。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Textarea, Image } from "@tarojs/components";
import Taro from "@tarojs/taro";
import LucideIcon from "../../components/lucide-icon";
import { showToast } from "@/components/toast";
import { uploadWithRetry } from "./api";

const MAX_PICS = 9; // 服务端硬上限：单条动态最多 9 张（apps/api addEntryImages）

/** 已选图片：path 是本地临时文件；status 驱动缩略图状态（ready 可删 / uploading 遮罩 / error 可重试） */
interface Pic {
  path: string;
  status: "ready" | "uploading" | "error";
}

export default function PublishSheet({
  open,
  initialText,
  busy,
  onPublish,
  onClose,
}: {
  open: boolean;
  /** 打开时带入的初始文字（语音转写结果或空串） */
  initialText: string;
  busy: boolean;
  /** 发布文字动态；返回 entry id（供图片上传），失败/无图返回 null */
  onPublish: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  /** 相册/相机授权被拒后的恢复引导（REQ-009 9-C）：modal 说明 → openSetting 自行打开开关 */
  function guideMediaSetting() {
    Taro.showModal({
      title: "需要相册/相机权限",
      content: "用于给动态配图，请在设置中开启对应权限",
      confirmText: "去设置",
      cancelText: "暂不",
    })
      .then(({ confirm }) => {
        if (confirm) Taro.openSetting().catch(() => {});
      })
      .catch(() => {});
  }

  const [value, setValue] = useState("");
  const [pics, setPics] = useState<Pic[]>([]);
  const [sheetMsg, setSheetMsg] = useState<string | null>(null);
  // 图片上传进行中：文字已发布、面板保持打开等图片上传，此期间禁止再次发布/重试（防重复动态）
  const [uploading, setUploading] = useState(false);
  // 打开时的初始文字快照（取消时判断是否"有改动"）
  const initialRef = useRef("");
  // 最近发布的动态 id（图片失败后的「↻ 重试」要靠它）
  const lastEntryId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialText);
    initialRef.current = initialText;
    setPics([]);
    setSheetMsg(null);
  }, [open, initialText]);

  if (!open) return null;

  /** 取消：内容相对打开时有改动则轻提示"已取消，未保存"（= web cancel） */
  function cancel() {
    if (value.trim() && value.trim() !== initialRef.current.trim()) {
      showToast({ type: "info", text: "已取消，未保存" });
    }
    onClose();
  }

  /** 相册/相机授权状态检测：任一被拒（false）→ 弹窗引导去设置打开（REQ-009 9-C 授权恢复） */
  async function checkMediaScope(source: "album" | "camera"): Promise<boolean> {
    try {
      const { authSetting } = await Taro.getSetting();
      const scope = source === "album" ? "scope.writePhotosAlbum" : "scope.camera";
      if (authSetting && authSetting[scope] === false) {
        guideMediaSetting();
        return false;
      }
    } catch {
      /* getSetting 不可用：放行走 chooseMedia，被拒时在 catch 里兜底引导 */
    }
    return true;
  }

  /** 选图（source 区分相册/拍照，对应 web 的两个入口）；微信 chooseMedia 一次面板双入口，这里按需指定 */
  async function addImages(source: "album" | "camera") {
    const left = MAX_PICS - pics.length;
    if (left <= 0) {
      setSheetMsg("最多 9 张");
      return;
    }
    if (!(await checkMediaScope(source))) return;
    try {
      const res = await Taro.chooseMedia({
        count: left,
        mediaType: ["image"],
        sizeType: ["compressed"], // 微信侧先压一轮，缓解服务端单张 5MB 校验
        sourceType: [source],
      });
      const all = res.tempFiles ?? [];
      // 超 5MB 的图服务端必拒（单张上限），本地先拦掉省一次必败上传
      const sized = all.filter((f) => (f.size ?? 0) <= 5 * 1024 * 1024);
      const paths = sized.map((f) => f.tempFilePath).slice(0, left);
      if (all.length > sized.length) setSheetMsg("单张图片不能超过 5MB，已忽略超大图片");
      if (paths.length) setPics((prev) => [...prev, ...paths.map((p) => ({ path: p, status: "ready" as const }))]);
    } catch (e: any) {
      const raw = String(e?.errMsg ?? "");
      // 用户在选图面板点取消也走 reject：静默，只有真失败才报
      if (raw.includes("cancel")) return;
      // 授权被拒（auth deny）：就地提示 + 弹窗引导去设置页打开，比一句死报错多一步恢复路径
      if (raw.includes("auth") || raw.includes("deny")) {
        setSheetMsg("未授权相册/相机，请开启后重试");
        guideMediaSetting();
        return;
      }
      setSheetMsg(raw || "选图失败");
    }
  }

  function removePic(i: number) {
    if (uploading) return; // 上传中删图会和上传结果回写打架
    setPics((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** 把失败图回写成 error 态（保留缩略图供 ↻ 重试） */
  function keepFailed(all: Pic[], failed: string[]) {
    const s = new Set(failed);
    setPics(all.filter((p) => s.has(p.path)).map((p) => ({ path: p.path, status: "error" as const })));
  }

  async function publish() {
    const t = value.trim();
    if (!t || busy || uploading) return;
    const toSend = pics.filter((p) => p.status !== "error");
    const entryId = await onPublish(t);
    if (!entryId) {
      // 失败保留面板与已输文本（直接 onClose 会把没发出去的内容弄丢），错误原因在页面横幅
      setSheetMsg("发布失败，内容已保留，可直接重试");
      return;
    }
    lastEntryId.current = entryId;
    // 发布成功即清文本：失败图保留供「↻ 重试」，但正文已上墙——
    // 面板残留原文时再点「发布」会重复发一条动态（009 轮修复）
    setValue("");
    if (!toSend.length) {
      onClose(); // 无图：直接收尾
      return;
    }
    setPics((prev) => prev.map((p) => ({ ...p, status: "uploading" as const })));
    setUploading(true);
    try {
      const failed = await uploadWithRetry(entryId, toSend.map((p) => p.path));
      if (failed.length) {
        keepFailed(toSend, failed);
        setSheetMsg("动态已发布；部分图片上传失败，可「↻ 重试」或关闭面板");
        return;
      }
      setPics([]);
      onClose();
    } finally {
      setUploading(false);
    }
  }

  /** 图片发布失败后的手动补传（沿用 lastEntryId，只传 error 态的图） */
  async function retryUpload() {
    const entryId = lastEntryId.current;
    const errs = pics.filter((p) => p.status === "error");
    if (!entryId || !errs.length || uploading) return;
    setPics((prev) => prev.map((p) => ({ ...p, status: "uploading" as const })));
    setUploading(true);
    try {
      const failed = await uploadWithRetry(entryId, errs.map((p) => p.path));
      if (failed.length) {
        keepFailed(errs, failed);
        setSheetMsg(`仍有 ${failed.length} 张上传失败，请稍后再试`);
        return;
      }
      setPics([]);
      setSheetMsg(null);
      onClose();
    } catch (e: any) {
      keepFailed(errs, errs.map((p) => p.path));
      setSheetMsg(e?.message ?? "重试失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {/* 遮罩仅视觉；点遮罩不关闭——输入中的内容误触丢失代价高（= web 面板也只在 ✕/取消 关） */}
      <View className="overlay" />
      <View className="sheet ps-sheet">
        <View className="ps-head">
          <Text className="ps-title">记录此刻</Text>
          <View className="ps-close" onClick={cancel}>
            <LucideIcon name="x" size={16} color="var(--ink-dim)" />
          </View>
        </View>
        <Textarea
          className="ps-input"
          value={value}
          maxlength={2000}
          placeholder={'说点什么…（试试"刚跑完步40分钟，心情不错"、"明天下午三点看牙"）'}
          placeholderClass="input-placeholder"
          cursorSpacing={24}
          onInput={(e) => setValue(e.detail.value)}
        />
        {/* 接近上限才显示字数，平时不干扰（= web value.length >= 1800） */}
        {value.length >= 1800 ? (
          <Text className={`ps-count${value.length >= 1950 ? " ps-count-danger" : ""}`}>{value.length}/2000</Text>
        ) : null}

        {/* 已选图片缩略条（上传失败显示重试） */}
        {pics.length > 0 ? (
          <View className="ps-pics">
            {pics.map((p, i) => (
              <View key={`${p.path}-${i}`} className={`ps-pic${p.status === "error" ? " ps-pic-err" : ""}`}>
                <Image className="ps-pic-img" src={p.path} mode="aspectFill" />
                {p.status === "ready" ? (
                  <View className="ps-pic-del" onTap={() => removePic(i)}>
                    <LucideIcon name="x" size={11} color="#fff" />
                  </View>
                ) : null}
                {p.status === "uploading" ? (
                  <View className="ps-pic-mask">
                    <Text>上传中…</Text>
                  </View>
                ) : null}
                {p.status === "error" ? (
                  <View className="ps-pic-mask" onTap={retryUpload}>
                    <Text>↻ 重试</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {sheetMsg ? <Text className="ps-msg">{sheetMsg}</Text> : null}

        <View className="ps-foot">
          <View className="ps-tools">
            <View className="ps-tool" hoverClass="press" hoverStayTime={80} onTap={() => void addImages("album")}>
              <LucideIcon name="image_plus" size={15} color="var(--ink-soft)" />
            </View>
            <View className="ps-tool" hoverClass="press" hoverStayTime={80} onTap={() => void addImages("camera")}>
              <LucideIcon name="camera" size={15} color="var(--ink-soft)" />
            </View>
            <Text className="ps-hint">发布后 AI 自动识别</Text>
          </View>
          <View
            className={`btn-primary ps-send${busy || uploading || !value.trim() ? " disabled" : ""}`}
            hoverClass="press"
            hoverStayTime={80}
            onTap={() => void publish()}
          >
            <Text className="ps-send-text">{busy ? "识别中…" : uploading ? "上传中…" : "发布"}</Text>
          </View>
        </View>
      </View>
    </>
  );
}
