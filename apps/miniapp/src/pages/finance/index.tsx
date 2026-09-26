import { useState } from "react";
import { View, Text, Button } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { loadOverview, loadTransactions, confirmTx, bjMonth, yuan, type Overview, type Tx } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import "./index.scss";

export default function Finance() {
  const [month, setMonth] = useState(bjMonth());
  const [ov, setOv] = useState<Overview | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  async function refresh(ym = month) {
    try {
      const [o, t] = await Promise.all([loadOverview(ym), loadTransactions(ym)]);
      setOv(o);
      setTxs(t.transactions ?? []);
    } catch (e: any) {
      setMsg(e?.message ?? "加载失败");
    }
  }

  if (!inited && getSessionToken()) {
    setInited(true);
    void refresh();
  }

  usePullDownRefresh(() => {
    refresh().finally(() => Taro.stopPullDownRefresh());
  });

  async function confirm(t: Tx) {
    try {
      await confirmTx(t.id);
      setMsg(`✅ 已确认：${t.direction === "out" ? "支出" : "收入"} ¥${yuan(t.amount_cents)}`);
      await refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "确认失败");
    }
  }

  const drafts = txs.filter((t) => t.is_draft);
  const confirmed = txs.filter((t) => !t.is_draft);

  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    setMonth(ym);
    void refresh(ym);
  }

  function go(url: string) {
    Taro.navigateTo({ url });
  }

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-ok">{msg}</View>}

      <View className="month-row">
        <Text className="nav-btn" onClick={() => shiftMonth(-1)}>‹</Text>
        <Text className="month-title">{month}</Text>
        <Text className="nav-btn" onClick={() => shiftMonth(1)}>›</Text>
      </View>

      {ov && (
        <View className="card">
          <View className="ov-row">
            <View className="ov-item">
              <Text className="dim">支出</Text>
              <Text className="ov-num money-out">¥{yuan(ov.outCents)}</Text>
            </View>
            <View className="ov-item">
              <Text className="dim">收入</Text>
              <Text className="ov-num money-in">¥{yuan(ov.inCents)}</Text>
            </View>
          </View>
          {ov.accounts?.length > 0 && (
            <View className="acc-line">
              <Text className="dim">账户合计</Text>
              <Text className="acc-sum">
                ¥{yuan(ov.accounts.reduce((s, a) => s + Number(a.balanceCents), 0))}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 分包入口 */}
      <View className="entries">
        <Text className="entry" onClick={() => go("/packages/debt/index")}>💳 负债</Text>
        <Text className="entry" onClick={() => go("/packages/review/index")}>📊 收支复盘</Text>
        <Text className="entry" onClick={() => go("/packages/trading/index")}>📈 交易</Text>
      </View>

      {drafts.length > 0 && (
        <View className="card">
          <Text className="h2">待确认 {drafts.length} 笔</Text>
          {drafts.map((t) => (
            <View key={t.id} className="tx-row">
              <Text className={`tx-amt ${t.direction === "out" ? "money-out" : "money-in"}`}>
                {t.direction === "out" ? "-" : "+"}¥{yuan(t.amount_cents)}
              </Text>
              <Text className="tx-cat">{t.category}</Text>
              <Button className="mini-btn" onClick={() => confirm(t)}>✓</Button>
            </View>
          ))}
        </View>
      )}

      <View className="card">
        <Text className="h2">流水 {confirmed.length} 笔</Text>
        {confirmed.length === 0 && <Text className="dim">本月暂无流水</Text>}
        {confirmed.slice(0, 30).map((t) => (
          <View key={t.id} className="tx-row">
            <Text className={`tx-amt ${t.direction === "out" ? "money-out" : "money-in"}`}>
              {t.direction === "out" ? "-" : "+"}¥{yuan(t.amount_cents)}
            </Text>
            <Text className="tx-cat grow">{t.category}{t.counterparty ? ` · ${t.counterparty}` : ""}</Text>
            <Text className="dim">{t.occurred_at.slice(5, 10).replace("-", "/")}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
