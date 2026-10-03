/**
 * 顶栏毛玻璃 pill（REQ-009 9-D 拆分自 App.tsx）：Feed/Trades 同款，
 * active chip 静态高亮、其余 chip 可点切换（onTab 缺省时不渲染非当前 chip，与拆分前一致）。
 */
import { Pressable, Text, View, type ColorSchemeName } from "react-native";
import { BlurView } from "expo-blur";
import type { Theme } from "../theme";
import { s } from "../styles";

const LABELS = { feed: "📝 动态", trades: "📈 交易" } as const;

export type ScreenKey = "feed" | "trades";

export default function TopNav({ t, scheme, active, onTab, onLogout, extra }: {
  t: Theme;
  scheme: ColorSchemeName;
  active: ScreenKey;
  onTab?: (s: ScreenKey) => void;
  onLogout: () => void;
  /** nav 右侧扩展位（如推送开关），渲染在「退出」左侧 */
  extra?: React.ReactNode;
}) {
  return (
    <BlurView
      intensity={scheme === "light" ? 70 : 55}
      tint={t.blurTint}
      experimentalBlurMethod="dimezisBlurView"
      style={[s.nav, { overflow: "hidden" }]}
    >
      <View style={[s.navInner, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
        <Text style={[s.navBrand, { color: t.title }]}>拾光</Text>
        <View style={s.navTabs}>
          {(["feed", "trades"] as const).map((key) => {
            if (key === active) {
              return (
                <View key={key} style={[s.navChip, { backgroundColor: t.elevated }]}>
                  <Text style={[s.navChipText, { color: t.inkSoft }]}>{LABELS[key]}</Text>
                </View>
              );
            }
            if (!onTab) return null; // 无切屏回调时与拆分前一致：不渲染另一个 tab
            return (
              <Pressable key={key} onPress={() => onTab(key)} hitSlop={6}>
                <View style={[s.navChip, { borderWidth: 1, borderColor: t.lineSoft }]}>
                  <Text style={[s.navChipText, { color: t.inkMute }]}>{LABELS[key]}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flex: 1 }} />
        {extra}
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={[s.navExit, { color: t.inkMute }]}>退出</Text>
        </Pressable>
      </View>
    </BlurView>
  );
}
