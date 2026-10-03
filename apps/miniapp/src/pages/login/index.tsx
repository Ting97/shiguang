/**
 * 登录页（= web app/login/page.tsx 移动端形态；NAVLESS 无导航页，不用 PageShell）。
 * 结构逐块对齐 web：整页居中 max-w-sm → hero（SVG 品牌 logo + 渐变标题 + 副标）→
 * glass 表单卡（登录方式 pill 切换 → 账号输入 → 验证码+60s 倒计时 / 密码+明文切换 →
 * 渐变提交钮）→ 卡内注册引导 → 页脚小字。
 * 与 web 的差异（微信壳特有，均注释标出）：
 * - 卡顶新增「微信一键登录」主按钮（web 无微信登录项）：Taro.login 静默拿 code →
 *   POST /api/auth/wechat/login；已绑定直接进首页，未绑定携 bindTicket 去绑定页。
 * - web 的「凭邀请码注册」切换在本页不可用（小程序不提供注册），仅留网页版引导文案。
 * - 已登录直接 reLaunch 首页（= web 进页 /api/auth/me 成功后跳 /，小程序以本地 token 判定）。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { showToast, ToastHost } from "@/components/toast";
import { wechatLogin } from "@/lib/api";
import { getSessionToken, setSessionToken } from "@/lib/session";
import { syncNativeBackground, useTheme } from "@/lib/theme";
import { loginWithCode, loginWithPassword, sendLoginCode, EMAIL_RE, PHONE_RE } from "./api";
import "./index.scss";

export default function Login() {
  const { theme } = useTheme(); // NAVLESS 页自己挂主题（= PageShell 的 app-bg + theme-light 职责）
  const [mode, setMode] = useState<"password" | "sms">("password"); // 登录方式：密码/验证码
  const [account, setAccount] = useState(""); // 手机号或邮箱（含 @ 自动识别）
  const [password, setPassword] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [showPwd, setShowPwd] = useState(false); // 明文切换
  const [countdown, setCountdown] = useState(0);
  // 验证码请求飞行中锁：与 countdown 分开（countdown 成功后才启动），飞行中也要禁用按钮防连发
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wxErr, setWxErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // 已登录直接回首页（有 token 即走；token 失效由 feed 页 401 统一打回登录）
  useEffect(() => {
    if (getSessionToken()) Taro.reLaunch({ url: "/pages/feed/index" });
  }, []);

  useEffect(() => {
    // 卸载时清理倒计时 interval，避免离开页面后空跑最长 60s（= web cleanup）
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

  // NAVLESS 页没有 PageShell，原生页面底色同步要自己做（下拉/回弹露出的原生底）
  useEffect(() => {
    syncNativeBackground(theme);
  }, [theme]);

  function startCountdown() {
    if (timer.current) clearInterval(timer.current); // 防御：上一轮未清先清，避免双 interval
    setCountdown(60);
    timer.current = setInterval(() => setCountdown((c) => c - 1), 1000);
  }

  async function sendCode() {
    if (sending) return; // 请求飞行中忽略再次点击，防重复发送
    const email = account.includes("@");
    if (email ? !EMAIL_RE.test(account) : !PHONE_RE.test(account)) {
      // = web login 同款：校验与操作反馈统一 toast（REQ-009 9-C，下同）
      showToast({ type: "err", text: email ? "请先填写正确的邮箱地址" : "请先填写正确的手机号" });
      return;
    }
    setSending(true);
    try {
      await sendLoginCode(account);
      showToast({ type: "ok", text: "验证码已发送，5 分钟内有效" });
      startCountdown();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "password") {
        await loginWithPassword(account.trim(), password);
      } else {
        await loginWithCode(account.trim(), smsCode);
      }
      // request 层已自动入库 token；进首页用 reLaunch 清栈（= web location.href = "/"）
      Taro.reLaunch({ url: "/pages/feed/index" });
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  /** 微信特有：一键登录（web login 无此项）。未绑定→携 bindTicket 去绑定页（navigateTo 保留返回栈） */
  async function wxLogin() {
    if (busy) return;
    setBusy(true);
    setWxErr(null);
    try {
      const { code } = await Taro.login();
      const j = await wechatLogin(code);
      if (j.bound && j.token) {
        setSessionToken(j.token);
        Taro.reLaunch({ url: "/pages/feed/index" });
        return;
      }
      Taro.navigateTo({ url: `/pages/bind/index?ticket=${encodeURIComponent(j.bindTicket ?? "")}` });
    } catch (e) {
      setWxErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className={`app-bg login-screen${theme === "light" ? " theme-light" : ""}`}>
      {/* = web main > div.max-w-sm：整列居中，手机宽下即满宽减页边距 */}
      <View className="login-col">
        {/* ---- hero：品牌 logo + 渐变标题 + 副标（= web mb-6 text-center 块） ---- */}
        <View className="brand">
          {/* 品牌 logo：一束光落入承光弧（拾起光阴）；小程序不支持内联 svg，同图形以 data-url 背景落进 scss */}
          <View className="brand-logo" />
          <Text className="brand-title text-gradient">拾光</Text>
          <Text className="hint brand-sub">拾起光阴，记录今日 · 登录后继续</Text>
        </View>

        {/* ---- 表单卡 = web glass rounded-2xl p-5 ---- */}
        <View className="glass glass-p5">
          {/* 微信特有：一键登录主按钮（保持 web 主按钮渐变，非微信绿） */}
          <Button
            className={`btn-primary submit-btn${busy ? " disabled" : ""}`}
            hoverClass="press"
            disabled={busy}
            onTap={wxLogin}
          >
            {busy ? "登录中…" : "微信一键登录"}
          </Button>
          {wxErr && <Text className="msg msg-err">{wxErr}</Text>}
          {/* 服务端未配置微信通道（503）时给出兜底提示，引导用下方账号登录 */}
          {/未配置|503|通道/.test(wxErr ?? "") && (
            <Text className="hint wx-hint">服务端未配置微信通道，可先用下方方式登录</Text>
          )}

          {/* 微信特有分隔线：上为微信登录、下为 web 同款账号表单 */}
          <View className="alt-divider">
            <Text className="alt-divider-text">或使用账号登录</Text>
          </View>

          {/* 登录方式 pill 切换（= web rounded-full border bg-bg/50 p-0.5，激活渐变底） */}
          <View className="mode-switch">
            <View
              className={`mode-pill${mode === "password" ? " mode-pill-active" : ""}`}
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => setMode("password")}
            >
              密码登录
            </View>
            <View
              className={`mode-pill${mode === "sms" ? " mode-pill-active" : ""}`}
              hoverClass="press"
              hoverStayTime={80}
              onTap={() => setMode("sms")}
            >
              验证码登录
            </View>
          </View>

          {/* = web space-y-3 输入组 */}
          <View className="fields">
            <Input
              className="input"
              value={account}
              placeholder="手机号 / 邮箱"
              placeholderClass="input-placeholder"
              onInput={(e) => setAccount(e.detail.value)}
            />

            {mode === "sms" ? (
              <View className="code-row">
                <Input
                  className="input code-input"
                  type="number"
                  maxlength={6}
                  value={smsCode}
                  placeholder="6 位验证码"
                  placeholderClass="input-placeholder"
                  onInput={(e) => setSmsCode(e.detail.value)}
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
            ) : (
              <View className="pwd-wrap">
                <Input
                  className="input pwd-input"
                  password={!showPwd}
                  value={password}
                  placeholder="密码"
                  placeholderClass="input-placeholder"
                  onInput={(e) => setPassword(e.detail.value)}
                />
                {/* 明文切换（= web Eye/EyeOff 绝对定位钮；图标以 data-url 背景画） */}
                <View
                  className={`eye-btn ${showPwd ? "eye-off" : "eye-on"}`}
                  hoverClass="press"
                  hoverStayTime={80}
                  onTap={() => setShowPwd((v) => !v)}
                />
              </View>
            )}

            <Button
              className={`btn-primary submit-btn${busy ? " disabled" : ""}`}
              hoverClass="press"
              disabled={busy}
              onTap={submit}
            >
              {busy ? "处理中…" : "登录"}
            </Button>
          </View>

          {/* = web「没有账号？凭邀请码注册」一行；小程序不开放注册，改为网页版引导 */}
          <Text className="reg-hint">没有账号？注册需邀请码，请使用网页版</Text>
        </View>

        {/* 页脚 = web mt-6 text-[10px] text-ink-faint */}
        <Text className="foot-line">个人经营系统 · 钱 · 时间 · 人</Text>
      </View>
      {/* NAVLESS 页无 PageShell：全局 toast 宿主自挂（REQ-009 9-C） */}
      <ToastHost />
    </View>
  );
}
