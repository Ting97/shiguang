/**
 * 底部中央悬浮圆圈（REQ-009 9-D 拆分自 App.tsx）：
 * 点按=文字，长按=语音（夜间浅蓝 / 日间奶白）+ 呼吸微光 + 录音脉冲环。
 * 手势回调与按压弹性（fabScale SharedValue）由 FeedScreen 持有，本组件纯展示+转发。
 */
import { ActivityIndicator, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue, withSpring } from "react-native-reanimated";
import type { Theme } from "../theme";
import { s } from "../styles";
import type { RecState } from "./RecordingOverlay";
import BreathingGlow from "./BreathingGlow";
import PulseRing from "./PulseRing";

export default function VoiceFab({ t, recState, cancelArmed, fabScale, onGrant, onMove, onRelease, onTerminate }: {
  t: Theme;
  recState: RecState;
  cancelArmed: boolean;
  fabScale: SharedValue<number>;
  onGrant: (e: { nativeEvent: { pageY: number } }) => void;
  onMove: (e: { nativeEvent: { pageY: number } }) => void;
  onRelease: () => void;
  onTerminate: () => void;
}) {
  const recording = recState === "recording";
  const fabScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: fabScale.value }] }));
  return (
    <View style={s.fabWrap} pointerEvents="box-none">
      <View style={{ width: 96, height: 96, alignItems: "center", justifyContent: "center" }}>
        {recording && (
          <>
            <PulseRing color={t.dangerSolid} delay={0} />
            <PulseRing color={t.dangerSolid} delay={700} />
          </>
        )}
        <Animated.View style={[s.fabGlowWrap, fabScaleStyle]}>
          {!recording && recState === "idle" && <BreathingGlow color={t.fab} />}
          <View
            style={[s.fab, { backgroundColor: recording ? t.dangerSolid : t.fab }, recState === "transcribing" && { opacity: 0.7 }]}
            onStartShouldSetResponder={() => recState === "idle"}
            onResponderGrant={onGrant}
            onResponderMove={onMove}
            onResponderRelease={onRelease}
            onResponderTerminate={onTerminate}
          >
            {recState === "transcribing" ? (
              <ActivityIndicator color={t.fabFg} size="small" />
            ) : (
              <Text style={[s.fabIcon, { color: t.fabFg }]}>🎙</Text>
            )}
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
