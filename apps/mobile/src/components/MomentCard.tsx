/**
 * 动态卡片（REQ-009 9-D 拆分自 App.tsx）：
 * 结构/样式对齐 Web moment-feed 的玻璃卡片（头像圈 + 意图标签 + 原文 + 收益标签）。
 */
import { View, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Moment } from "../api";
import type { Theme } from "../theme";
import { s } from "../styles";

export default function MomentCard({ m, t }: { m: Moment; t: Theme }) {
  const yuan = (cents: number) => `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
  const time = new Date(m.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
      {/* 顶部高光描边：玻璃卡片的受光面 */}
      <LinearGradient
        colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={s.cardHighlight}
        pointerEvents="none"
      />
      <View style={s.cardBody}>
        {/* 头像位：心情 emoji（无心情用 📝），对齐 Web 的 40px 圆圈 */}
        <View style={[s.avatar, { backgroundColor: t.elevated, borderColor: t.line }]}>
          <Text style={s.avatarIcon}>{m.mood ? "😊" : "📝"}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.cardHead}>
            <View style={[s.cardTag, { backgroundColor: t.elevated }]}>
              <Text style={[s.cardTagText, { color: t.inkMute }]}>📝 动态</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Text style={[s.cardTime, { color: t.inkDim }]}>{time}</Text>
          </View>
          <Text style={[s.cardText, { color: t.ink }]}>{m.raw_text}</Text>
          {(m.blocks.length > 0 || m.todos.length > 0 || m.transactions.length > 0) && (
            <View style={s.chips}>
              {m.blocks.length > 0 && (
                <Text style={[s.chip, { color: t.accent, borderColor: t.lineSoft, backgroundColor: t.bg }]}>
                  🕒 {m.blocks.length} 日程
                </Text>
              )}
              {m.todos.length > 0 && (
                <Text style={[s.chip, { color: t.accent, borderColor: t.lineSoft, backgroundColor: t.bg }]}>
                  📋 {m.todos.length} todo
                </Text>
              )}
              {m.transactions.map((tx) => (
                <Text
                  key={tx.id}
                  style={[s.chip, { color: tx.direction === "in" ? t.success : t.chipWarn, borderColor: t.lineSoft, backgroundColor: t.bg }]}
                >
                  💰 {tx.direction === "in" ? "+" : "-"}{yuan(tx.amount_cents)}
                </Text>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
