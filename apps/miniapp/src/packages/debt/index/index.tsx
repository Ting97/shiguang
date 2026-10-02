/**
 * 负债管理分包页 —— 与 web /finance/debt 移动端逐块对齐（基准 apps/web/src/app/finance/debt/page.tsx + components/debt/*）。
 * 结构：hero → pill 二级导航 → 总览卡区(总负债/月供/加权利率/净资产 + 现金流月视图 + hints) →
 * 每月备付(清单勾选/进度/储蓄覆盖) → 到期墙 → 负债档案(行内 CRUD) → 清债策略模拟 → footer。
 * 与 web 的差异（小程序约束）：
 * - 「📥导入」只渲染按钮并提示走 web 端（web DebtImportDrawer 用 FileReader 解析 JSON，小程序无此能力）；
 * - 新建/编辑档案、还款弹层用底部 sheet（web Modal 的移动端形态）；
 * - 策略模拟滑杆松手触发改为 Slider onChange +「开始模拟」按钮（触屏无 pointerup 语义差异，按钮更可靠）。
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Input, Button, Picker, Slider } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import { fetchMe, yuan } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { ApiError } from "@/lib/request";
import {
  DEBT_TYPES,
  DEBT_TYPE_META,
  bjMonthStr,
  bjToday,
  archiveDebt,
  createDebt,
  fmt,
  loadAccountList,
  loadDebts,
  loadOverview,
  loadReserve,
  payDebt,
  runSimulation,
  setAccountReserve,
  setReserveAll,
  setReserveCheck,
  shiftYm,
  updateDebt,
  type AccRow,
  type Debt,
  type DebtOverview,
  type DebtType,
  type ReserveData,
  type SimResult,
} from "./api";
import "./index.scss";

/* ---------- 二级 pill 导航（= web finance-tabs.tsx；与 pages/finance 同款，分包各自持有副本避免跨包依赖） ---------- */

const TABS = [
  { key: "finance", label: "📊 概览", path: "/pages/finance/index", module: null as string | null },
  { key: "debt", label: "🏦 负债", path: "", module: "debt" },
  { key: "review", label: "📈 收支复盘", path: "/packages/review/index/index", module: "trade_review" },
  { key: "trading", label: "🎯 交易", path: "/packages/trading/index/index", module: "trading" },
];

export function FinTabs({ modules }: { modules: string[] | null }) {
  const has = (m: string) => modules?.includes(m) ?? false;
  return (
    <View className="fin-tabs">
      <View className="pill-nav">
        {TABS.filter((t) => !t.module || has(t.module)).map((t) => {
          const current = t.key === "debt";
          return (
            <View
              key={t.key}
              className={`pill${current ? " pill-active" : ""}`}
              hoverClass={current ? "" : "press"}
              hoverStayTime={80}
              onTap={() => !current && Taro.redirectTo({ url: t.path })}
            >
              {t.label}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ---------- TagChip（= web tag-chip.tsx） ---------- */

type Tone = "sky" | "emerald" | "amber" | "rose" | "violet" | "slate";
export function Chip({ icon, label, tone }: { icon: string; label: string; tone: Tone }) {
  return (
    <Text className={`chip chip-${tone}`}>
      {icon ? `${icon} ` : ""}
      {label}
    </Text>
  );
}

/* ---------- 骨架屏 ---------- */

export function FinSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <View className="fin-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="skeleton fin-skeleton-row" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </View>
  );
}

/* ---------- 模块未开通空态（= web module-locked.tsx） ---------- */

function ModuleLocked({ title, desc }: { title: string; desc: string }) {
  return (
    <View className="locked-card glass">
      <Text className="locked-icon">🔒</Text>
      <Text className="locked-title">{title}未开通</Text>
      <Text className="locked-desc">{desc}</Text>
      <View className="btn-sky-tinted locked-back" hoverClass="press" onTap={() => Taro.redirectTo({ url: "/pages/finance/index" })}>
        ← 返回财务概览
      </View>
    </View>
  );
}

/* ---------- 新建/编辑档案表单（= web debt/forms.tsx DebtForm；元输入提交转分） ---------- */

function DebtForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: Debt | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<DebtType>(initial?.type ?? "credit_card");
  const [principal, setPrincipal] = useState(initial ? String(Number(initial.principal_cents) / 100) : "");
  const [balance, setBalance] = useState(initial ? String(Number(initial.balance_cents) / 100) : "");
  const [rate, setRate] = useState(initial ? String(initial.rate_pct) : "");
  const [monthly, setMonthly] = useState(initial?.monthly_cents != null ? String(Number(initial.monthly_cents) / 100) : "");
  const [payDay, setPayDay] = useState(initial?.pay_day ? String(initial.pay_day) : "");
  const [dueDate, setDueDate] = useState(initial?.due_date?.slice(0, 10) ?? "");
  const [priority, setPriority] = useState(initial ? String(initial.priority) : "0");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 输入行标签（= web label text-[11px] 包 input 的 grid-cols-2 布局）
  const numField = (label: string, value: string, setter: (v: string) => void, placeholder: string) => (
    <View className="debt-form-field">
      <Text className="debt-form-label">{label}</Text>
      <Input className="input debt-form-input" type="digit" value={value} onInput={(e) => setter(e.detail.value)} placeholder={placeholder} placeholderClass="input-placeholder" />
    </View>
  );

  return (
    <View className="debt-form">
      <View className="debt-form-row">
        <Input className="input debt-form-name" value={name} onInput={(e) => setName(e.detail.value)} placeholder="名称（如：招行信用卡）" placeholderClass="input-placeholder" maxlength={40} />
        <Picker
          mode="selector"
          range={DEBT_TYPES.map((t) => `${DEBT_TYPE_META[t].icon} ${DEBT_TYPE_META[t].label}`)}
          onChange={(e) => setType(DEBT_TYPES[Number(e.detail.value)])}
        >
          <View className="debt-form-pick">
            <Text>
              {DEBT_TYPE_META[type].icon} {DEBT_TYPE_META[type].label}
            </Text>
            <Text className="pick-arrow">▾</Text>
          </View>
        </Picker>
      </View>
      <View className="debt-form-grid">
        {numField("本金（元）", principal, setPrincipal, "原始本金")}
        {numField("当前余额（元）", balance, setBalance, "默认=本金")}
        {numField("年化利率 %", rate, setRate, "0~36")}
        {numField("月供（元，亲友可空）", monthly, setMonthly, "可空")}
        {numField("每月还款日", payDay, setPayDay, "1~31 可空")}
        <View className="debt-form-field">
          <Text className="debt-form-label">到期/结清日</Text>
          <Picker mode="date" value={dueDate || bjToday()} onChange={(e) => setDueDate(e.detail.value)}>
            <View className="input debt-form-input date-pick">
              <Text>{dueDate || "选择日期"}</Text>
              <Text className="pick-arrow">▾</Text>
            </View>
          </Picker>
        </View>
      </View>
      <View className="debt-form-row">
        <View className="debt-form-priority">
          <Text className="debt-form-label">优先级</Text>
          <Input className="input debt-form-pri-input" type="number" value={priority} onInput={(e) => setPriority(e.detail.value)} placeholderClass="input-placeholder" />
        </View>
        <Input className="input debt-form-note" value={note} onInput={(e) => setNote(e.detail.value)} placeholder="备注（可空）" placeholderClass="input-placeholder" />
      </View>
      {err ? <Text className="form-err">{err}</Text> : null}
      <View className="form-foot">
        <View className="form-cancel" onTap={onCancel}>
          取消
        </View>
        <Button
          className={`btn-primary form-save ${busy || !name.trim() || !principal ? "disabled" : ""}`}
          disabled={busy || !name.trim() || !principal}
          hoverClass="press"
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              // 元→分 + 可选字段收敛（= web DebtForm 提交 payload 完全同构）
              const cents = (v: string, fallback: number | null = null) => {
                const n = Math.round(parseFloat(v) * 100);
                return Number.isFinite(n) ? n : fallback;
              };
              await onSubmit({
                name: name.trim(),
                type,
                principalCents: cents(principal, 0),
                ...(balance ? { balanceCents: cents(balance, 0) } : {}),
                ratePct: Number.isFinite(parseFloat(rate)) ? parseFloat(rate) : 0,
                monthlyCents: monthly ? cents(monthly, 0) : null,
                payDay: payDay ? Number(payDay) : null,
                dueDate: dueDate || null,
                priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
                note: note || null,
              });
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : initial ? "保存" : "建档"}
        </Button>
      </View>
    </View>
  );
}

/* ---------- 还款表单（= web debt/forms.tsx PaymentForm） ---------- */

function PaymentForm({
  debt,
  accounts,
  onCancel,
  onDone,
  onError,
}: {
  debt: Debt;
  accounts: AccRow[];
  onCancel: () => void;
  onDone: (text: string) => Promise<void>;
  onError: (text: string) => void;
}) {
  // 建议还款额：有月供填月供，否则 min(余额, ¥1000)
  const suggest = debt.monthly_cents != null ? Number(debt.monthly_cents) / 100 : Math.min(Number(debt.balance_cents) / 100, 1000);
  const [amount, setAmount] = useState(String(suggest));
  const [paidAt, setPaidAt] = useState(bjToday());
  const [accIdx, setAccIdx] = useState(0); // 0 = 不联动记账
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const ACC_OPTIONS = ["不联动记账", ...accounts.map((a) => `${a.icon} ${a.name}`)];

  return (
    <View className="debt-form">
      <View className="pay-info">
        当前余额 {fmt(debt.balance_cents)} · 年化 {debt.rate_pct}%
        {debt.monthly_cents != null ? ` · 月供 ${fmt(debt.monthly_cents)}` : ""}
      </View>
      <View className="debt-form-row">
        <Input className="input pay-amt" type="digit" value={amount} onInput={(e) => setAmount(e.detail.value)} placeholder="还款金额（元）" placeholderClass="input-placeholder" />
        <Picker mode="date" value={paidAt} onChange={(e) => setPaidAt(e.detail.value)}>
          <View className="debt-form-pick pay-date">
            <Text>{paidAt}</Text>
            <Text className="pick-arrow">▾</Text>
          </View>
        </Picker>
      </View>
      <View className="debt-form-row">
        <Picker mode="selector" range={ACC_OPTIONS} value={accIdx} onChange={(e) => setAccIdx(Number(e.detail.value))}>
          <View className="debt-form-pick pay-acc">
            <Text>{ACC_OPTIONS[accIdx]}</Text>
            <Text className="pick-arrow">▾</Text>
          </View>
        </Picker>
        <Input className="input pay-note" value={note} onInput={(e) => setNote(e.detail.value)} placeholder="备注（可空）" placeholderClass="input-placeholder" />
      </View>
      <Text className="pay-tip">{accIdx > 0 ? "✓ 将同时在所选账户记一笔「还款」支出流水" : "仅记录还款进度，不生成流水（避免与已有记账重复）"}</Text>
      <View className="form-foot">
        <View className="form-cancel" onTap={onCancel}>
          取消
        </View>
        <Button
          className={`btn-primary form-save ${busy || !amount ? "disabled" : ""}`}
          disabled={busy || !amount}
          hoverClass="press"
          onClick={async () => {
            const cents = Math.round(parseFloat(amount) * 100);
            if (!Number.isFinite(cents) || cents <= 0) return;
            setBusy(true);
            try {
              const r = await payDebt(debt.id, { amountCents: cents, paidAt, accountId: accIdx > 0 ? accounts[accIdx - 1].id : null, note: note || null });
              const cleared = r.debt?.status === "cleared";
              await onDone(cleared ? `🎉 已还清「${debt.name}」，档案自动标记为已结清` : `✅ 已记还款 ${fmt(cents)}`);
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : "确认还款"}
        </Button>
      </View>
    </View>
  );
}

/* ==================================================================== */

export default function DebtPage() {
  const [debts, setDebts] = useState<Debt[] | null>(null);
  const [ov, setOv] = useState<DebtOverview | null>(null);
  const [reserve, setReserve] = useState<ReserveData | null>(null);
  const [accounts, setAccounts] = useState<AccRow[]>([]);
  const [ym, setYm] = useState(bjMonthStr());
  const [locked, setLocked] = useState(false);
  const [modules, setModules] = useState<string[] | null>(null);
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Debt | null | "new">(null);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const [resBusy, setResBusy] = useState(false);
  const [extra, setExtra] = useState(100000); // 每月额外还款（分），默认 ¥1000
  const [sim, setSim] = useState<SimResult | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  // 归档两步确认
  const [armId, setArmId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inited, setInited] = useState(false);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [msg]);

  async function load(y = ym) {
    setLoadErr(null);
    try {
      const [d, o] = await Promise.all([loadDebts(), loadOverview()]);
      setDebts(d.debts ?? d.liabilities ?? []);
      setOv(o);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setLocked(true);
        setDebts([]);
        return;
      }
      // 非 403 的失败不停在骨架屏
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
    // 备付挂了不拖垮主数据（reserve 内部再容错）
    loadReserve(y)
      .then((r) => setReserve(r))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) return; // 未开通模块：整页已是锁定态
        setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      });
    // 账户列表仅供还款选账/储蓄覆盖勾选：失败不阻塞负债页主数据
    loadAccountList()
      .then((a) => setAccounts(a.accounts ?? []))
      .catch(() => undefined);
  }

  if (!inited && getSessionToken()) {
    setInited(true);
    void load();
    fetchMe()
      .then((j) => setModules(j.modules ?? []))
      .catch(() => setModules([]));
  }

  usePullDownRefresh(() => {
    load().finally(() => Taro.stopPullDownRefresh());
  });

  const hasModule = modules?.includes("debt") ?? false;

  async function reloadReserve(nextYm = ym) {
    try {
      setReserve(await loadReserve(nextYm));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 备付月份切换（web shiftMonth 同款 UTC 构造） */
  function shiftReserveMonth(delta: number) {
    const next = shiftYm(ym, delta);
    setYm(next);
    void reloadReserve(next);
  }

  /** 勾选/取消备付。坑：合并行「组内任一勾选即整组已勾」（服务端按 name 合并、checked 取组内 some），
   * 取消只 PUT 单个 id 会对组内其余行静默无效，必须整组逐个取消；勾选发单 id 即可。 */
  async function toggleReserve(row: ReserveData["items"][number], checked: boolean) {
    if (resBusy) return;
    setResBusy(true);
    try {
      const ids = checked ? [row.liabilityId] : row.liabilityIds?.length ? row.liabilityIds : [row.liabilityId];
      for (const id of ids) {
        await setReserveCheck(ym, id, checked);
      }
      await reloadReserve();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setResBusy(false);
    }
  }

  async function toggleAllReserve(checked: boolean) {
    if (resBusy || !reserve || reserve.items.length === 0) return;
    setResBusy(true);
    try {
      await setReserveAll(ym, checked);
      await reloadReserve();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setResBusy(false);
    }
  }

  async function toggleAccountReserve(a: AccRow) {
    try {
      await setAccountReserve(a.id, !a.reserveTracked);
      await reloadReserve();
      const r = await loadAccountList();
      setAccounts(r.accounts ?? []);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function armArchive(d: Debt) {
    // 两步确认（全站规范）：首点进入待确认态，3 秒内再点执行
    if (armId !== d.id) {
      setArmId(d.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmId(null), 3000);
      return;
    }
    setArmId(null);
    try {
      await archiveDebt(d.id);
      setMsg({ ok: true, text: "📦 已归档" });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function runSim(cents: number) {
    if (simBusy) return; // 推演进行中忽略再次触发：滑杆连放会并发乱序，慢的旧响应可能覆盖新结果
    setSimBusy(true);
    try {
      setSim(await runSimulation(cents));
    } catch (e) {
      setSim(null);
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSimBusy(false);
    }
  }

  /* ---- 派生数据 ---- */
  const active = (debts ?? []).filter((d) => d.status === "active");
  const settled = (debts ?? []).filter((d) => d.status !== "active");
  const t = ov?.totals;
  const cf = ov?.cashFlow;
  const pct = reserve && reserve.totalNeed > 0 ? Math.round((reserve.checkedNeed / reserve.totalNeed) * 100) : 0;
  const gap = reserve ? Number(reserve.savingsCents) - reserve.totalNeed : 0;

  /* ---- 锁定态：与 web locked 分支一致，只渲染 ModuleLocked 卡 ---- */
  if (locked || (modules !== null && !hasModule)) {
    return (
      <PageShell active="finance">
        <ModuleLocked title="负债管理" desc="该模块由管理员授权后开放，可联系管理员开通。" />
      </PageShell>
    );
  }

  const mainReady = debts !== null && ov !== null;

  return (
    <PageShell active="finance">
      {/* hero（= web header） */}
      <View className="fin-hero">
        <View className="fin-hero-line">
          <Text className="hero text-gradient">拾光</Text>
          <Text className="fin-hero-sub">负债管理</Text>
        </View>
        <Text className="fin-hero-tip">档案、还款、到期墙与清债策略 —— 看得清，还得动</Text>
      </View>

      <FinTabs modules={modules} />

      {msg ? <View className={`msg-banner ${msg.ok ? "msg-banner-ok" : "msg-banner-err"}`}>{msg.text}</View> : null}

      {debts !== null && loadErr ? (
        <View className="msg-banner msg-banner-err">
          加载失败：{loadErr}
          <View className="retry-link" onTap={() => void load()}>
            重试
          </View>
        </View>
      ) : null}

      {!mainReady ? (
        loadErr ? (
          <View className="loadfail">
            <Text className="loadfail-text">加载失败：{loadErr}</Text>
            <Button className="btn-primary loadfail-btn" hoverClass="press" onClick={() => void load()}>
              重试
            </Button>
          </View>
        ) : (
          <FinSkeleton rows={4} />
        )
      ) : (
        <>
          {/* 总览卡区（= glass rounded-2xl p-5） */}
          {t && (
            <View className="glass glass-p5 debt-card">
              <View className="ov-grid2">
                <View className="ov-cell">
                  <Text className="ov-label">总负债（含亲友）</Text>
                  <Text className="ov-num money-out">{fmt(t.balanceCents)}</Text>
                  {Number(t.bankCents) !== Number(t.balanceCents) && (
                    <Text className="ov-sub hint-faint tabular">银行口径 {fmt(t.bankCents)}</Text>
                  )}
                </View>
                <View className="ov-cell">
                  <Text className="ov-label">月供合计</Text>
                  <Text className="ov-num">{fmt(t.monthlyDueCents)}</Text>
                  <Text className="ov-sub hint-faint">{t.liabilityCount} 笔进行中</Text>
                </View>
                <View className="ov-cell">
                  <Text className="ov-label">加权利率</Text>
                  <Text className="ov-num budget-warn">{t.weightedRatePct}%</Text>
                  <Text className="ov-sub hint-faint">按余额加权</Text>
                </View>
                <View className="ov-cell">
                  <Text className="ov-label">净资产</Text>
                  <Text className={`ov-num ${Number(ov!.netWorthCents) >= 0 ? "money-in" : "money-out"}`}>{fmt(ov!.netWorthCents)}</Text>
                  <Text className="ov-sub hint-faint tabular">
                    资产 {fmt(ov!.assetBalanceCents)} − 负债
                  </Text>
                </View>
              </View>

              {/* 现金流月视图（= mt-4 border-t pt-3 text-[11px]） */}
              {cf && (
                <View className="debt-cashflow">
                  <View className="debt-cashflow-col">
                    <Text className="debt-cashflow-line">
                      {cf.monthKey.slice(0, 4)}年{Number(cf.monthKey.slice(5))}月结余
                      <Text className={`debt-strong tabular ${Number(cf.realizedCents) >= 0 ? "money-in" : "money-out"}`}> {fmt(cf.realizedCents)}</Text>
                    </Text>
                    <Text className="hint-faint">
                      收入 {fmt(cf.incomeCents)} · 支出 {fmt(cf.expenseCents)}
                    </Text>
                  </View>
                  <View className="debt-cashflow-col">
                    <Text className="debt-cashflow-line">
                      剩余月供
                      <Text className="debt-strong budget-warn tabular"> {fmt(cf.remainingDueCents)}</Text>
                    </Text>
                    <Text className={`debt-strong ${Number(cf.gapCents) >= 0 ? "money-in" : "money-out"}`}>
                      {Number(cf.gapCents) >= 0 ? "盈余 " : "缺口 "}
                      {fmt(Math.abs(Number(cf.gapCents)))}
                    </Text>
                  </View>
                </View>
              )}

              {ov!.hints.length > 0 && (
                <View className="debt-hints">
                  {ov!.hints.map((h, i) => (
                    <Text key={i} className="debt-hint">
                      💡 {h}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* 每月备付（= web reserve-section.tsx） */}
          <View className="glass glass-p5 debt-card">
            <View className="res-head">
              <Text className="res-title">🧰 每月备付</Text>
              <View className="res-ops">
                <View className="nav-btn nav-btn-sm" hoverClass="press" onTap={() => shiftReserveMonth(-1)}>
                  ‹
                </View>
                <Text className="res-ym tabular">
                  {ym.slice(0, 4)}年{Number(ym.slice(5))}月
                </Text>
                <View className="nav-btn nav-btn-sm" hoverClass="press" onTap={() => shiftReserveMonth(1)}>
                  ›
                </View>
                <View
                  className={`res-op-all ${resBusy || !reserve || reserve.items.length === 0 ? "disabled" : ""}`}
                  hoverClass="press"
                  onTap={() => void toggleAllReserve(true)}
                >
                  一键备付
                </View>
                <View
                  className={`res-op-clear ${resBusy || !reserve || reserve.items.length === 0 ? "disabled" : ""}`}
                  hoverClass="press"
                  onTap={() => void toggleAllReserve(false)}
                >
                  清空
                </View>
              </View>
            </View>

            {!reserve ? (
              <Text className="res-empty">加载中…</Text>
            ) : reserve.items.length === 0 ? (
              <Text className="res-empty">本月没有进行中的负债应还</Text>
            ) : (
              <>
                {reserve.items.map((r) => (
                  <View key={r.liabilityId} className={`res-row ${r.checked ? "res-on" : ""}`} onTap={() => void toggleReserve(r, !r.checked)}>
                    <Text className="res-check">{r.checked ? "☑" : "☐"}</Text>
                    <View className="res-mid">
                      <Text className="res-name">
                        {r.name}
                        {r.payDays.length > 0 ? <Text className="hint-faint"> {r.payDays.join("/")} 日</Text> : null}
                        {r.extra > 0 ? <Text className="res-due-tag">本月到期</Text> : null}
                      </Text>
                      <Text className="hint-faint tabular">
                        月供 {fmt(r.pay)}
                        {r.extra > 0 ? ` + 到期本金 ${fmt(r.extra)}` : ""}
                      </Text>
                    </View>
                    <Text className="res-need">{fmt(r.need)}</Text>
                  </View>
                ))}

                {/* 已备付进度条 */}
                <View className="res-prog">
                  <View className="res-prog-line">
                    <Text className="res-prog-label">
                      已备付 <Text className="money-in res-strong tabular">{fmt(reserve.checkedNeed)}</Text> / {fmt(reserve.totalNeed)}
                    </Text>
                    <Text className="res-prog-pct tabular">{pct}%</Text>
                  </View>
                  <View className="bar-track bar-thin">
                    <View className="bar-in bar-emerald-sky" style={{ width: `${pct}%` }} />
                  </View>
                </View>

                {/* 储蓄覆盖：参与账户合计 vs 当月应还 */}
                <View className="res-cover cell-bg">
                  <Text className="res-cover-line">
                    <Text className="dim">储蓄覆盖（</Text>
                    {accounts.length === 0 ? <Text className="hint-faint">尚未勾选参与账户</Text> : null}
                    <Text className="dim">）</Text>
                    <Text className={`res-strong tabular ${gap >= 0 ? "money-in" : "money-out"}`}>{fmt(reserve.savingsCents)}</Text>
                    <Text className="hint-faint"> vs 应还 {fmt(reserve.totalNeed)}</Text>
                    {reserve.coveragePct != null && (
                      <Text className={`res-strong ${reserve.coveragePct >= 100 ? "money-in" : "money-out"}`}> {reserve.coveragePct}%</Text>
                    )}
                    {gap < 0 && <Text className="money-out"> 缺口 {fmt(Math.abs(gap))}</Text>}
                  </Text>
                  <View className="res-accs">
                    {accounts.map((a) => (
                      <View
                        key={a.id}
                        className={`res-acc ${a.reserveTracked ? "res-acc-on" : ""}`}
                        onTap={() => void toggleAccountReserve(a)}
                      >
                        <Text>{a.reserveTracked ? "☑" : "☐"} {a.name}</Text>
                        <Text className="res-acc-bal tabular">{fmt(a.balanceCents)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </>
            )}
          </View>

          {/* 到期墙 */}
          {ov!.wall.length > 0 && (
            <View className="wall-card">
              <View className="wall-head">
                <Chip icon="⏳" label="到期墙" tone="amber" />
                <Text className="wall-sub">未来 6 个月内到期</Text>
              </View>
              {ov!.wall.map((w) => (
                <View key={w.id} className={`wall-row ${w.level === "danger" ? "wall-danger" : "wall-warn"}`}>
                  <Text className="wall-icon">{DEBT_TYPE_META[w.type]?.icon}</Text>
                  <Text className="wall-name">{w.name}</Text>
                  <Text className={`wall-due ${w.level === "danger" ? "money-out" : "budget-warn"}`}>
                    {w.dueDate.slice(0, 10)} 到期
                    <Text> 剩 {w.daysLeft} 天</Text>
                  </Text>
                  <Text className="wall-bal">{fmt(w.balanceCents)}</Text>
                  {Number(w.monthlyCents) === 0 && <Text className="wall-nomonth">无月供 · 到期一次结清</Text>}
                </View>
              ))}
            </View>
          )}

          {/* 档案列表（= glass rounded-2xl p-5） */}
          <View className="glass glass-p5 debt-card">
            <View className="list-head">
              <View className="list-head-l">
                <Chip icon="🏦" label="负债档案" tone="rose" />
                <Text className="list-head-sub">{active.length} 笔进行中</Text>
              </View>
              <View className="list-head-ops">
                {/* web 是客户端解析 JSON 的 DebtImportDrawer；小程序无文件读取能力，仅提示走 web（需求约定） */}
                <View className="import-btn" hoverClass="press" onTap={() => setMsg({ ok: false, text: "JSON 导入请使用 web 端" })}>
                  📥 导入
                </View>
                <View className="new-btn" hoverClass="press" onTap={() => setEditing("new")}>
                  ＋ 新建档案
                </View>
              </View>
            </View>

            {active.length === 0 && <Text className="list-empty">还没有负债档案 —— 点「＋ 新建档案」录入第一笔</Text>}
            {active.map((d) => (
              <View key={d.id} className="debt-row cell-bg">
                <View className="debt-row-main">
                  <Text className="debt-row-icon">{DEBT_TYPE_META[d.type]?.icon ?? "💳"}</Text>
                  <View className="debt-row-name-wrap">
                    <Text className="debt-row-name">
                      {d.name}
                      <Text className="hint-faint"> {DEBT_TYPE_META[d.type]?.label}</Text>
                      {d.priority > 0 && <Text className="debt-p-badge">P{d.priority}</Text>}
                    </Text>
                  </View>
                  <Text className="debt-row-bal money-out">{fmt(d.balance_cents)}</Text>
                  <View className="debt-row-ops">
                    <View className="debt-op debt-op-pay" onTap={() => d.status === "active" && setPaying(d)}>
                      💰
                    </View>
                    <View className="debt-op" onTap={() => setEditing(d)}>
                      ✏️
                    </View>
                    <View className={`debt-op ${armId === d.id ? "debt-op-armed" : ""}`} onTap={() => void armArchive(d)}>
                      {armId === d.id ? "确认归档?" : "🗑"}
                    </View>
                  </View>
                </View>
                <View className="debt-row-meta">
                  <Text className="tabular">年化 {d.rate_pct}%</Text>
                  {d.monthly_cents != null && <Text className="tabular">月供 {fmt(d.monthly_cents)}</Text>}
                  {d.pay_day != null && <Text>每月 {d.pay_day} 日</Text>}
                  {d.due_date && <Text>{String(d.due_date).slice(0, 10)} 到期</Text>}
                </View>
                {/* 进度条：已还本金占比（余额可能大于本金，宽度和文案都要防负数） */}
                {Number(d.principal_cents) > 0 && (
                  <View className="debt-row-prog">
                    <View className="bar-track bar-thin">
                      <View
                        className="bar-in bar-emerald-sky"
                        style={{
                          width: `${Math.max(0, Math.min(100, ((Number(d.principal_cents) - Number(d.balance_cents)) / Number(d.principal_cents)) * 100))}%`,
                        }}
                      />
                    </View>
                    <Text className="debt-row-prog-text tabular">
                      已还 {fmt(Math.max(0, Number(d.principal_cents) - Number(d.balance_cents)))} / 本金 {fmt(d.principal_cents)}
                      {d.paid_cents != null && Number(d.paid_cents) > 0
                        ? ` · 累计还款 ${fmt(d.paid_cents)}（${d.payments_count ?? 0} 笔）`
                        : ""}
                    </Text>
                  </View>
                )}
              </View>
            ))}

            {settled.length > 0 && (
              <View className="cleared-box">
                <View className="cleared-toggle" onTap={() => setShowCleared((v) => !v)}>
                  {showCleared ? "▾" : "▸"} 已结清 / 已归档（{settled.length}）
                </View>
                {showCleared &&
                  settled.map((d) => (
                    <View key={d.id} className="cleared-row">
                      <Text>{DEBT_TYPE_META[d.type]?.icon}</Text>
                      <Text className="cleared-name">{d.name}</Text>
                      <Text className="cleared-tag">{d.status === "cleared" ? "已结清" : "已归档"}</Text>
                      <Text className="tabular">{fmt(d.balance_cents)}</Text>
                      {d.status === "archived" && (
                        <View
                          className="cleared-restore"
                          onTap={async () => {
                            try {
                              await updateDebt(d.id, { status: "active" });
                              await load();
                            } catch (e) {
                              setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
                            }
                          }}
                        >
                          恢复
                        </View>
                      )}
                    </View>
                  ))}
              </View>
            )}
          </View>

          {/* 策略模拟（= glass rounded-2xl p-5） */}
          <View className="glass glass-p5 debt-card">
            <View className="sim-head">
              <Chip icon="🎯" label="清债策略模拟" tone="violet" />
            </View>
            <View className="sim-ctrl">
              <Text className="sim-label">每月额外还款</Text>
              <View className="sim-slider">
                <Slider
                  min={0}
                  max={500000}
                  step={10000}
                  value={extra}
                  activeColor="#0ea5e9"
                  backgroundColor="var(--elevated)"
                  blockSize={20}
                  onChange={(e) => setExtra(Number(e.detail.value))}
                />
              </View>
              <Text className="sim-amt">¥{yuan(extra)}</Text>
              <Button className={`btn-primary sim-run ${simBusy ? "disabled" : ""}`} disabled={simBusy} hoverClass="press" onClick={() => void runSim(extra)}>
                {simBusy ? "推演中…" : "开始模拟"}
              </Button>
            </View>
            {sim && (
              <View className="sim-result">
                {[sim.snowball, sim.avalanche].map((p) => (
                  <View key={p.strategy} className="sim-card cell-bg">
                    <View className="sim-card-head">
                      <Text className="sim-card-title">{p.strategy === "snowball" ? "❄️ 雪球（先清小额）" : "🏔️ 雪崩（先清高息）"}</Text>
                      <Text className="sim-card-save">省 {fmt(p.interestSavedVsBaselineCents)} 利息</Text>
                    </View>
                    <Text className="sim-card-line">
                      {p.notCleared
                        ? "按当前月供 + 额外还款额无法在 50 年内清零，请提高还款额"
                        : `预计 ${p.clearedLabel} 清零（${p.months} 个月${p.monthsSavedVsBaseline ? `，提前 ${p.monthsSavedVsBaseline} 个月` : ""}）`}
                    </Text>
                    <Text className="sim-card-line">总利息 {fmt(p.totalInterestCents)}</Text>
                    <Text className="sim-card-order">清偿顺序：{p.order.join(" → ")}</Text>
                  </View>
                ))}
                <Text className="sim-baseline">
                  基线（仅最低月供）总利息 {fmt(sim.baseline.totalInterestCents)} · 模拟估算，仅供参考
                </Text>
              </View>
            )}
          </View>

          <Text className="fin-footer">拾光 · 负债管理 · 还款后余额自动递减</Text>
        </>
      )}

      {/* 新建/编辑档案弹层 */}
      {editing && <View className="overlay" style={{ zIndex: 65 }} onTap={() => setEditing(null)} />}
      {editing && (
        <View className="sheet fin-sheet">
          <View className="sheet-head">
            <Text className="sheet-title">{editing === "new" ? "新建负债档案" : "编辑负债档案"}</Text>
            <View className="sheet-close" onTap={() => setEditing(null)}>
              ✕
            </View>
          </View>
          <DebtForm
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              if (editing === "new") await createDebt(payload);
              else await updateDebt(editing.id, payload);
              setEditing(null);
              setMsg({ ok: true, text: editing === "new" ? "✅ 已建档" : "💾 已保存" });
              await load();
            }}
          />
        </View>
      )}

      {/* 还款弹层 */}
      {paying && <View className="overlay" style={{ zIndex: 65 }} onTap={() => setPaying(null)} />}
      {paying && (
        <View className="sheet fin-sheet">
          <View className="sheet-head">
            <Text className="sheet-title">还款 · {paying.name}</Text>
            <View className="sheet-close" onTap={() => setPaying(null)}>
              ✕
            </View>
          </View>
          <PaymentForm
            debt={paying}
            accounts={accounts}
            onCancel={() => setPaying(null)}
            onDone={async (text) => {
              setPaying(null);
              setMsg({ ok: true, text });
              await load();
              setSim(null);
            }}
            onError={(text) => setMsg({ ok: false, text })}
          />
        </View>
      )}
    </PageShell>
  );
}
