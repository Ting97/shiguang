/**
 * 「我的」页（= web app/profile/page.tsx 移动端形态；导航下移后为底部 tab 第 6 项 active=profile）。
 * 结构逐块对齐 web：居中渐变大标题 → 账号资料卡（渐变圆头像 + 手机号/已验证/管理员徽标 +
 * 加入时间 + 昵称保存）→ 修改密码 → 会话安全（全端登出两步确认）→ 套餐与 AI 用量（30 天
 * 窗口 + 进度条 + 按模型明细）→ 导出我的数据。
 * 与 web 的差异（微信壳特有，均注释标出）：
 * - 模块权限 chips（账号资料卡内）：分包模块开通状态（031），web profile 无此项。
 * - 「退出登录（仅本机）」：小程序导航栏无登出入口（nav-bar 已把登出收编到本页），web 在导航栏。
 * - 导出改为 downloadFile + shareFileMessage 转发文件（小程序无浏览器下载目录）。
 * - web 的「后台管理」入口（/admin）不迁移：小程序无后台页；管理员标识与不限量说明保留。
 * - 主题切换行（REQ-导航下移缩小）：原顶栏入口随导航改为底部 tab 后挪入本页资料卡。
 */
import { useCallback, useState } from "react";
import { View, Text, Input, Button } from "@tarojs/components";
import Taro from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import { useTheme } from "@/lib/theme";
import { showToast } from "@/components/toast";
import { logout, bindWechatSession, resolveWechatBind, type WechatBindConflict } from "@/lib/api";
import { API_BASE, ApiError } from "@/lib/request";
import { clearSessionToken, getSessionToken, setSessionToken, toLogin } from "@/lib/session";
import { fetchMeFull, updateProfile, logoutAll, loadPlan, type Me, type PlanQuota } from "./api";
import LucideIcon from "@/components/lucide-icon";
import WxBindSheet from "@/components/wx-bind-sheet";
import PhoneBindSheet from "@/components/phone-bind-sheet";
import "./index.scss";

/** 分包模块开通状态 → 展示名（未知 key 原样展示兜底） */
const MODULE_LABEL: Record<string, string> = {
  debt: "💳 负债",
  trade_review: "📊 收支复盘",
  trading: "📈 交易",
};

/** 北京时间口径：UTC getter + 8h（getUTC* 等本地 getter 在非中国时区设备会错 8 小时，= web zhDate） */
const zhDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
};

export default function Profile() {
  const [me, setMe] = useState<Me | null>(null);
  // 身份加载失败态：失败要落错误 + 重试入口（历史 bug：catch 空吞，永久「加载中…」；= web meErr 范式）
  const [meErr, setMeErr] = useState<string | null>(null);
  const [quotaErr, setQuotaErr] = useState<string | null>(null);
  const [quota, setQuota] = useState<PlanQuota | null>(null);
  const [nickname, setNickname] = useState("");
  const [savedNick, setSavedNick] = useState<string | null>(null);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [bindingWx, setBindingWx] = useState(false);
  const [bindConflict, setBindConflict] = useState<WechatBindConflict | null>(null);
  const [bindBusy, setBindBusy] = useState(false);
  const [phoneSheet, setPhoneSheet] = useState(false); // 绑定/更换手机号弹层（REQ-微信账号可补绑手机）
  // 外观主题三态循环（REQ-导航下移缩小：入口从顶栏挪入本页）
  const { mode: themeMode, cycle: cycleTheme } = useTheme();
  const themeName = themeMode === "dark" ? "深色" : themeMode === "light" ? "浅色" : "跟随系统";
  const [exporting, setExporting] = useState<"json" | "md" | null>(null);
  // 全端登出两步确认：首点进入待确认态，3 秒内再点执行（= web useArmConfirm("logout-all")）
  const [armed, setArmed] = useState(false);

  const loadMe = useCallback(() => {
    setMeErr(null);
    fetchMeFull()
      .then((j) => {
        setMe(j);
        setNickname(j.nickname ?? "");
        setSavedNick(j.nickname ?? "");
      })
      .catch((e) => setMeErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadQuota = useCallback(() => {
    setQuotaErr(null);
    loadPlan()
      .then(setQuota)
      .catch((e) => setQuotaErr(e instanceof Error ? e.message : String(e)));
  }, []);

  // 首次进入加载（token 就绪后，= feed/finance 的 inited 范式）
  const [inited, setInited] = useState(false);
  if (!inited && getSessionToken()) {
    setInited(true);
    loadMe();
    loadQuota();
  }

  async function saveNickname() {
    if (busy) return;
    setBusy(true);
    try {
      const j = await updateProfile({ nickname });
      showToast({ type: "ok", text: "✅ 昵称已更新" });
      setSavedNick(j.nickname ?? nickname.trim());
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  /** 绑定当前微信到本账号（REQ-绑定已有账户）：静默 wx.login 换 code；空壳回收静默完成，
   *  409 冲突（微信被有数据的账号占用）→ 弹「保留哪份数据」选择（REQ-账号数据保留选择） */
  async function bindWechatNow() {
    if (bindingWx) return;
    setBindingWx(true);
    try {
      const { code } = await Taro.login();
      const j = await bindWechatSession(code);
      showToast({ type: "ok", text: j.already ? "✓ 当前微信已绑定本账号" : "✅ 绑定成功，下次可微信一键登录" });
      loadMe();
    } catch (e) {
      const conflict = e instanceof ApiError && e.status === 409 ? (e.data as WechatBindConflict | undefined) : undefined;
      if (conflict?.code === "wechat_bind_conflict") {
        setBindConflict(conflict);
      } else {
        showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setBindingWx(false);
    }
  }

  /** 冲突弹层裁决：current=改绑（留在本账号）；wechat=切换登录到微信账号（换 token 后回首页重载） */
  async function resolveBind(resolve: "current" | "wechat") {
    if (bindBusy) return;
    setBindBusy(true);
    try {
      const { code } = await Taro.login();
      const j = await resolveWechatBind(code, resolve);
      if (resolve === "wechat") {
        if (j.token) setSessionToken(j.token);
        showToast({ type: "ok", text: `已进入微信账号「${j.user?.nickname ?? ""}」` });
        setBindConflict(null);
        Taro.reLaunch({ url: "/pages/feed/index" }); // 账号已切换：整栈重载
        return;
      }
      showToast({ type: "ok", text: "✅ 已绑定微信，下次可微信一键登录" });
      setBindConflict(null);
      loadMe();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBindBusy(false);
    }
  }

  async function savePassword() {
    if (busy) return;
    if (newPwd !== confirmPwd) {
      showToast({ type: "err", text: "两次输入的新密码不一致" });
      return;
    }
    setBusy(true);
    try {
      await updateProfile({
        currentPassword: currentPwd || undefined, // 从未设过密码可留空（服务端同口径）
        newPassword: newPwd,
      });
      showToast({ type: "ok", text: "✅ 密码已更新，下次登录请使用新密码" });
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function doLogoutAll() {
    // 两步确认（全站规范）：首点武装，3 秒内再点执行；超时自动解除
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
    setArmed(false);
    await logoutAll().catch(() => {}); // 吊销失败也照样退本机（与 web 一致）
    toLogin(); // 清 token + reLaunch 登录页（lib/session 统一收敛）
  }

  /** 微信特有：仅本机退出（web 的登出在导航栏；小程序导航无登出，收编到本页） */
  async function doLogoutLocal() {
    try {
      await logout();
    } catch {
      /* 忽略登出网络错误，本地清态为主 */
    }
    clearSessionToken();
    Taro.reLaunch({ url: "/pages/login/index" });
  }

  /**
   * 导出数据：web 为浏览器直接下载 /api/export?format=...；小程序壳无下载目录，
   * 等效实现 = downloadFile（带鉴权头）→ shareFileMessage 拉起转发（发文件传输助手即存档）。
   */
  async function exportData(format: "json" | "md") {
    if (exporting) return;
    setExporting(format);
    try {
      const token = getSessionToken();
      const res = await Taro.downloadFile({
        url: `${API_BASE}/api/export?format=${format}`,
        header: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.statusCode !== 200) throw new Error(`导出失败（${res.statusCode}）`);
      try {
        await Taro.shareFileMessage({
          filePath: res.tempFilePath,
          fileName: format === "json" ? "shiguang-backup.json" : "shiguang-moments.md",
        });
        showToast({ type: "ok", text: "✅ 已拉起转发，发送给「文件传输助手」即可保存" });
      } catch (e) {
        // 用户在转发面板取消也走 reject：静默，不算失败
        if (!String((e as { errMsg?: string })?.errMsg ?? "").includes("cancel")) throw e;
      }
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(null);
    }
  }

  const pct = quota && quota.limit ? Math.min(100, (quota.used / quota.limit) * 100) : 0;

  return (
    <PageShell active="profile">
      {/* = web h1 我的+个人设置 / p 个性化你的账号信息 */}
      <Text className="page-title text-gradient">
        我的<Text className="page-title-sub">个人设置</Text>
      </Text>
      <Text className="hint page-sub">个性化你的账号信息</Text>

      {/* 游客态：无 token 只读浏览（REQ-游客浏览）——渲染登录引导卡，不进账号分区 */}
      {!getSessionToken() ? (
        <View className="glass glass-p5 sec guest-card">
          <Text className="guest-title">游客浏览中</Text>
          <Text className="hint guest-sub">登录后才能记录与查看属于自己的动态、日程与财务</Text>
          <Button
            className="btn-primary guest-login-btn"
            hoverClass="press"
            onTap={() => Taro.reLaunch({ url: "/pages/login/index" })}
          >
            微信一键登录
          </Button>
        </View>
      ) : !me ? (
        meErr ? (
          <View className="state-center">
            <Text className="state-err">加载失败：{meErr}</Text>
            <Button className="btn-primary btn-retry" hoverClass="press" onTap={loadMe}>
              重试
            </Button>
          </View>
        ) : (
          <View className="state-center">
            <Text className="hint">加载中…</Text>
          </View>
        )
      ) : (
        <>
          {/* ---- 账号资料 = web section.glass.mb-5 ---- */}
          <View className="glass glass-p5 sec">
            <View className="me-head">
              <View className="avatar">{(savedNick || "我").slice(0, 1).toUpperCase()}</View>
              <View className="me-info">
                <Text className="me-name">{savedNick || "未设置昵称"}</Text>
                <View className="me-meta">
                  {me.phone ? (
                    <>
                      <Text>{me.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}</Text>
                      <Text className={`badge ${me.phoneVerified ? "badge-ok" : "badge-no"}`}>
                        {me.phoneVerified ? "已验证" : "未验证"}
                      </Text>
                    </>
                  ) : (
                    <Text>未绑定手机号</Text>
                  )}
                  {me.isAdmin && <Text className="badge badge-admin">管理员</Text>}
                </View>
                <Text className="me-joined">加入于 {zhDate(me.createdAt)}</Text>
                {/* 微信特有：模块权限 chips（分包功能开通状态，web profile 无此项） */}
                {me.modules && me.modules.length > 0 && (
                  <View className="mods">
                    {me.modules.map((m) => (
                      <Text key={m} className="chip mod-chip">
                        {MODULE_LABEL[m] ?? m}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <Text className="field-label">昵称</Text>
            <View className="nick-row">
              <Input
                className="input nick-input"
                maxlength={20}
                value={nickname}
                placeholder="给自己起个名字"
                placeholderClass="input-placeholder"
                onInput={(e) => setNickname(e.detail.value)}
              />
              <Button
                className={`btn-primary save-btn${busy || nickname.trim() === savedNick ? " disabled" : ""}`}
                hoverClass="press"
                disabled={busy || nickname.trim() === savedNick}
                onTap={saveNickname}
              >
                保存
              </Button>
            </View>

            {/* 外观主题（REQ-导航下移缩小） */}
            <View className="wx-bind-row">
              <Text className="hint wx-bind-text">外观主题（当前：{themeName}）</Text>
              <Button
                className="btn-sky-tinted wx-bind-btn"
                hoverClass="press"
                onTap={cycleTheme}
              >
                切换
              </Button>
            </View>
            {/* 微信绑定（REQ-绑定已有账户）：把当前微信迁到本账号，之后微信一键登录即进本账号 */}
            <View className="wx-bind-row">
              <Text className="hint wx-bind-text">
                {me.wechatBound === false ? "当前微信未绑定本账号" : "已绑定微信，可一键登录"}
              </Text>
              {me.wechatBound === false && (
                <Button
                  className={`btn-sky-tinted wx-bind-btn${bindingWx ? " disabled" : ""}`}
                  hoverClass="press"
                  disabled={bindingWx}
                  onTap={bindWechatNow}
                >
                  {bindingWx ? "绑定中…" : "绑定当前微信"}
                </Button>
              )}
            </View>
            {/* 手机号绑定（REQ-微信账号可补绑手机）：补绑后可用手机号登录网页版 */}
            <View className="wx-bind-row">
              <Text className="hint wx-bind-text">
                {me.phone ? `当前手机号 ${me.phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2")}` : "未绑定手机号，网页版将无法登录"}
              </Text>
              <Button
                className="btn-sky-tinted wx-bind-btn"
                hoverClass="press"
                onTap={() => setPhoneSheet(true)}
              >
                {me.phone ? "更换手机号" : "绑定手机号"}
              </Button>
            </View>
            {/* 使用手册（REQ-使用手册）：功能介绍与使用方式 */}
            <View className="wx-bind-row">
              <Text className="hint wx-bind-text">功能介绍与使用方式</Text>
              <Button
                className="btn-sky-tinted wx-bind-btn"
                hoverClass="press"
                onTap={() => Taro.navigateTo({ url: "/pages/manual/index" })}
              >
                使用手册
              </Button>
            </View>
          </View>

          {/* ---- 修改密码 = web section.glass ---- */}
          <View className="glass glass-p5 sec">
            <Text className="sec-title">修改密码</Text>
            <View className="stack">
              <Input
                className="input"
                password
                value={currentPwd}
                placeholder="当前密码（从未设过密码可留空）"
                placeholderClass="input-placeholder"
                onInput={(e) => setCurrentPwd(e.detail.value)}
              />
              <Input
                className="input"
                password
                value={newPwd}
                placeholder="新密码（至少 8 位）"
                placeholderClass="input-placeholder"
                onInput={(e) => setNewPwd(e.detail.value)}
              />
              <Input
                className="input"
                password
                value={confirmPwd}
                placeholder="确认新密码"
                placeholderClass="input-placeholder"
                onInput={(e) => setConfirmPwd(e.detail.value)}
              />
              <Button
                className={`btn-primary submit-btn${busy || !newPwd ? " disabled" : ""}`}
                hoverClass="press"
                disabled={busy || !newPwd}
                onTap={savePassword}
              >
                更新密码
              </Button>
            </View>
          </View>

          {/* ---- 会话安全 = web section.glass（4-B FR-C1.3 全端登出） ---- */}
          <View className="glass glass-p5 sec">
            <Text className="sec-title sec-title-tight">会话安全</Text>
            <Text className="hint sec-desc">
              吊销本账号在所有设备（网页/App）上的登录状态，适合怀疑账号异常时使用；本机也会一并退出。
            </Text>
            <Button
              className={`btn-logout${armed ? " btn-logout-armed" : ""}`}
              hoverClass="press"
              onTap={doLogoutAll}
            >
              {armed ? "确认在所有设备退出？（3 秒内再点）" : "全端登出"}
            </Button>
            {/* 微信特有：仅本机退出（web 登出入口在导航栏，小程序收编到本页） */}
            <Button className="btn-local-out" hoverClass="press" onTap={doLogoutLocal}>
              退出登录（仅本机）
            </Button>
          </View>

          {/* ---- 套餐与 AI 用量 = web section.glass（M3 商业化） ---- */}
          <View className="glass glass-p5 sec">
            <View className="sec-head">
              {/* = TagChip md（icon + label，violet 语义色） */}
              <View className="tag-chip tag-violet ico-row">
                <LucideIcon name="gem" size={13} color="var(--ai)" />
                <Text>套餐与 AI 用量</Text>
              </View>
            </View>
            {quota ? (
              <>
                <Text className="plan-line">
                  当前套餐：
                  <Text className={quota.plan === "pro" ? "plan-pro" : "plan-strong"}>
                    {quota.plan === "pro" ? "Pro" : "免费版"}
                  </Text>
                  {quota.planExpiresAt ? ` · Pro 有效期至 ${zhDate(quota.planExpiresAt)}` : ""}
                  {quota.isAdmin ? " · 管理员不限量" : ""}
                </Text>
                <View className="usage">
                  <View className="usage-row">
                    <Text>近 30 天 AI 识别次数</Text>
                    <Text>{quota.used}{quota.limit === null ? "（不限）" : ` / ${quota.limit}`}</Text>
                  </View>
                  {quota.limit !== null && (
                    <View className="bar">
                      <View
                        className={`bar-fill${quota.used >= quota.limit ? " bar-over" : ""}`}
                        style={{ width: `${pct}%` }}
                      />
                    </View>
                  )}
                </View>
                {quota.byModel && quota.byModel.length > 0 && (
                  <View className="models">
                    {quota.byModel.map((m) => (
                      <View key={m.model} className="model-row">
                        <Text className="model-name">{m.model || "其他模型"}</Text>
                        <Text className="model-stat">
                          近30天 {m.d30.calls} 次 · 累计 {m.all.calls} 次 /{" "}
                          {String(m.all.promptTokens + m.all.completionTokens).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} tokens
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                <Text className="plan-note">
                  语音速记、AI 识别、复盘均消耗次数；Pro 不限量。支付通道接入前，内测期间联系管理员开通 Pro。
                </Text>
              </>
            ) : quotaErr ? (
              <View>
                <Text className="state-err">加载失败：{quotaErr}</Text>
                <Button className="btn-primary btn-retry" hoverClass="press" onTap={loadQuota}>
                  重试
                </Button>
              </View>
            ) : (
              <Text className="hint plan-line">加载中…</Text>
            )}
            {/* web 的「后台管理」入口不迁移：小程序无后台页（管理员态已在套餐行标注） */}
          </View>

          {/* ---- 导出我的数据 = web section.glass（docs/06 P8 个人数据可携带） ---- */}
          <View className="glass glass-p5 sec">
            <View className="sec-head">
              <View className="tag-chip tag-slate ico-row">
                <LucideIcon name="download" size={13} color="var(--ink-mute)" />
                <Text>导出我的数据</Text>
              </View>
            </View>
            <Text className="hint export-desc">
              全量备份包含动态、日程、todo、流水、联系人与往来；Markdown 版可读性更好。建议定期备份。
            </Text>
            <View className="export-row">
              <Button
                className={`btn-sky-tinted exp-btn${exporting === "json" ? " disabled" : ""}`}
                hoverClass="press"
                disabled={!!exporting}
                onTap={() => exportData("json")}
              >
                {exporting === "json" ? "导出中…" : "全量备份 (JSON)"}
              </Button>
              <Button
                className={`exp-btn exp-neutral${exporting === "md" ? " disabled" : ""}`}
                hoverClass="press"
                disabled={!!exporting}
                onTap={() => exportData("md")}
              >
                {exporting === "md" ? "导出中…" : "动态日记 (Markdown)"}
              </Button>
            </View>
          </View>

          {/* 微信特有：关于卡（沿旧版内容：端标识 + 同源说明） */}
          <View className="glass glass-p4 about">
            <Text className="hint">拾光 · 微信小程序 v1.0（docs/15）</Text>
            <Text className="plan-note">数据与服务端与 Web/Expo 端同源</Text>
          </View>
        </>
      )}

      {/* 绑定/更换手机号弹层（REQ-微信账号可补绑手机） */}
      <PhoneBindSheet
        open={phoneSheet}
        onClose={() => setPhoneSheet(false)}
        onBound={() => void loadMe()}
      />
      {/* 绑定冲突选择弹层（REQ-账号数据保留选择，与登录页共用） */}
      <WxBindSheet
        open={!!bindConflict}
        conflict={bindConflict}
        busy={bindBusy}
        onResolve={(r) => void resolveBind(r)}
        onClose={() => setBindConflict(null)}
      />
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="user" label="我的" />
    </PageShell>
  );
}
