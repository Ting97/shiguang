/**
 * 分类图标选择器（= web icon-picker.tsx）：点击展开 emoji 网格（按主题分组）+ 自定义输入。
 * 小程序差异：web 的绝对定位浮层改为行内展开（触屏无 hover，行内展开更稳）。
 */
import { useState } from "react";
import { Input, Text, View } from "@tarojs/components";

/** 分类图标候选（emoji 网格，按主题分组，= web ICON_GROUPS） */
const ICON_GROUPS: Array<[string, string[]]> = [
  ["预设", ["😴", "💼", "📚", "💪", "👥", "🎮", "🧹", "🚌", "📌"]],
  ["运动", ["🏃", "🚴", "🏊", "🧘", "⚽", "🏀", "🎾", "🥊", "🤸"]],
  ["学习", ["✍️", "🧠", "💻", "📖", "✏️", "🔍", "🎓", "🔬", "🧩"]],
  ["生活", ["🍳", "🍜", "☕", "🛒", "🧺", "🛏️", "🚿", "🌱", "🐶", "🐱"]],
  ["娱乐", ["🎬", "🎵", "📺", "📱", "🎨", "🎲", "🎣", "📷", "🎈", "🀄"]],
  ["社交", ["❤️", "🎁", "🍻", "☎️", "💬", "🎉", "👨‍👩‍👧", "🤝", "🫶"]],
  ["出行", ["✈️", "🚗", "🚕", "🚲", "🗺️", "🏔️", "🏖️", "🏕️"]],
  ["健康", ["💊", "🩺", "🌿", "🫁", "🦷", "👁️"]],
  ["其他", ["⭐", "🔥", "💰", "🧾", "⏰", "🌙", "☀️", "🎯", "🛠️", "💡"]],
];

export default function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  return (
    <View className="icon-pick">
      <View className="icon-pick-btn" hoverClass="press" hoverStayTime={80} onTap={() => setOpen(!open)}>
        <Text>{value || "🏷"}</Text>
      </View>
      {open && (
        <View className="icon-pick-panel">
          {ICON_GROUPS.map(([group, icons]) => (
            <View key={group} className="icon-pick-group">
              <Text className="icon-pick-group-name">{group}</Text>
              <View className="icon-pick-grid">
                {icons.map((ic) => (
                  <View
                    key={ic}
                    className={`icon-pick-cell ${value === ic ? "active" : ""}`}
                    hoverClass="press"
                    hoverStayTime={80}
                    onTap={() => {
                      onChange(ic);
                      setOpen(false);
                    }}
                  >
                    <Text>{ic}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
          <View className="icon-pick-custom">
            <Input
              className="icon-pick-input"
              value={custom}
              maxlength={8}
              placeholder="自定义：粘贴 emoji"
              placeholderClass="input-placeholder"
              onInput={(e) => setCustom(e.detail.value)}
              onConfirm={() => {
                // 取首字符（= web [...custom.trim()][0]）
                const first = [...custom.trim()][0] ?? custom.trim();
                if (first) {
                  onChange(first);
                  setCustom("");
                  setOpen(false);
                }
              }}
            />
            <View
              className="icon-pick-ok"
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => {
                const first = [...custom.trim()][0] ?? custom.trim();
                if (first) {
                  onChange(first);
                  setCustom("");
                  setOpen(false);
                }
              }}
            >
              确定
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
