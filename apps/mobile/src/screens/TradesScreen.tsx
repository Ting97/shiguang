/**
 * 交易屏（REQ-005 FR-1.8 只读屏，9-D 拆分自 App.tsx）：账号汇总 + 每日盈亏 + 权益累计曲线；无任何写/导入口。
 * 9-D 新增：触底外扩统计窗口 30 → 60 → 90 日（loadTradingDaily 按窗口整段重取）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme";
import { ApiError, loadTradingAccounts, loadTradingDaily } from "../api";
import { TRADES_RANGE_INIT, TRADES_RANGE_MAX, TRADES_RANGE_STEP } from "../consts";
import { haptic } from "../haptic";
import { s } from "../styles";
import TopNav, { type ScreenKey } from "../components/TopNav";
import AuroraBackground from "../components/AuroraBackground";
import SkeletonCard from "../components/SkeletonCard";

export default function TradesScreen({ onLogout, onScreen }: { onLogout: () => void; onScreen: (s: ScreenKey) => void }) {
  const scheme = useColorScheme();
  const t = useTheme();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [days, setDays] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 触底外扩统计窗口（REQ-009 9-D）：30 → 60 → 90 日封顶（loadTradingDaily 按窗口整段重取）
  const [rangeDays, setRangeDays] = useState(TRADES_RANGE_INIT);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  /** 401 与现有 apiGet 错误路径一致地退出登录；其余展示错误文案 */
  const onFail = useCallback((e: unknown) => {
    if ((e instanceof ApiError && e.status === 401) || (e instanceof Error && e.message.includes("401"))) {
      onLogout();
      return;
    }
    setErr(e instanceof Error ? e.message : "加载失败");
  }, [onLogout]);

  const loadAccounts = useCallback(async () => {
    try {
      const j: any = await loadTradingAccounts();
      const list: any[] = j?.accounts ?? [];
      setAccounts(list);
      setAccountId((prev) => (prev && list.some((a) => a.id === prev) ? prev : list[0]?.id ?? null));
      setErr(null);
    } catch (e) {
      onFail(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onFail]);

  const loadDaily = useCallback(async () => {
    if (!accountId) {
      setDays([]);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }
    try {
      const j: any = await loadTradingDaily(accountId, rangeDays);
      setDays(j?.days ?? []);
      setErr(null);
    } catch (e) {
      onFail(e);
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [accountId, rangeDays, onFail]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    loadDaily();
  }, [loadDaily]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptic.tap();
    await Promise.all([loadAccounts(), loadDaily()]);
  }, [loadAccounts, loadDaily]);

  /** 触底外扩窗口（真实 loadMore：rangeDays 变化触发 loadDaily 整段重取，完成后由其收尾 loadingMore） */
  const loadMore = useCallback(() => {
    if (loading || refreshing || loadingMore || rangeDays >= TRADES_RANGE_MAX) return;
    haptic.tap();
    setLoadingMore(true);
    setRangeDays((d) => Math.min(d + TRADES_RANGE_STEP, TRADES_RANGE_MAX));
  }, [loading, refreshing, loadingMore, rangeDays]);

  /** USD 金额：负数带 - 号，`$` 前缀 */
  const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Number(v) || 0).toFixed(2)}`;

  // 权益累计：按服务端升序 ymd 累加 net，柱高在 [min,max] 间归一（View 柱状近似曲线）
  const curve = useMemo(() => {
    let acc = 0;
    const pts = days.map((d) => (acc += Number(d.net) || 0));
    const max = Math.max(...pts, 0);
    const min = Math.min(...pts, 0);
    const range = max - min || 1;
    return pts.map((v) => ({ v, h: 6 + ((v - min) / range) * 46 }));
  }, [days]);
  const curveTotal = curve.length > 0 ? curve[curve.length - 1].v : 0;
  const firstYmd = days[0]?.ymd;
  const lastYmd = days[days.length - 1]?.ymd;

  // 每日列表：最新在前
  const listDays = useMemo(() => [...days].sort((a, b) => (a.ymd < b.ymd ? 1 : -1)), [days]);

  const net = Number(account?.netProfit ?? 0);
  const name = account?.nickname || account?.login || "";

  const header = (
    <>
      {accounts.length > 1 && (
        <View style={s.acctWrap}>
          {accounts.map((a) => {
            const on = a.id === accountId;
            return (
              <Pressable key={a.id} onPress={() => { haptic.tap(); setAccountId(a.id); }} hitSlop={4}>
                <View style={[s.acctChip, { borderColor: on ? t.accent : t.lineSoft, backgroundColor: on ? t.bg : "transparent" }]}>
                  <Text style={[s.acctChipText, { color: on ? t.accent : t.inkMute }]} numberOfLines={1}>
                    {a.nickname || a.login}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 账号汇总卡 */}
      {account && (
        <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
          <LinearGradient
            colors={["rgba(255,255,255,0.14)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
            style={s.cardHighlight}
            pointerEvents="none"
          />
          <View style={s.sumHead}>
            <Text style={[s.sumLabel, { color: t.inkMute }]}>总净盈亏</Text>
            {name ? <Text style={[s.sumName, { color: t.inkDim }]} numberOfLines={1}>{name}</Text> : null}
          </View>
          <Text style={[s.sumNet, { color: net >= 0 ? t.success : t.danger }]}>{usd(net)}</Text>
          <View style={s.sumRow}>
            <View style={s.sumItem}>
              <Text style={[s.sumItemNum, { color: t.ink }]}>{account.winRate == null ? "—" : `${account.winRate}%`}</Text>
              <Text style={[s.sumItemLabel, { color: t.inkDim }]}>胜率</Text>
            </View>
            <View style={s.sumItem}>
              <Text style={[s.sumItemNum, { color: t.ink }]}>{Number(account.trades) || 0}</Text>
              <Text style={[s.sumItemLabel, { color: t.inkDim }]}>笔数</Text>
            </View>
            <View style={s.sumItem}>
              <Text style={[s.sumItemNum, { color: t.ink }]}>{(Number(account.lots) || 0).toFixed(2)}</Text>
              <Text style={[s.sumItemLabel, { color: t.inkDim }]}>手数</Text>
            </View>
          </View>
        </View>
      )}

      {/* 权益累计曲线（近 N 日）：View 柱状近似，绿涨红跌 */}
      <View style={[s.card, { backgroundColor: t.surfaceSoft, borderColor: t.glassBorder }]}>
        <View style={s.chartHead}>
          <Text style={[s.sectionTitle, { color: t.inkSoft }]}>📈 权益累计（近 {rangeDays} 日）</Text>
          {days.length > 0 && (
            <Text style={[s.chartTotal, { color: curveTotal >= 0 ? t.success : t.danger }]}>{usd(curveTotal)}</Text>
          )}
        </View>
        {days.length === 0 ? (
          <Text style={[s.chartEmpty, { color: t.inkMute }]}>近 {rangeDays} 日暂无交易</Text>
        ) : (
          <>
            <View style={[s.chartBars, { borderBottomColor: t.lineSoft }]}>
              {curve.map((p, i) => (
                <View key={i} style={[s.chartBar, { height: p.h, backgroundColor: p.v >= 0 ? t.success : t.danger, opacity: 0.85 }]} />
              ))}
            </View>
            <View style={s.chartLabels}>
              <Text style={[s.chartLabel, { color: t.inkDim }]}>{firstYmd?.slice(5)}</Text>
              <Text style={[s.chartLabel, { color: t.inkDim }]}>{lastYmd?.slice(5)}</Text>
            </View>
          </>
        )}
      </View>

      <Text style={[s.sectionTitle2, { color: t.inkDim }]}>近 {rangeDays} 日每日盈亏</Text>
    </>
  );

  return (
    <View style={[s.root, { backgroundColor: t.bg }]}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <AuroraBackground t={t} />

      {/* 顶栏：与动态屏同款毛玻璃 pill，「📝 动态 | 📈 交易」切换 */}
      <TopNav t={t} scheme={scheme} active="trades" onTab={onScreen} onLogout={onLogout} />

      <View style={s.head}>
        <Text style={[s.headTitle, { color: t.title }]}>
          拾光 <Text style={[s.headSub, { color: t.inkDim }]}>交易</Text>
        </Text>
        <Text style={[s.headDesc, { color: t.inkMute }]}>只读概览：账号汇总 · 每日盈亏 · 权益累计（数据来自网页端导入）</Text>
      </View>

      {err && (
        <View style={[s.banner, { backgroundColor: t.bannerErrBg, borderColor: t.bannerErrBorder }]}>
          <Text style={{ color: t.danger, fontSize: 12, lineHeight: 18 }}>{err}</Text>
        </View>
      )}

      {loading ? (
        <View style={s.list}>
          {[0, 140, 280].map((d) => (
            <SkeletonCard key={d} t={t} delay={d} />
          ))}
        </View>
      ) : accounts.length === 0 ? (
        <Text style={[s.empty, { color: t.inkMute }]}>还没有交易账号，请先在网页端导入（此处只读）</Text>
      ) : (
        <FlatList
          data={listDays}
          keyExtractor={(d, i) => String(d.ymd ?? i)}
          contentContainerStyle={s.list}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={[s.empty, { color: t.inkMute }]}>近 {rangeDays} 日暂无交易记录</Text>}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={s.footer}>
                <ActivityIndicator color={t.accentBright} size="small" />
                <Text style={[s.footerText, { color: t.inkDim }]}>加载中…</Text>
              </View>
            ) : rangeDays >= TRADES_RANGE_MAX ? (
              <Text style={[s.footerText, { color: t.inkDim }]}>— 最多展示近 {TRADES_RANGE_MAX} 日 —</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[s.dayRow, { borderBottomColor: t.lineSoft }]}>
              <Text style={[s.dayDate, { color: t.inkSoft }]}>{String(item.ymd ?? "").slice(5)}</Text>
              <Text style={[s.dayCount, { color: t.inkDim }]}>{Number(item.count) || 0} 笔</Text>
              <Text style={[s.dayNet, { color: Number(item.net) >= 0 ? t.success : t.danger }]}>{usd(Number(item.net))}</Text>
            </View>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.accentBright}
              colors={[t.accentBright]}
              progressBackgroundColor={t.surface}
            />
          }
        />
      )}
    </View>
  );
}
