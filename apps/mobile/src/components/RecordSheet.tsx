/**
 * 底部文字输入面板（REQ-009 9-D 拆分自 App.tsx）：
 * 点按 FAB=空面板；语音转写结果回填预览，确认后才发布。
 */
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View, type ColorSchemeName } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { Theme } from "../theme";
import { s } from "../styles";
import BlurInput from "./BlurInput";

export default function RecordSheet({ t, scheme, visible, onClose, text, onTextChange, sending, onSend }: {
  t: Theme;
  scheme: ColorSchemeName;
  visible: boolean;
  onClose: () => void;
  text: string;
  onTextChange: (v: string) => void;
  sending: boolean;
  onSend: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.sheetWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <BlurView intensity={scheme === "light" ? 50 : 40} tint={t.blurTint} experimentalBlurMethod="dimezisBlurView" style={s.sheetBackdrop}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim }]} />
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </BlurView>
        <View style={[s.sheet, { backgroundColor: t.surface, borderTopColor: t.glassBorder }]}>
          <View style={s.sheetHead}>
            <Text style={[s.sheetTitle, { color: t.inkSoft }]}>记录此刻</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[s.sheetClose, { color: t.inkDim }]}>✕</Text>
            </Pressable>
          </View>
          <BlurInput
            t={t} placeholder="说点什么…（试试“刚跑完步40分钟，心情不错”）"
            value={text} onChangeText={onTextChange} multiline
          />
          <View style={s.sheetFoot}>
            <Text style={[s.sheetHint, { color: t.inkFaint }]}>发布后 AI 自动识别日程 / todo / 收支 / 心情</Text>
            <Pressable
              style={[s.gradBtnWrapSheet, (!text.trim() || sending) && { opacity: 0.45 }]}
              onPress={onSend} disabled={!text.trim() || sending}
            >
              <LinearGradient colors={["#0ea5e9", "#6366f1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gradBtnSheet}>
                {sending ? <ActivityIndicator color="#ffffff" size="small" /> : <Text style={s.gradBtnText}>发布</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
