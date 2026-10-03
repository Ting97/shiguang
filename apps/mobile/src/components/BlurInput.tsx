/** 玻璃输入框：聚焦光晕描边（accent 边框渐变过渡；REQ-009 9-D 拆分自 App.tsx） */
import { useState } from "react";
import { TextInput } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import type { Theme } from "../theme";
import { s } from "../styles";

export default function BlurInput({
  t, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, multiline,
}: {
  t: Theme; placeholder: string; value: string; onChangeText: (v: string) => void;
  secureTextEntry?: boolean; keyboardType?: "email-address"; autoCapitalize?: "none"; multiline?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const style = useAnimatedStyle(() => ({
    borderColor: withTiming(focused ? t.accent : t.lineSoft, { duration: 180 }),
  }));
  return (
    <Animated.View style={[multiline ? s.inputWrapMultiline : s.inputWrap, { backgroundColor: t.surface }, style]}>
      <TextInput
        style={multiline ? [s.inputMultiline, { color: t.ink }] : [s.input, { color: t.ink }]}
        placeholder={placeholder} placeholderTextColor={t.inkFaint}
        value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry}
        keyboardType={keyboardType} autoCapitalize={autoCapitalize}
        multiline={multiline} maxLength={multiline ? 2000 : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      />
    </Animated.View>
  );
}
