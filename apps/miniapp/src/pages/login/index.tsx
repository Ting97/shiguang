import { useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { passwordLogin } from "@/lib/api";
import { getSessionToken, setSessionToken } from "@/lib/session";
import "./index.scss";

export default function Login() {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"wx" | "pwd">("wx");
  const [wxErr, setWxErr] = useState<string | null>(null);

  async function wxLogin() {
    if (busy) return;
    setBusy(true);
    setWxErr(null);
    try {
      const { code } = await Taro.login();
      const j = await (await import("@/lib/api")).wechatLogin(code);
      if (j.bound && j.token) {
        setSessionToken(j.token);
        Taro.reLaunch({ url: "/pages/feed/index" });
        return;
      }
      // 未绑定：带票据去绑定页
      Taro.redirectTo({ url: `/pages/bind/index?ticket=${encodeURIComponent(j.bindTicket ?? "")}` });
    } catch (e: any) {
      setWxErr(e?.message ?? "微信登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function pwdLogin() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const j = await passwordLogin(phone.trim(), password);
      setSessionToken(j.token);
      Taro.reLaunch({ url: "/pages/feed/index" });
    } catch (e: any) {
      setErr(e?.message ?? "登录失败");
    } finally {
      setBusy(false);
    }
  }

  // 已登录直接进首页
  if (getSessionToken()) {
    Taro.reLaunch({ url: "/pages/feed/index" });
    return null;
  }

  return (
    <View className="login-pad">
      <View className="login-hero">
        <Text className="login-title">拾光</Text>
        <Text className="dim">钱 · 时间 · 人 —— 个人经营系统</Text>
      </View>

      {mode === "wx" ? (
        <View className="card">
          <Button className="btn-primary" disabled={busy} onClick={wxLogin}>
            {busy ? "登录中…" : "微信一键登录"}
          </Button>
          {wxErr && <View className="banner banner-err mt">{wxErr}</View>}
          {/未配置|503|通道/.test(wxErr ?? "") && (
            <Text className="dim mt">服务端未配置微信通道，可先用密码登录</Text>
          )}
          <View className="switch" onClick={() => setMode("pwd")}>
            <Text className="link">使用手机号密码登录</Text>
          </View>
        </View>
      ) : (
        <View className="card">
          <Input className="input mb" type="number" placeholder="手机号" value={phone} onInput={(e) => setPhone(e.detail.value)} />
          <Input className="input mb" password placeholder="密码" value={password} onInput={(e) => setPassword(e.detail.value)} />
          {err && <View className="banner banner-err mb">{err}</View>}
          <Button className={`btn-primary ${!phone.trim() || !password ? "disabled" : ""}`} disabled={!phone.trim() || !password || busy} onClick={pwdLogin}>
            {busy ? "登录中…" : "登录"}
          </Button>
          <View className="switch" onClick={() => setMode("wx")}>
            <Text className="link">使用微信一键登录</Text>
          </View>
        </View>
      )}

      <View className="foot">
        <Text className="dim">没有账号？注册需邀请码，请使用网页版</Text>
      </View>
    </View>
  );
}
