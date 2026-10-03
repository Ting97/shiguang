/** 居中占位容器（REQ-009 9-D 拆分自 App.tsx）：启动 loading 等 */
import { View } from "react-native";
import { s } from "../styles";

export default function Center({ children, bg }: { children: React.ReactNode; bg?: string }) {
  return <View style={[s.root, s.center, bg ? { backgroundColor: bg } : null]}>{children}</View>;
}
