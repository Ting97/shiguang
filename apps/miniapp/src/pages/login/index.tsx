/**
 * 登录页（= web app/login/page.tsx 移动端形态；NAVLESS 无导航页，不用 PageShell）。
 * 三条进入路径（REQ-游客/微信直登）：
 * 1. 微信一键登录（主按钮）：getUserProfile 授权弹窗（用户可拒绝）→ Taro.login →
 *    POST /api/auth/wechat/login（服务端对未绑定 openid 自动建号，免绑手机号）→ 进首页。
 *    getUserProfile 必须在用户点击手势内最先调用，故排在 Taro.login 之前。
 * 2. 密码登录：web 老账号（手机号/邮箱 + 密码）。验证码登录入口已按需求移除。
 * 3. 游客模式：免登录只读浏览，标记存 storage，登录成功时清除。
 * 输入框加高（REQ-登录页可用性）：min-height 96 单位 + 加大内边距，占位文字清晰。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { showToast, ToastHost } from "@/components/toast";
import { wechatLogin, bindWechatSession } from "@/lib/api";
import { enterGuest, exitGuest, getSessionToken, setSessionToken } from "@/lib/session";
import { syncNativeBackground, useTheme } from "@/lib/theme";
import { loginWithPassword, EMAIL_RE, PHONE_RE } from "./api";
import "./index.scss";

export default function Login() {
  const { theme } = useTheme(); // NAVLESS 页自己挂主题（= PageShell 的 app-bg + theme-light 职责）
  const [account, setAccount] = useState(""); // 手机号或邮箱（含 @ 自动识别）
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false); // 明文切换
  // 密码登录成功后是否同时把当前微信绑到该账号（REQ-绑定已有账户）：默认开，可取消
  const [bindWx, setBindWx] = useState(true);
  const [busy, setBusy] = useState(false);
  const [wxErr, setWxErr] = useState<string | null>(null);

  // 已登录直接回首页（有 token 即走；token 失效由各页 401 统一打回登录）
  useEffect(() => {
    if (getSessionToken()) Taro.reLaunch({ url: "/pages/feed/index" });
  }, []);

  // NAVLESS 页没有 PageShell，原生页面底色同步要自己做（下拉/回弹露出的原生底）
  useEffect(() => {
    syncNativeBackground(theme);
  }, [theme]);

  /** 登录成功统一收口：清游客标记 + reLaunch 清栈进首页（= web location.href = "/"） */
  function enterApp() {
    exitGuest();
    Taro.reLaunch({ url: "/pages/feed/index" });
  }

  /**
   * 微信一键登录：先请求授权资料（用户手势内调用才会弹授权窗；拒绝则匿名继续），
   * 再静默拿 code。服务端对未绑定 openid 自动建号（免绑手机号），始终发 token。
   */
  async function wxLogin() {
    if (busy) return;
    setBusy(true);
    setWxErr(null);
    try {
      let profile: { nickname?: string } | undefined;
      try {
        const p = await Taro.getUserProfile({ desc: "用于创建你的拾光昵称" });
        const nick = p.userInfo?.nickName?.trim();
        // 微信新版基础库可能返回匿名昵称「微信用户」——交给服务端生成随机昵称更友好
        if (nick && nick !== "微信用户") profile = { nickname: nick };
      } catch {
        /* 用户拒绝授权或基础库不支持：匿名建号，昵称进「我的」可改 */
      }
      const { code } = await Taro.login();
      const j = await wechatLogin(code, profile);
      if (j.token) {
        setSessionToken(j.token);
        enterApp();
        return;
      }
      // 服务端始终发 token；走到这里说明响应异常，按错误处理
      setWxErr("登录响应异常，请重试或使用账号登录");
    } catch (e) {
      setWxErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    const email = account.includes("@");
    if (email ? !EMAIL_RE.test(account) : !PHONE_RE.test(account)) {
      showToast({ type: "err", text: email ? "请填写正确的邮箱地址" : "请填写正确的手机号" });
      return;
    }
    if (!password) {
      showToast({ type: "err", text: "请填写密码" });
      return;
    }
    setBusy(true);
    try {
      await loginWithPassword(account.trim(), password);
      // request 层已自动入库 token；勾选了「同时绑定此微信」则静默绑定（失败不阻塞登录）
      if (bindWx) {
        try {
          const { code } = await Taro.login();
          const j = await bindWechatSession(code);
          showToast({
            type: "ok",
            text: j.already ? "✓ 微信已绑定本账号" : "✅ 已绑定微信，下次可一键登录",
          });
        } catch {
          showToast({ type: "err", text: "微信绑定未完成，可稍后在「我的」中绑定" });
        }
      }
      enterApp();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  /** 游客模式：免登录只读浏览；登录成功时 exitGuest 清标记 */
  function browseAsGuest() {
    enterGuest();
    Taro.reLaunch({ url: "/pages/feed/index" });
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
          <Text className="hint brand-sub">拾起光阴，经营自己</Text>
        </View>

        {/* ---- 表单卡 = web glass rounded-2xl p-5 ---- */}
        <View className="glass glass-p5">
          {/* 微信一键登录主按钮（保持 web 主按钮渐变，非微信绿）；含用户授权弹窗 */}
          <Button
            className={`btn-primary submit-btn wx-btn${busy ? " disabled" : ""}`}
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
          <Text className="hint wx-hint">登录即同意创建账号，无需绑定手机号，昵称可在「我的」中修改</Text>

          {/* 分隔线：上为微信登录、下为 web 同款账号表单 */}
          <View className="alt-divider">
            <Text className="alt-divider-text">或使用账号密码登录</Text>
          </View>

          {/* = web space-y-3 输入组（仅保留密码登录；验证码入口已按需求移除） */}
          <View className="fields">
            <Input
              className="input"
              value={account}
              placeholder="手机号 / 邮箱"
              placeholderClass="input-placeholder"
              onInput={(e) => setAccount(e.detail.value)}
            />
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

            {/* 同时绑定此微信（REQ-绑定已有账户）：密码登录成功后静默迁移 openid */}
            <View className="bind-check" hoverClass="press" hoverStayTime={80} onTap={() => setBindWx((v) => !v)}>
              <View className={`check-box${bindWx ? " check-on" : ""}`} />
              <Text className="bind-check-text">同时绑定此微信，以后可一键登录</Text>
            </View>

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
          <Text className="reg-hint">已有网页版账号？直接用手机号/邮箱登录即可同步数据</Text>
        </View>

        {/* 游客入口：免登录只读浏览（提审体验 + 新用户试用） */}
        <Button className="btn-ghost guest-btn" hoverClass="press" onTap={browseAsGuest}>
          游客模式，先逛逛 →
        </Button>
        <Text className="hint guest-hint">游客可浏览各页面；登录后才能记录自己的动态、日程与财务</Text>

        {/* 页脚 = web mt-6 text-[10px] text-ink-faint */}
        <Text className="foot-line">个人经营系统 · 钱 · 时间 · 人</Text>
      </View>
      {/* NAVLESS 页无 PageShell：全局 toast 宿主自挂（REQ-009 9-C） */}
      <ToastHost />
    </View>
  );
}
