import { useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { fetchMe, logout, type SessionUser } from "@/lib/api";
import { clearSessionToken, getSessionToken } from "@/lib/session";
import "./index.scss";

const MODULE_LABEL: Record<string, string> = {
  debt: "💳 负债",
  trade_review: "📊 收支复盘",
  trading: "📈 交易",
};

export default function Profile() {
  const [me, setMe] = useState<(SessionUser & { isAdmin?: boolean; modules?: string[] }) | null>(null);
  const [inited, setInited] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!inited && getSessionToken()) {
    setInited(true);
    fetchMe()
      .then(setMe)
      .catch((e) => setErr(e?.message ?? "加载失败"));
  }

  async function doLogout() {
    try {
      await logout();
    } catch {
      /* 忽略登出网络错误，本地清态为主 */
    }
    clearSessionToken();
    Taro.reLaunch({ url: "/pages/login/index" });
  }

  return (
    <View className="page-pad">
      <View className="card">
        <Text className="h1">{me?.nickname ?? "拾光用户"}</Text>
        {err && <Text className="dim">{err}</Text>}
        {me?.modules && me.modules.length > 0 && (
          <View className="mods">
            {me.modules.map((m) => (
              <Text key={m} className="chip">{MODULE_LABEL[m] ?? m}</Text>
            ))}
          </View>
        )}
      </View>

      <View className="card">
        <Text className="dim">拾光 · 微信小程序 v1.0（docs/15）</Text>
        <Text className="dim">数据与服务端与 Web/Expo 端同源</Text>
      </View>

      <Button className="btn-ghost danger" onClick={doLogout}>
        退出登录
      </Button>
    </View>
  );
}
