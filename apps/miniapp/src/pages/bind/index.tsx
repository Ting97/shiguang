import { useRef, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { sendSmsCode, wechatBind } from "@/lib/api";
import { setSessionToken } from "@/lib/session";
import "./index.scss";

export default function Bind() {
  const router = useRouter();
  const ticket = useRef(router.params.ticket ?? "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function sendCode() {
    if (countdown > 0 || busy) return;
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setMsg({ ok: false, text: "请填写正确的手机号" });
      return;
    }
    try {
      await sendSmsCode(phone.trim(), "bind");
      setMsg({ ok: true, text: "验证码已发送" });
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) clearInterval(timer);
          return c - 1;
        });
      }, 1000);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "发送失败" });
    }
  }

  async function doBind() {
    if (busy) return;
    if (!ticket.current) {
      setMsg({ ok: false, text: "绑定凭证缺失，请返回重新微信登录" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const j = await wechatBind(ticket.current, phone.trim(), code.trim());
      setSessionToken(j.token);
      Taro.reLaunch({ url: "/pages/feed/index" });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "绑定失败" });
    } finally {
      setBusy(false);
    }
  }

  const ready = /^1[3-9]\d{9}$/.test(phone.trim()) && code.trim().length >= 4;

  return (
    <View className="bind-pad">
      <View className="card">
        <Text className="h1">绑定手机号</Text>
        <Text className="dim">微信首次登录需绑定已有账号（注册请用网页版）</Text>
        <View className="mt32" />
        <Input className="input mb" type="number" maxlength={11} placeholder="手机号" value={phone} onInput={(e) => setPhone(e.detail.value)} />
        <View className="code-row">
          <Input className="input grow" type="number" maxlength={6} placeholder="短信验证码" value={code} onInput={(e) => setCode(e.detail.value)} />
          <Button className={`btn-ghost code-btn ${countdown > 0 ? "disabled" : ""}`} disabled={countdown > 0} onClick={sendCode}>
            {countdown > 0 ? `${countdown}s` : "发送验证码"}
          </Button>
        </View>
        {msg && <View className={`banner mt ${msg.ok ? "banner-ok" : "banner-err"}`}>{msg.text}</View>}
        <View className="mt32" />
        <Button className={`btn-primary ${!ready || busy ? "disabled" : ""}`} disabled={!ready || busy} onClick={doBind}>
          {busy ? "绑定中…" : "绑定并登录"}
        </Button>
      </View>
    </View>
  );
}
