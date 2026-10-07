/**
 * 游客态门（= schedule 页「未登录，请先登录」早退范式的组件化）：
 * 游客进入无服务端只读通道（/api 全部 401），旧版 8 个页面停在永久「加载中…/骨架屏」无任何出口。
 * 统一渲染：模块说明 + 引导登录按钮（回登录页）；已登录返回 null，页面正常拉数据。
 */
import { View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import "./index.scss";

export default function GuestGate({ title, desc }: { title: string; desc: string }) {
  return (
    <View className="guest-gate">
      <Text className="guest-gate-title">{title}</Text>
      <Text className="guest-gate-desc">{desc}</Text>
      <Text className="guest-gate-hint">游客模式无法加载数据，登录后即可使用</Text>
      <View className="guest-gate-btn" onClick={() => Taro.reLaunch({ url: "/pages/login/index" })}>
        <Text className="guest-gate-btn-text">去登录</Text>
      </View>
    </View>
  );
}
