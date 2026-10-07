/**
 * 绑定手机号弹层（REQ-微信账号可补绑手机）：微信一键登录建的号没有手机号，
 * 补绑后可用「手机号+密码」登录网页版（密码走「我的 → 修改密码」设置）。
 * 流程 = web 绑定页同构：手机号 → 发验证码（purpose=bind，60s 倒计时）→ 输码 → 绑定。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import { showToast } from "@/components/toast";
import { bindPhone, sendSmsCode } from "@/lib/api";
import "./index.scss";

const PHONE_RE = /^1[3-9]\d{9}$/;

export default function PhoneBindSheet({
  open,
  onClose,
  onBound,
}: {
  open: boolean;
  onClose: () => void;
  onBound: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (countdown <= 0 && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [countdown]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  function close() {
    setCode("");
    onClose();
  }

  async function send() {
    if (sending || countdown > 0) return;
    if (!PHONE_RE.test(phone.trim())) {
      showToast({ type: "err", text: "请填写正确的手机号" });
      return;
    }
    setSending(true);
    try {
      await sendSmsCode(phone.trim(), "bind");
      setCountdown(60);
      timer.current = setInterval(() => setCountdown((c) => c - 1), 1000);
      showToast({ type: "ok", text: "验证码已发送" });
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (busy) return;
    if (!PHONE_RE.test(phone.trim())) {
      showToast({ type: "err", text: "请填写正确的手机号" });
      return;
    }
    if (!code.trim()) {
      showToast({ type: "err", text: "请填写短信验证码" });
      return;
    }
    setBusy(true);
    try {
      await bindPhone(phone.trim(), code.trim());
      showToast({ type: "ok", text: "✅ 手机号已绑定，可在网页版用手机号登录" });
      setPhone("");
      setCode("");
      onBound();
      close();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <>
      <View className="overlay" onClick={close} />
      <View className="sheet phonebs safe-bottom">
        <View className="phonebs-handle" />
        <Text className="phonebs-title">绑定手机号</Text>
        <Text className="hint phonebs-desc">绑定后可用手机号登录网页版；密码在下方「修改密码」中设置</Text>

        <Input
          className="phonebs-input"
          type="number"
          maxlength={11}
          value={phone}
          placeholder="手机号"
          placeholderClass="input-placeholder"
          onInput={(e) => setPhone(e.detail.value)}
        />
        <View className="phonebs-code-row">
          <Input
            className="phonebs-input phonebs-code"
            type="number"
            maxlength={6}
            value={code}
            placeholder="短信验证码"
            placeholderClass="input-placeholder"
            onInput={(e) => setCode(e.detail.value)}
          />
          <Button
            className={`btn-reset phonebs-send${countdown > 0 || sending ? " disabled" : ""}`}
            hoverClass="press"
            disabled={countdown > 0 || sending}
            onClick={() => void send()}
          >
            {countdown > 0 ? `${countdown}s` : sending ? "发送中…" : "获取验证码"}
          </Button>
        </View>

        <Button
          className={`btn-reset btn-primary phonebs-submit${busy ? " disabled" : ""}`}
          hoverClass="press"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "绑定中…" : "绑定"}
        </Button>
        <Text className="phonebs-cancel" onClick={close}>
          暂不绑定
        </Text>
      </View>
    </>
  );
}
