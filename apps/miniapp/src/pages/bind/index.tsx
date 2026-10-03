/**
 * 绑定页（微信壳特有页，web 无对应页；NAVLESS 不用 PageShell）：
 * 微信一键登录未绑定时携 bindTicket 落到本页，短信验证码绑定已有账号 → POST
 * /api/auth/wechat/bind {bindTicket, phone, smsCode} 换正式会话。
 * 结构/样式沿用 web 登录页表单卡语言（= web app/login/page.tsx 的卡内形态）：
 * 顶部「‹ 返回」+ 居中 glass 卡（渐变标题 + 说明 + 手机号 + 验证码+60s 倒计时 + 渐变提交钮）。
 * 入口用 navigateTo（登录页在栈内，「‹ 返回」= Taro.navigateBack）；绑定成功 reLaunch 清栈进首页。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import Taro, { useRouter } from "@tarojs/taro";
import { showToast, ToastHost } from "@/components/toast";
import { sendSmsCode, wechatBind } from "@/lib/api";
import { setSessionToken } from "@/lib/session";
import { syncNativeBackground, useTheme } from "@/lib/theme";
import "./index.scss";

export default function Bind() {
  const { theme } = useTheme(); // NAVLESS 页自己挂主题（= PageShell 职责）
  const router = useRouter();
  const ticket = useRef(router.params.ticket ?? "");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  // 验证码请求飞行中锁：与 countdown 分开（countdown 成功后才启动），飞行中也禁用按钮防连发
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 卸载时清理倒计时 interval，避免离开页面后空跑最长 60s（= web login 同款清理）
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  useEffect(() => {
    if (countdown <= 0 && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, [countdown]);

  // NAVLESS 页没有 PageShell，原生页面底色同步自己做
  useEffect(() => {
    syncNativeBackground(theme);
  }, [theme]);

  function goBack() {
    // 直开本页（无登录页在栈内）时退无可退，兜底回登录页
    if (Taro.getCurrentPages().length > 1) Taro.navigateBack();
    else Taro.reLaunch({ url: "/pages/login/index" });
  }

  async function sendCode() {
    if (sending || countdown > 0) return; // 飞行中/倒计时内忽略再次点击
    const p = phone.trim();
    if (!/^1[3-9]\d{9}$/.test(p)) {
      showToast({ type: "err", text: "请填写正确的手机号" });
      return;
    }
    setSending(true);
    try {
      await sendSmsCode(p, "bind"); // 绑定专用 purpose（未配置通道 503 直接报错展示）
      showToast({ type: "ok", text: "验证码已发送，5 分钟内有效" });
      setCountdown(60);
      timer.current = setInterval(() => setCountdown((c) => c - 1), 1000);
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  async function doBind() {
    if (busy) return;
    if (!ticket.current) {
      showToast({ type: "err", text: "绑定凭证缺失，请返回重新微信登录" });
      return;
    }
    setBusy(true);
    try {
      const j = await wechatBind(ticket.current, phone.trim(), code.trim());
      setSessionToken(j.token); // request 层已自动入库，此处显式保持旧数据流
      Taro.reLaunch({ url: "/pages/feed/index" });
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const ready = /^1[3-9]\d{9}$/.test(phone.trim()) && code.trim().length >= 4;

  return (
    <View className={`app-bg bind-screen${theme === "light" ? " theme-light" : ""}`}>
      {/* 顶部返回行（= web 同位置返回链；NAVLESS 自绘导航所以手工排） */}
      <View className="bind-top safe-top">
        <View className="back-btn" hoverClass="press" hoverStayTime={80} onTap={goBack}>
          <Text>‹ 返回</Text>
        </View>
      </View>

      {/* 居中卡（= web login 表单卡 max-w-sm 形态） */}
      <View className="bind-center">
        <View className="glass glass-p5 bind-card">
          <Text className="bind-title text-gradient">绑定手机号</Text>
          <Text className="hint bind-desc">微信首次登录需绑定已有账号（注册请用网页版）</Text>

          <View className="fields">
            <Input
              className="input"
              type="number"
              maxlength={11}
              value={phone}
              placeholder="手机号"
              placeholderClass="input-placeholder"
              onInput={(e) => setPhone(e.detail.value)}
            />

            <View className="code-row">
              <Input
                className="input code-input"
                type="number"
                maxlength={6}
                value={code}
                placeholder="6 位短信验证码"
                placeholderClass="input-placeholder"
                onInput={(e) => setCode(e.detail.value)}
              />
              <Button
                className={`code-btn${countdown > 0 || sending ? " disabled" : ""}`}
                hoverClass="press"
                disabled={countdown > 0 || sending}
                onTap={sendCode}
              >
                {sending ? "发送中…" : countdown > 0 ? `${countdown}s` : "发送验证码"}
              </Button>
            </View>

            <Button
              className={`btn-primary submit-btn${!ready || busy ? " disabled" : ""}`}
              hoverClass="press"
              disabled={!ready || busy}
              onTap={doBind}
            >
              {busy ? "绑定中…" : "绑定并登录"}
            </Button>
          </View>
        </View>
      </View>
      {/* NAVLESS 页无 PageShell：全局 toast 宿主自挂（REQ-009 9-C） */}
      <ToastHost />
    </View>
  );
}
