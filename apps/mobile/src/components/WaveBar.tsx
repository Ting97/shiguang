/** 录音声波条：错峰跳动的弹性竖条（REQ-009 9-D 拆分自 App.tsx） */
import { useEffect } from "react";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

export default function WaveBar({ index, color }: { index: number; color: string }) {
  const sv = useSharedValue(0);
  useEffect(() => {
    sv.value = withDelay(
      index * 85,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 320 + index * 22, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 320 + index * 22, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [sv, index]);
  const style = useAnimatedStyle(() => ({ height: 10 + 30 * sv.value }));
  return <Animated.View style={[{ width: 5, borderRadius: 3, backgroundColor: color }, style]} />;
}
