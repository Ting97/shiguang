/** 录音脉冲扩散环（REQ-009 9-D 拆分自 App.tsx） */
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from "react-native-reanimated";

export default function PulseRing({ color, delay }: { color: string; delay: number }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [sv, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.55 * (1 - sv.value),
    transform: [{ scale: 1 + 1.1 * sv.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: 999, borderWidth: 2, borderColor: color }, style]}
    />
  );
}
