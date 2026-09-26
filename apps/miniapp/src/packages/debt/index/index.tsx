import { useState } from "react";
import { View, Text, Input, Button, Picker } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import {
  yuan,
  bjToday,
  bjMonth,
  loadDebts,
  loadDebtOverview,
  loadReserve,
  setReserveCheck,
  type DebtRow,
} from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { payDebt } from "./api";
import "./index.scss";

/**
 * 负债分包页：汇总卡（/api/debts/overview）→ 每月备付（/api/debts/reserve）→ 负债清单（/api/debts）。
 * 金额一律分；列表行点击弹半屏表单登记还款（POST /api/debts/:id/payments）。
 */

/** 负债类型元数据：与 packages/shared/finance DEBT_TYPE_META 同源。
 * 小程序端不引 shared 包（避免构建链路差异），就地映射；新增类型时两处都要补。 */
const TYPE_META: Record<string, { icon: string; label: string }> = {
  credit_card: { icon: "💳", label: "信用卡" },
  mortgage: { icon: "🏠", label: "房贷" },
  car_loan: { icon: "🚗", label: "车贷" },
  consumer_loan: { icon: "💰", label: "消费贷" },
  bnpl: { icon: "🛒", label: "花呗白条" },
  family: { icon: "🤝", label: "亲友借款" },
};

/** GET /api/debts/reserve 返回（grep apps/api/src/server/finance/debt/reserve.ts 确认）。
 * lib/api.ts 的 loadReserve 类型缺 liabilityId/liabilityIds/payDays，这里以服务端实际结构为准强转。 */
interface ReserveItem {
  liabilityId: string;
  name: string;
  payDays: number[];
  pay: number; // 月供（分）
  extra: number; // 当月到期本金（分）
  need: number; // pay + extra
  checked: boolean;
  liabilityIds: string[]; // 合并组（同名多笔）全部负债 id，整组取消勾选时逐个 PUT
}
interface ReserveData {
  ym: string;
  items: ReserveItem[];
  totalNeed: number;
  checkedNeed: number;
  savingsCents: number;
  coveragePct: number | null; // totalNeed=0 时为 null
}
/** GET /api/debts/overview 的汇总段（本页只消费 totals） */
interface DebtOv {
  totals: { balanceCents: number; monthlyDueCents: number; weightedRatePct: number; liabilityCount: number };
}

export default function DebtPage() {
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [ov, setOv] = useState<DebtOv | null>(null);
  const [reserve, setReserve] = useState<ReserveData | null>(null);
  const [ym, setYm] = useState(bjMonth());
  // 成功/失败分色徽标（对齐 feed 页 msg:{ok,text} 范式）
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [inited, setInited] = useState(false);
  const [showCleared, setShowCleared] = useState(false);
  const [resBusy, setResBusy] = useState(false);

  // 还款半屏表单：金额以「元」字符串承接输入（小程序 Input 值恒为 string），提交时元→分
  const [paying, setPaying] = useState<DebtRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(bjToday());
  const [payBusy, setPayBusy] = useState(false);

  async function refresh(y = ym) {
    try {
      const [d, o, r] = await Promise.all([
        loadDebts(),
        loadDebtOverview(),
        // 备付挂了不拖垮主清单/汇总（如历史月份勾选表异常）
        loadReserve(y).catch(() => null),
      ]);
      // 注意：/api/debts 实际返回 {debts}（README 写的 {liabilities} 与服务端不符），两端兜底
      setDebts(d.debts ?? d.liabilities ?? []);
      setOv(o as DebtOv);
      if (r) setReserve(r as unknown as ReserveData);
      setMsg(null);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "加载失败" });
    }
  }

  // 首次进入加载（README 首次加载模式；渲染期 setState 是约定写法）
  if (!inited && getSessionToken()) {
    setInited(true);
    void refresh();
  }

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh());
  });

  /** 备付月份切换：用 UTC 构造防本地时区偏移（对齐 web reserve-section） */
  function shiftYm(delta: number) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    setYm(next);
    void refresh(next);
  }

  /** 勾选/取消备付。坑：合并行「组内任一勾选即整组已勾」（服务端按 name 合并、checked 取组内 some），
   * 取消只 PUT 单个 id 会对组内其余行静默无效，必须整组逐个取消；勾选发单 id 即可。 */
  async function toggleReserve(row: ReserveItem, checked: boolean) {
    if (resBusy) return;
    setResBusy(true);
    try {
      const ids = checked ? [row.liabilityId] : row.liabilityIds?.length ? row.liabilityIds : [row.liabilityId];
      for (const id of ids) {
        await setReserveCheck(ym, id, checked);
      }
      const r = await loadReserve(ym);
      setReserve(r as unknown as ReserveData);
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "备付操作失败" });
    } finally {
      setResBusy(false);
    }
  }

  function openPay(d: DebtRow) {
    // 已结清/已归档服务端会拒（「仅进行中的负债可记还款」），入口直接不给
    if (d.status !== "active") return;
    setPaying(d);
    setPayAmount("");
    setPayDate(bjToday()); // 默认北京今天，与服务端 paidAt 缺省口径一致
  }

  async function submitPay() {
    if (!paying || payBusy) return;
    // 元→分：Math.round 消浮点误差（12.3*100=1229.99…）；服务端要求正整数分
    const cents = Math.round(parseFloat(payAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setMsg({ ok: false, text: "请输入正确的还款金额" });
      return;
    }
    setPayBusy(true);
    try {
      await payDebt(paying.id, { amountCents: cents, paidAt: payDate });
      setPaying(null);
      setMsg({ ok: true, text: `✅ 已登记还款 ¥${yuan(cents)}` });
      // 还款联动余额递减/自动结清/备付自动勾选：三块数据都要重拉
      await refresh();
    } catch (e: any) {
      // 409「当天已有一笔相同金额的还款」等中文文案直接展示
      setMsg({ ok: false, text: e?.message ?? "还款登记失败" });
    } finally {
      setPayBusy(false);
    }
  }

  const active = debts.filter((d) => d.status === "active");
  const settled = debts.filter((d) => d.status !== "active");
  const t = ov?.totals;
  // 备付进度/覆盖百分比：分母为 0 时服务端 coveragePct 为 null，本地算勾选进度同样防除零
  const donePct = reserve && reserve.totalNeed > 0 ? Math.round((reserve.checkedNeed / reserve.totalNeed) * 100) : 0;
  const coverPct = reserve?.coveragePct ?? null;

  return (
    <View className="page-pad">
      {msg && <View className={`banner ${msg.ok ? "banner-ok" : "banner-err"}`}>{msg.text}</View>}

      {/* 汇总卡：总负债 / 月供合计来自 /api/debts/overview.totals */}
      {t && (
        <View className="card ov-card">
          <View className="ov-grid">
            <View className="ov-cell">
              <Text className="dim">总负债（含亲友）</Text>
              <Text className="ov-num money-out">¥{yuan(t.balanceCents)}</Text>
            </View>
            <View className="ov-cell">
              <Text className="dim">月供合计</Text>
              <Text className="ov-num">¥{yuan(t.monthlyDueCents)}</Text>
              <Text className="dim">{t.liabilityCount} 笔进行中</Text>
            </View>
          </View>
          <View className="ov-foot">
            <Text className="dim">加权利率（按余额加权）</Text>
            <Text className="rate">{t.weightedRatePct}%</Text>
          </View>
        </View>
      )}

      {/* 每月备付：合并清单 + 勾选 + 储蓄覆盖条 */}
      <View className="card">
        <View className="sec-head">
          <Text className="h2">🧰 每月备付</Text>
          <View className="month-nav">
            <Text className="nav-btn" onClick={() => shiftYm(-1)}>‹</Text>
            <Text className="month">{ym}</Text>
            <Text className="nav-btn" onClick={() => shiftYm(1)}>›</Text>
          </View>
        </View>

        {!reserve ? (
          <Text className="dim">加载中…</Text>
        ) : reserve.items.length === 0 ? (
          <Text className="dim">本月没有进行中的负债应还</Text>
        ) : (
          <>
            {reserve.items.map((r) => (
              <View key={r.liabilityId} className={`res-row ${r.checked ? "res-on" : ""}`} onClick={() => toggleReserve(r, !r.checked)}>
                <Text className="res-check">{r.checked ? "☑" : "☐"}</Text>
                <View className="grow">
                  <Text className="res-name">
                    {r.name}
                    {r.payDays.length > 0 && <Text className="dim"> {r.payDays.join("/")} 日</Text>}
                    {r.extra > 0 && <Text className="due-tag">本月到期</Text>}
                  </Text>
                  <Text className="dim">
                    月供 ¥{yuan(r.pay)}{r.extra > 0 ? ` + 到期本金 ¥${yuan(r.extra)}` : ""}
                  </Text>
                </View>
                <Text className="res-need">¥{yuan(r.need)}</Text>
              </View>
            ))}

            {/* 已备付进度条 */}
            <View className="prog-line">
              <Text className="dim">
                已备付 <Text className="prog-num money-in">¥{yuan(reserve.checkedNeed)}</Text> / ¥{yuan(reserve.totalNeed)}
              </Text>
              <Text className="prog-pct">{donePct}%</Text>
            </View>
            <View className="bar">
              <View className="bar-in" style={{ width: `${donePct}%` }} />
            </View>

            {/* 储蓄覆盖：参与账户合计 vs 当月应还（口径=账户期初，不随流水变动） */}
            <View className="cover-box">
              <View className="prog-line">
                <Text className="dim">储蓄覆盖</Text>
                {coverPct != null && (
                  <Text className={`prog-pct ${coverPct >= 100 ? "money-in" : "money-out"}`}>{coverPct}%</Text>
                )}
              </View>
              <View className="prog-line">
                <Text className="cover-num money-in">¥{yuan(reserve.savingsCents)}</Text>
                <Text className="dim">vs 应还 ¥{yuan(reserve.totalNeed)}</Text>
              </View>
              <View className="bar">
                <View
                  className={`bar-in ${coverPct != null && coverPct >= 100 ? "bar-ok" : "bar-warn"}`}
                  style={{ width: `${Math.max(0, Math.min(100, coverPct ?? 0))}%` }}
                />
              </View>
              {reserve.savingsCents < reserve.totalNeed && (
                <Text className="dim gap-tip">缺口 ¥{yuan(reserve.totalNeed - reserve.savingsCents)}</Text>
              )}
            </View>
          </>
        )}
      </View>

      {/* 负债清单：进行中（点行登记还款）/ 已结清（折叠） */}
      <View className="card">
        <Text className="h2">💳 负债档案 {active.length} 笔进行中</Text>
        {active.length === 0 && <Text className="dim">还没有进行中的负债 —— 网页端可新建档案</Text>}
        {active.map((d) => (
          <View key={d.id} className="d-row" onClick={() => openPay(d)}>
            <Text className="d-icon">{TYPE_META[d.type]?.icon ?? "💳"}</Text>
            <View className="grow">
              <Text className="d-name">
                {d.name}
                <Text className="dim"> {TYPE_META[d.type]?.label ?? d.type}</Text>
              </Text>
              <Text className="dim">
                {d.monthly_cents != null ? `月供 ¥${yuan(d.monthly_cents)}` : "无月供"}
                {d.pay_day != null ? ` · 每月 ${d.pay_day} 日` : ""}
                {d.due_date ? ` · ${String(d.due_date).slice(0, 10)} 到期` : ""}
              </Text>
            </View>
            <View className="d-right">
              <Text className="d-bal money-out">¥{yuan(d.balance_cents)}</Text>
              <Text className="d-pay-hint dim">记还款 ›</Text>
            </View>
          </View>
        ))}

        {settled.length > 0 && (
          <View className="cleared-box">
            <Text className="dim" onClick={() => setShowCleared((v) => !v)}>
              {showCleared ? "▾" : "▸"} 已结清 / 已归档（{settled.length}）
            </Text>
            {showCleared &&
              settled.map((d) => (
                <View key={d.id} className="d-row cleared">
                  <Text className="d-icon">{TYPE_META[d.type]?.icon ?? "💳"}</Text>
                  <View className="grow">
                    <Text className="d-name dim">{d.name}</Text>
                  </View>
                  <Text className="cleared-tag">{d.status === "cleared" ? "已结清" : "已归档"}</Text>
                  <Text className="dim">¥{yuan(d.balance_cents)}</Text>
                </View>
              ))}
          </View>
        )}
      </View>

      {/* 还款半屏表单：金额（元）+ 日期；masked 层点击关闭 */}
      {paying && (
        <View className="sheet-mask" onClick={() => !payBusy && setPaying(null)}>
          <View className="sheet" onClick={(e) => e.stopPropagation()}>
            <Text className="sheet-title">💰 还款 · {paying.name}</Text>
            <Text className="dim">剩余 ¥{yuan(paying.balance_cents)}</Text>
            <Input
              className="input sheet-input"
              type="digit"
              placeholder="还款金额（元）"
              placeholderClass="dim"
              value={payAmount}
              onInput={(e) => setPayAmount(e.detail.value)}
            />
            <Picker mode="date" value={payDate} onChange={(e) => setPayDate(e.detail.value)}>
              <View className="input sheet-input date-pick">
                <Text>还款日期：{payDate}</Text>
                <Text className="dim">改 ›</Text>
              </View>
            </Picker>
            <View className="sheet-btns">
              <Button className="btn-ghost sheet-btn" disabled={payBusy} onClick={() => setPaying(null)}>
                取消
              </Button>
              <Button className={`btn-primary sheet-btn ${payBusy ? "disabled" : ""}`} disabled={payBusy} onClick={submitPay}>
                {payBusy ? "登记中…" : "登记还款"}
              </Button>
            </View>
            <Text className="dim sheet-tip">同日同金额重复提交会被拦截（防双击）</Text>
          </View>
        </View>
      )}
    </View>
  );
}
