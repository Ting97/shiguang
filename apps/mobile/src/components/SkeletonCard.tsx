/** 骨架屏假卡片（REQ-009 9-D 拆分自 App.tsx） */
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import type { Theme } from "../theme";
import { s } from "../styles";

export default function SkeletonCard({ t, delay }: { t: Theme; delay: number }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })),
        -1,
        false,
      ),
    );
  }, [sv, delay]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.3 * sv.value }));
  return (
    <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
      <View style={s.cardBody}>
        <View style={[s.avatar, { backgroundColor: t.elevated, borderColor: t.line }]} />
        <View style={{ flex: 1 }}>
          <View style={[s.skelLine, { backgroundColor: t.elevated, width: "30%" }]} />
          <Animated.View style={[s.skelLine, { backgroundColor: t.elevated, width: "88%", marginTop: 14 }, style]} />
          <Animated.View style={[s.skelLine, { backgroundColor: t.elevated, width: "62%", marginTop: 10 }, style]} />
        </View>
      </View>
    </View>
  );
}
