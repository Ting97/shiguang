/**
 * 动态极光背景（REQ-009 9-D 拆分自 App.tsx）：三色径向光晕缓慢漂移 + 呼吸（Skia GPU 绘制，性能无忧）。
 */
import { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  Easing, useDerivedValue, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import type { Theme } from "../theme";

export default function AuroraBackground({ t }: { t: Theme }) {
  const { width: W, height: H } = useWindowDimensions();
  const r = Math.max(W, H) * 0.62;
  // 漂移与呼吸：各自独立的缓慢往复
  const p = useSharedValue(0);
  const breathe = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 22000, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 22000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    breathe.value = withRepeat(
      withSequence(withTiming(1, { duration: 5000, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 5000, easing: Easing.inOut(Easing.quad) })),
      -1,
      false,
    );
  }, [p, breathe]);

  // Skia 属性动画必须经由 useDerivedValue 桥接 SharedValue
  const cx1 = useDerivedValue(() => W * (0.18 + 0.22 * p.value));
  const cy1 = useDerivedValue(() => H * (0.08 + 0.06 * (1 - p.value)));
  const cx2 = useDerivedValue(() => W * (0.95 - 0.18 * p.value));
  const cy2 = useDerivedValue(() => H * (0.38 + 0.05 * p.value));
  const cx3 = useDerivedValue(() => W * (0.25 + 0.1 * (1 - p.value)));
  const cy3 = useDerivedValue(() => H * (0.92 - 0.05 * p.value));
  const skyOp = useDerivedValue(() => t.aurora.sky * (0.75 + 0.25 * breathe.value));

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={cx1} cy={cy1} r={r} opacity={skyOp}>
        <RadialGradient c={vec(W * 0.3, H * 0.12)} r={r} colors={["#38bdf8", "rgba(56,189,248,0)"]} />
      </Circle>
      <Circle cx={cx2} cy={cy2} r={r * 0.85} opacity={t.aurora.indigo}>
        <RadialGradient c={vec(W * 0.9, H * 0.4)} r={r * 0.85} colors={["#818cf8", "rgba(129,140,248,0)"]} />
      </Circle>
      <Circle cx={cx3} cy={cy3} r={r * 0.8} opacity={t.aurora.pink}>
        <RadialGradient c={vec(W * 0.3, H * 0.9)} r={r * 0.8} colors={["#f472b6", "rgba(244,114,182,0)"]} />
      </Circle>
    </Canvas>
  );
}
