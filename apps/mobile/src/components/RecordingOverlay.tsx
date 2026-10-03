/**
 * 录音/识别浮层（REQ-009 9-D 拆分自 App.tsx）：全屏暗幕 + 毛玻璃信息卡。
 * pointerEvents=none 纯视觉，否则浮层插入手势中途会吃掉 FAB 的松手事件，导致录音停不下来。
 */
import { ActivityIndicator, Text, View, type ColorSchemeName } from "react-native";
import { BlurView } from "expo-blur";
import type { Theme } from "../theme";
import { VOICE_MAX_SECONDS } from "../consts";
import { s } from "../styles";
import WaveBar from "./WaveBar";

export type RecState = "idle" | "recording" | "transcribing";

export default function RecordingOverlay({ t, scheme, recState, seconds, cancelArmed }: {
  t: Theme;
  scheme: ColorSchemeName;
  recState: RecState;
  seconds: number;
  cancelArmed: boolean;
}) {
  if (recState === "idle") return null;
  const recording = recState === "recording";
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <View style={[s.overlay, { backgroundColor: t.scrim }]} pointerEvents="none">
      <BlurView intensity={scheme === "light" ? 60 : 45} tint={t.blurTint} experimentalBlurMethod="dimezisBlurView" style={[s.overlayCardWrap, { overflow: "hidden", borderRadius: 20 }]}>
        <View style={[s.overlayCard, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
          {recording ? (
            <>
              <View style={s.recRow}>
                <View style={[s.recDot, { backgroundColor: t.dangerSolid }]} />
                <Text style={[s.recTime, { color: t.dangerSolid }]}>{mmss}</Text>
              </View>
              <View style={s.waveRow}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <WaveBar key={i} index={i} color={cancelArmed ? t.dangerSolid : t.accent} />
                ))}
              </View>
              <Text style={[s.overlayHint, { color: cancelArmed ? t.dangerSolid : t.inkMute }]}>
                {cancelArmed ? "↑ 松开取消" : `松开识别文字 · 上滑取消（最长 ${VOICE_MAX_SECONDS} 秒）`}
              </Text>
            </>
          ) : (
            <>
              <ActivityIndicator color={t.accentBright} />
              <Text style={[s.overlayHint, { color: t.inkMute }]}>识别中…</Text>
            </>
          )}
        </View>
      </BlurView>
    </View>
  );
}
