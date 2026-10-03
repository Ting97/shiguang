/** 呼吸微光层（FAB 待机光晕；REQ-009 9-D 拆分自 App.tsx） */
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

export default function BreathingGlow({ color }: { color: string }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withRepeat(
      withSequence(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1800, easing: Easing.inOut(Easing.quad) })),
      -1,
      false,
    );
  }, [sv]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.18 + 0.16 * sv.value,
    transform: [{ scale: 1 + 0.12 * sv.value }],
  }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: 999 }, style]} />;
}
