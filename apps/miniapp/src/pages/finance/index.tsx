/**
 * 财务概览页 —— 与 web /finance 移动端逐块对齐（基准 apps/web/src/app/finance/page.tsx + components/finance/*）。
 * 结构：hero → pill 二级导航(📊概览/🏦负债/📈收支复盘/🎯交易) → 月份导航+导入/记一笔 →
 * 草稿提醒条 → 概览大卡(三项统计/储蓄率趋势/预算/分类占比) → 账户卡 → 待确认区 → 流水列表 → footer。
 * 与 web 的差异（小程序约束）：
 * - 行内编辑/弹窗统一改为底部 sheet（web 桌面居中 Modal 的移动端形态即底部弹层）；
 * - 流水行操作钮（✏️/🗑）常显：web 靠 hover 显示，触屏无 hover，藏起来功能就不可达了。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Input, Button, Picker } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import PageShell from "@/components/page-shell";
import PageFooter from "@/components/page-footer";
import LucideIcon, { type LucideIconName } from "@/components/lucide-icon";
import { showToast } from "@/components/toast";
import { confirmTx, bjMonth, fetchMe, yuan } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import GuestGate from "@/components/guest-gate";
import {
  loadFinOverview,
  loadTxs,
  createTx,
  patchTx,
  removeTx,
  saveBudget,
  createAccount,
  patchAccount,
  deleteAccount,
  TX_CATEGORIES,
  TX_COLORS,
  categoryBreakdown,
  savingsRate,
  budgetTone,
  momChange,
  fmtMoney,
  monthTitle,
  shiftMonth,
  isoToBjInput,
  bjInputToIso,
  type FinOverview,
  type FinTx,
  type FinAccount,
} from "./api";
import "./index.scss";

/* ---------- 二级 pill 导航（= web finance-tabs.tsx + sub-nav.tsx） ---------- */

const TABS = [
  { key: "finance", label: "概览", icon: "bar_chart_3", path: "/pages/finance/index", module: null },
  { key: "debt", label: "负债", icon: "landmark", path: "/packages/debt/index/index", module: "debt" },
  { key: "review", label: "收支复盘", icon: "trending_up", path: "/packages/review/index/index", module: "trade_review" },
  { key: "trading", label: "交易", icon: "target", path: "/packages/trading/index/index", module: "trading" },
] as const;

/** 负债/复盘/交易按 me.modules 条件渲染；主区块间 redirectTo（等价 tab，栈恒 1） */
export function FinTabs({ modules }: { modules: string[] | null }) {
  const has = (m: string) => modules?.includes(m) ?? false;
  return (
    <View className="fin-tabs">
      <View className="pill-nav">
        {TABS.filter((t) => !t.module || has(t.module)).map((t) => {
          const current = t.key === "finance";
          return (
            <View
              key={t.key}
              className={`pill${current ? " pill-active" : ""}`}
              hoverClass={current ? "" : "press"}
              hoverStayTime={80}
              onTap={() => !current && Taro.redirectTo({ url: t.path })}
            >
              <LucideIcon name={t.icon} size={13} color={current ? "#fff" : "var(--ink-mute)"} />
              <Text>{t.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ---------- TagChip（= web tag-chip.tsx TagChip：语义色 tinted 底 + 同色系文字） ---------- */

type Tone = "sky" | "emerald" | "amber" | "rose" | "violet" | "slate";
export function Chip({ icon, label, tone }: { icon: LucideIconName; label: string; tone: Tone }) {
  return (
    <View className={`chip chip-${tone}`}>
      {icon ? <LucideIcon name={icon} size={12} color="currentColor" /> : null}
      <Text>{label}</Text>
    </View>
  );
}

/* ---------- 骨架屏（= web skeleton.tsx：shimmer 条渐隐） ---------- */

export function FinSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <View className="fin-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="skeleton fin-skeleton-row" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </View>
  );
}

/* ---------- TxRow（= web display.tsx TxRow）：徽标+日期+分类/对方/备注+金额+操作 ---------- */

function TxRow({
  tx: t,
  onConfirm,
  onEdit,
  onDelete,
  delArmed = false,
}: {
  tx: FinTx;
  onConfirm?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** 删除两步确认态（3 秒内再点执行，全站规范） */
  delArmed?: boolean;
}) {
  // 北京时间口径：UTC getter + 8h（本地 getter 在非中国时区设备会错 8 小时）
  const d = new Date(new Date(t.occurred_at).getTime() + 8 * 3600_000);
  const sameYear = d.getUTCFullYear() === new Date(Date.now() + 8 * 3600_000).getUTCFullYear();
  const compactDay = `${sameYear ? "" : `${String(d.getUTCFullYear()).slice(2)}/`}${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return (
    <>
      <Text className={`tx-badge ${t.direction === "out" ? "tx-badge-out" : "tx-badge-in"}`}>{t.direction === "out" ? "支" : "收"}</Text>
      <Text className="tx-day">{compactDay}</Text>
      <View className="tx-main">
        <Text className="tx-cat">{t.category}</Text>
        {t.counterparty ? <Text className="tx-extra"> · {t.counterparty}</Text> : null}
        {t.note && t.note !== t.category ? <Text className="tx-extra"> · {t.note}</Text> : null}
      </View>
      <Text className={`tx-amt ${t.direction === "out" ? "money-out" : "money-in"}`}>
        {t.direction === "out" ? "-" : "+"}¥{yuan(t.amount_cents)}
      </Text>
      {/* web 的账户标签仅 sm+ 显示，移动端本来隐藏，小程序不再渲染（保持一致） */}
      <View className="tx-ops">
        {onConfirm && (
          <View className="tx-op tx-op-confirm" onTap={onConfirm}>
            <LucideIcon name="check" size={12} color="currentColor" />
          </View>
        )}
        <View className="tx-op" onTap={onEdit}>
          <LucideIcon name="pencil" size={12} color="var(--accent)" />
        </View>
        <View className={`tx-op ${delArmed ? "tx-op-armed" : ""}`} onTap={onDelete}>
          {delArmed ? "确认删除?" : <LucideIcon name="trash_2" size={12} color="var(--danger)" />}
        </View>
      </View>
    </>
  );
}

/* ---------- 记账/编辑表单（= web forms.tsx TxForm；元输入提交转分） ---------- */

function TxForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: FinTx | null;
  onCancel: () => void;
  onSubmit: (payload: {
    direction: "out" | "in";
    amountCents: number;
    category: string;
    occurredAt: string;
    note: string | null;
    counterparty: string | null;
  }) => Promise<void>;
}) {
  const [direction, setDirection] = useState<"out" | "in">(initial?.direction ?? "out");
  const [amount, setAmount] = useState(initial ? String(initial.amount_cents / 100) : "");
  const [category, setCategory] = useState(initial?.category ?? "餐饮");
  // web 用一个 datetime-local；小程序拆成 date+time 两个 Picker，值仍为北京墙上时间串
  const [date, setDate] = useState(isoToBjInput(new Date().toISOString()).slice(0, 10));
  const [time, setTime] = useState(isoToBjInput(new Date().toISOString()).slice(11, 16));
  const [note, setNote] = useState(initial?.note ?? "");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      const bj = isoToBjInput(initial.occurred_at);
      setDate(bj.slice(0, 10));
      setTime(bj.slice(11, 16));
    }
  }, [initial]);

  return (
    <View className="txform">
      {/* 方向切换：选中态实底（支出 rose-600 / 收入 emerald-600）白字 */}
      <View className="txform-dir">
        {(["out", "in"] as const).map((d) => (
          <View
            key={d}
            className={`txform-dir-btn ${direction === d ? (d === "out" ? "dir-on-out" : "dir-on-in") : ""}`}
            onTap={() => setDirection(d)}
          >
            {d === "out" ? "支出" : "收入"}
          </View>
        ))}
      </View>
      <View className="txform-row">
        <Text className="txform-yen">¥</Text>
        <Input
          className="input txform-amt"
          type="digit"
          value={amount}
          onInput={(e) => setAmount(e.detail.value)}
          placeholder="金额"
          placeholderClass="input-placeholder"
        />
        <Picker
          mode="selector"
          range={TX_CATEGORIES}
          value={Math.max(0, TX_CATEGORIES.indexOf(category))}
          onChange={(e) => setCategory(TX_CATEGORIES[Number(e.detail.value)])}
        >
          <View className="txform-pick">
            <Text>{category}</Text>
            <Text className="txform-pick-arrow">▾</Text>
          </View>
        </Picker>
      </View>
      <View className="txform-row">
        {/* 时间用北京墙上时间拼 ISO（显式 +08:00 解析；裸 new Date 会按宿主时区解释，海外设备记错账） */}
        <Picker mode="date" value={date} onChange={(e) => setDate(e.detail.value)}>
          <View className="txform-pick txform-date">
            <Text>{date}</Text>
            <Text className="txform-pick-arrow">▾</Text>
          </View>
        </Picker>
        <Picker mode="time" value={time} onChange={(e) => setTime(e.detail.value)}>
          <View className="txform-pick txform-time">
            <Text>{time}</Text>
            <Text className="txform-pick-arrow">▾</Text>
          </View>
        </Picker>
      </View>
      <View className="txform-row">
        <Input
          className="input txform-cp"
          value={counterparty}
          onInput={(e) => setCounterparty(e.detail.value)}
          placeholder="对方（可空）"
          placeholderClass="input-placeholder"
        />
        <Input
          className="input txform-note"
          value={note ?? ""}
          onInput={(e) => setNote(e.detail.value)}
          placeholder="备注（可空）"
          placeholderClass="input-placeholder"
        />
      </View>
      {err ? <Text className="txform-err">{err}</Text> : null}
      <View className="txform-foot">
        <View className="txform-cancel" onTap={onCancel}>
          取消
        </View>
        <Button
          className={`btn-primary txform-save ${busy || !amount ? "disabled" : ""}`}
          disabled={busy || !amount}
          hoverClass="press"
          onClick={async () => {
            const cents = Math.round(parseFloat(amount) * 100);
            if (!Number.isFinite(cents) || cents <= 0) return;
            setBusy(true);
            setErr(null);
            try {
              await onSubmit({
                direction,
                amountCents: cents,
                category,
                // 流水只作记录不入账：不挂账户（与 web 同口径）
                occurredAt: bjInputToIso(`${date}T${time}`) ?? new Date().toISOString(),
                note: note || null,
                counterparty: counterparty.trim() || null,
              });
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : initial ? "保存" : "记入"}
        </Button>
      </View>
    </View>
  );
}

/* ---------- 预算编辑（= web display.tsx BudgetEditor，内联替换预算条区域） ---------- */

function BudgetEditor({
  ov,
  onCancel,
  onSaved,
}: {
  ov: FinOverview;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const limitCents = Number(ov.budget?.monthly_limit_cents ?? 0);
  const [limit, setLimit] = useState(limitCents > 0 ? String(limitCents / 100) : "");
  const [threshold, setThreshold] = useState(Number(ov.budget?.alert_threshold ?? 80));
  const THRESHOLDS = [50, 60, 70, 80, 90];
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <View className="budget-edit">
      <View className="budget-edit-row">
        <Text className="budget-edit-label">月度支出上限 ¥</Text>
        <Input
          className="input budget-edit-limit"
          type="digit"
          value={limit}
          onInput={(e) => setLimit(e.detail.value)}
          placeholder="0 = 不设上限"
          placeholderClass="input-placeholder"
        />
      </View>
      <View className="budget-edit-row">
        <Text className="budget-edit-label">预警阈值</Text>
        <Picker
          mode="selector"
          range={THRESHOLDS.map((t) => `${t}%`)}
          value={Math.max(0, THRESHOLDS.indexOf(threshold))}
          onChange={(e) => setThreshold(THRESHOLDS[Number(e.detail.value)])}
        >
          <View className="txform-pick">
            <Text>{threshold}%</Text>
            <Text className="txform-pick-arrow">▾</Text>
          </View>
        </Picker>
        <View className="budget-edit-ops">
          <View className="budget-edit-cancel" onTap={onCancel}>
            取消
          </View>
          <Button
            className={`btn-primary budget-edit-save ${busy ? "disabled" : ""}`}
            disabled={busy}
            hoverClass="press"
            onClick={async () => {
              setBusy(true);
              setMsg(null);
              try {
                const cents = limit ? Math.round(parseFloat(limit) * 100) : 0;
                await saveBudget(Number.isFinite(cents) ? cents : 0, threshold);
                await onSaved();
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "保存失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            保存
          </Button>
        </View>
      </View>
      {msg ? <Text className="txform-err">{msg}</Text> : null}
    </View>
  );
}

/* ---------- 账户管理（= web forms.tsx AccountManager）：改名/改余额/换图标/归档 + 新增 ---------- */

const ACC_ICONS = ["💵", "🅰", "💬", "💳", "🏦", "📈", "🎓", "🏠"];

function AccountManager({
  accounts,
  onChanged,
}: {
  accounts: FinAccount[];
  onChanged: () => Promise<void>;
}) {
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [balDrafts, setBalDrafts] = useState<Record<string, string>>({});
  const [rowErr, setRowErr] = useState<Record<string, string | null>>({});
  // 图标选择展开的账户 id（web 用点击外层关闭的浮层，小程序改为行内展开网格）
  const [iconPick, setIconPick] = useState<string | null>(null);
  // 归档两步确认（3 秒内再点执行）
  const [armId, setArmId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 新增行
  const [newIcon, setNewIcon] = useState("💳");
  const [newName, setNewName] = useState("");
  const [newOpening, setNewOpening] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const setRowE = (id: string, msg: string | null) => setRowErr((e) => ({ ...e, [id]: msg }));

  async function saveName(a: FinAccount) {
    const draft = (nameDrafts[a.id] ?? a.name).trim();
    setRowE(a.id, null);
    if (!draft || draft === a.name) return;
    try {
      await patchAccount(a.id, { name: draft });
      await onChanged();
    } catch (err) {
      setRowE(a.id, err instanceof Error ? err.message : "改名失败");
    }
  }

  async function saveBalance(a: FinAccount) {
    const raw = balDrafts[a.id];
    if (raw === undefined) return;
    const v = Math.round(parseFloat(raw) * 100);
    if (!Number.isFinite(v) || v === Number(a.openingBalanceCents)) return;
    try {
      await patchAccount(a.id, { openingBalanceCents: v });
      await onChanged();
    } catch (err) {
      setRowE(a.id, err instanceof Error ? err.message : "保存失败");
    }
  }

  async function armArchive(a: FinAccount) {
    // 两步确认：首点进入待确认态，3 秒内再点执行
    if (armId !== a.id) {
      setArmId(a.id);
      if (armTimer.current) clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmId(null), 3000);
      return;
    }
    setArmId(null);
    try {
      await deleteAccount(a.id);
      await onChanged();
    } catch (err) {
      setRowE(a.id, err instanceof Error ? err.message : "归档失败");
    }
  }

  return (
    <View className="acc-mgr">
      {accounts.map((a) => (
        <View key={a.id} className="acc-mgr-row">
          <View className="acc-mgr-line">
            <View className="acc-mgr-icon" onTap={() => setIconPick(iconPick === a.id ? null : a.id)}>
              {a.icon}
            </View>
            <Input
              className="acc-mgr-name"
              value={nameDrafts[a.id] ?? a.name}
              onInput={(e) => setNameDrafts((d) => ({ ...d, [a.id]: e.detail.value }))}
              onBlur={() => void saveName(a)}
              maxlength={20}
              placeholderClass="input-placeholder"
            />
            <Input
              className="acc-mgr-bal"
              type="digit"
              value={balDrafts[a.id] ?? String(Number(a.openingBalanceCents) / 100)}
              onInput={(e) => setBalDrafts((d) => ({ ...d, [a.id]: e.detail.value }))}
              onBlur={() => void saveBalance(a)}
              placeholderClass="input-placeholder"
            />
            <View className={`acc-mgr-del ${armId === a.id ? "acc-mgr-del-armed" : ""}`} onTap={() => void armArchive(a)}>
              {armId === a.id ? "确认归档?" : <LucideIcon name="trash_2" size={12} color="currentColor" />}
            </View>
          </View>
          {rowErr[a.id] ? <Text className="txform-err">{rowErr[a.id]}</Text> : null}
          {iconPick === a.id && (
            <View className="acc-mgr-icons">
              {ACC_ICONS.map((i) => (
                <View
                  key={i}
                  className={`acc-mgr-icon-cell ${i === a.icon ? "acc-mgr-icon-on" : ""}`}
                  onTap={async () => {
                    setIconPick(null);
                    if (i === a.icon) return;
                    try {
                      await patchAccount(a.id, { icon: i });
                      await onChanged();
                    } catch (err) {
                      setRowE(a.id, err instanceof Error ? err.message : "更换图标失败");
                    }
                  }}
                >
                  {i}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
      <View className="acc-mgr-add">
        <Picker mode="selector" range={ACC_ICONS} onChange={(e) => setNewIcon(ACC_ICONS[Number(e.detail.value)])}>
          <View className="txform-pick acc-mgr-add-icon">
            <Text>{newIcon}</Text>
            <Text className="txform-pick-arrow">▾</Text>
          </View>
        </Picker>
        <Input
          className="input acc-mgr-add-name"
          value={newName}
          onInput={(e) => setNewName(e.detail.value)}
          placeholder="新账户名（如：招行储蓄卡）"
          placeholderClass="input-placeholder"
        />
        <Input
          className="input acc-mgr-add-bal"
          type="digit"
          value={newOpening}
          onInput={(e) => setNewOpening(e.detail.value)}
          placeholder="当前余额"
          placeholderClass="input-placeholder"
        />
        <Button
          className={`btn-primary acc-mgr-add-btn ${addBusy || !newName.trim() ? "disabled" : ""}`}
          disabled={addBusy || !newName.trim()}
          hoverClass="press"
          onClick={async () => {
            setAddBusy(true);
            setAddErr(null);
            try {
              const cents = newOpening ? Math.round(parseFloat(newOpening) * 100) : 0;
              await createAccount({ name: newName.trim(), icon: newIcon, openingBalanceCents: Number.isFinite(cents) ? cents : 0 });
              setNewName("");
              setNewOpening("");
              await onChanged();
            } catch (err) {
              setAddErr(err instanceof Error ? err.message : "添加失败");
            } finally {
              setAddBusy(false);
            }
          }}
        >
          添加
        </Button>
      </View>
      {addErr ? <Text className="txform-err">{addErr}</Text> : null}
    </View>
  );
}

/* ---------- 储蓄率趋势（= web display.tsx SavingsTrend：近 6 个月小柱图） ---------- */

function SavingsTrend({ trend }: { trend: FinOverview["trend"] }) {
  const max = Math.max(100, ...trend.map((t) => Math.abs(t.rate ?? 0)));
  return (
    <View className="ov-sec">
      <View className="ov-sec-head">
        <Chip icon="trending_up" label="储蓄率 · 近 6 个月" tone="emerald" />
      </View>
      <View className="trend-row">
        {trend.map((t, i) => {
          const isCur = i === trend.length - 1;
          const h = t.rate == null ? 8 : Math.max(12, (Math.abs(t.rate) / max) * 128);
          return (
            <View key={t.month} className="trend-col">
              <Text className={`trend-rate ${t.rate == null ? "hint-faint" : t.rate >= 0 ? "money-in" : "money-out"}`}>
                {t.rate == null ? "—" : `${t.rate}%`}
              </Text>
              <View
                className={`trend-bar ${t.rate == null ? "trend-bar-zero" : t.rate >= 0 ? "trend-bar-up" : "trend-bar-down"} ${isCur ? "trend-bar-cur" : ""}`}
                style={{ height: `${h}px` }}
              />
              <Text className={`trend-month ${isCur ? "dim-soft" : "hint-faint"}`}>{Number(t.month.slice(5))}月</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ==================================================================== */

export default function Finance() {
  const [month, setMonth] = useState(bjMonth());
  const [ov, setOv] = useState<FinOverview | null>(null);
  const [txs, setTxs] = useState<FinTx[]>([]);
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [modules, setModules] = useState<string[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [managingAccount, setManagingAccount] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [editing, setEditing] = useState<FinTx | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false); // 确认提交中：防双击双发 PATCH
  // 删除流水两步确认：待确认的流水 id + 超时复位定时器
  const [armDel, setArmDel] = useState<string | null>(null);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );
  const [inited, setInited] = useState(false);

  // seq 守卫：快速切月时旧响应可能后到（头部已是新月、数据却是旧月），只让最新请求落地
  const loadSeq = useRef(0);
  const load = async (ym = month) => {
    const seq = ++loadSeq.current;
    setLoadErr(null);
    try {
      const [o, t] = await Promise.all([loadFinOverview(ym), loadTxs(ym)]);
      if (seq !== loadSeq.current) return; // 过期响应丢弃
      setOv(o);
      setTxs(t.transactions ?? []);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      // 失败不停在骨架屏（历史 bug：无 catch 时 unhandled rejection + 永久加载中）
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  };

  // 首次进入加载（token 就绪后）；me.modules 拉取失败按空数组处理（= web FinanceTabs）。
  // 副作用移入 useEffect：render 期 setState+发请求在并发/StrictMode 下会双发
  useEffect(() => {
    if (inited || !getSessionToken()) return;
    setInited(true);
    void load();
    fetchMe()
      .then((j) => setModules(j.modules ?? []))
      .catch(() => setModules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePullDownRefresh(() => {
    if (!getSessionToken()) {
      Taro.stopPullDownRefresh(); // 游客态无服务端通道，直接收起动画（防 401 错误横幅/toast）
      return;
    }
    load().finally(() => Taro.stopPullDownRefresh());
  });

  const drafts = useMemo(() => txs.filter((t) => t.is_draft), [txs]);
  const confirmed = useMemo(() => txs.filter((t) => !t.is_draft), [txs]);

  // 游客无服务端只读通道（/api 全 401）：旧版停在永久骨架屏，这里给出登录引导出口
  //（放在全部 hooks 之后，早退不跳过任何 hook 调用）
  if (!getSessionToken()) {
    return (
      <PageShell active="finance">
        <GuestGate title="财务" desc="记账、预算、CSV 导入与储蓄率报表" />
      </PageShell>
    );
  }

  async function confirmOne(t: FinTx) {
    if (confirmBusy) return;
    setConfirmBusy(true); // 提交期间锁按钮：防双击双发 PATCH 重复确认
    try {
      await confirmTx(t.id);
      showToast({ type: "ok", text: `✅ 已确认：${t.direction === "out" ? "支出" : "收入"} ¥${yuan(t.amount_cents)}` });
      await load();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setConfirmBusy(false);
    }
  }

  /** 一键全部确认（流水不入账：确认即计入报表，无需选账户） */
  async function confirmAll() {
    if (drafts.length === 0 || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await Promise.all(drafts.map((t) => confirmTx(t.id)));
      showToast({ type: "ok", text: `✅ 已全部确认（${drafts.length} 笔）` });
      await load();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
      await load();
    } finally {
      setConfirmBusy(false);
    }
  }

  async function remove(t: FinTx) {
    // 两步确认（全站规范）：首点进入待确认态（按钮变「确认删除?」），3 秒内再点执行
    if (armDel !== t.id) {
      setArmDel(t.id);
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      armTimerRef.current = setTimeout(() => setArmDel(null), 3000);
      return;
    }
    setArmDel(null);
    try {
      await removeTx(t.id);
      showToast({ type: "ok", text: "🗑 已删除流水" });
      await load();
    } catch (e) {
      showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 草稿提醒「去确认」：滚动到待确认区（web scrollIntoView 的等价实现） */
  function scrollToDraft() {
    Taro.createSelectorQuery()
      .select("#draft-area")
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res) => {
        const rect = res[0] as { top: number } | undefined;
        const vp = res[1] as { scrollTop: number } | undefined;
        if (rect?.top != null) Taro.pageScrollTo({ scrollTop: (vp?.scrollTop ?? 0) + rect.top - 16, duration: 300 });
      });
  }

  const slices = ov ? categoryBreakdown(ov.byCategory ?? {}) : [];
  const budget = ov ? budgetTone(ov.outCents, Number(ov.budget?.monthly_limit_cents ?? 0), Number(ov.budget?.alert_threshold ?? 80)) : null;
  const outDelta = ov ? momChange(ov.outCents, ov.prev?.outCents ?? 0) : null;
  const rate = ov ? savingsRate(ov.inCents, ov.outCents) : null;

  return (
    <PageShell active="finance">
      {/* hero（= web header.mb-5.text-center） */}
      <View className="fin-hero">
        <View className="fin-hero-line">
          <Text className="hero text-gradient">拾光</Text>
          <Text className="fin-hero-sub">财务</Text>
        </View>
        <Text className="fin-hero-tip">动态里说的钱都在这里 —— 确认草稿、管账户、看月度结构</Text>
      </View>

      <FinTabs modules={modules} />

      {/* 月份导航 + 记一笔（窄屏 flex-wrap 自动换行，避免按钮溢出） */}
      <View className="fin-toolbar">
        <View className="fin-toolbar-nav">
          <View className="nav-btn" hoverClass="press" onTap={() => { const m = shiftMonth(month, -1); setMonth(m); void load(m); }}>
            ‹
          </View>
          <Text className="fin-month">{monthTitle(month)}</Text>
          <View className="nav-btn" hoverClass="press" onTap={() => { const m = shiftMonth(month, 1); setMonth(m); void load(m); }}>
            ›
          </View>
        </View>
        <View className="fin-toolbar-acts">
          <Button className="btn-primary fin-btn-add ico-row" hoverClass="press" onClick={() => setAdding(true)}>
            <LucideIcon name="plus" size={13} color="currentColor" />
            <Text>记一笔</Text>
          </Button>
        </View>
      </View>

      {/* 已有数据时的刷新失败提示（首次加载失败走下方整页错误态） */}
      {ov && loadErr ? (
        <View className="msg-banner msg-banner-err">
          加载失败：{loadErr}
          <View className="fin-retry" onTap={() => void load()}>
            重试
          </View>
        </View>
      ) : null}

      {!ov ? (
        loadErr ? (
          <View className="fin-loadfail">
            <Text className="fin-loadfail-text">加载失败：{loadErr}</Text>
            <Button className="btn-primary fin-loadfail-btn" hoverClass="press" onClick={() => void load()}>
              重试
            </Button>
          </View>
        ) : (
          <FinSkeleton rows={3} />
        )
      ) : (
        <>
          {/* 草稿提醒条 */}
          {drafts.length > 0 && (
            <View className="draft-strip">
              <View className="draft-strip-text ico-row">
                <LucideIcon name="download" size={12} color="var(--warn)" />
                <Text>
                  有 <Text className="draft-strip-n">{drafts.length}</Text> 笔动态识别的流水待确认
                </Text>
              </View>
              <View className="draft-strip-go" onTap={scrollToDraft}>
                去确认
              </View>
            </View>
          )}

          {/* 概览卡（= web display-overview.tsx OverviewCard：glass rounded-2xl p-5） */}
          <View className="glass glass-p5 fin-card">
            <View className="ov-grid3">
              <View className="ov-cell">
                <Text className="ov-label">本月支出</Text>
                <Text className="ov-num money-out">¥{yuan(ov.outCents)}</Text>
                {outDelta != null && (
                  <Text className={`ov-sub tabular ${outDelta > 0 ? "money-out" : "money-in"}`}>
                    较上月 {outDelta > 0 ? "+" : ""}
                    {outDelta}%
                  </Text>
                )}
              </View>
              <View className="ov-cell">
                <Text className="ov-label">本月收入</Text>
                <Text className="ov-num money-in">¥{yuan(ov.inCents)}</Text>
              </View>
              <View className="ov-cell">
                <Text className="ov-label">结余</Text>
                {/* nowrap：窄容器会把 -¥1506.50 从负号后断行成两行 */}
                <Text className={`ov-num nowrap ${ov.inCents - ov.outCents >= 0 ? "ov-accent" : "money-out"}`}>{fmtMoney(ov.inCents - ov.outCents)}</Text>
                {rate != null && <Text className="ov-sub dim">储蓄率 {rate}%</Text>}
              </View>
            </View>

            <SavingsTrend trend={ov.trend ?? []} />

            {/* 预算进度（编辑态内联替换，同 web） */}
            <View className="ov-sec">
              {editingBudget ? (
                <BudgetEditor
                  ov={ov}
                  onCancel={() => setEditingBudget(false)}
                  onSaved={async () => {
                    setEditingBudget(false);
                    showToast({ type: "ok", text: "💾 月度上限已保存" });
                    await load();
                  }}
                />
              ) : (
                <>
                  <View className="budget-head">
                    <Text className="budget-title">
                      {Number(ov.budget?.monthly_limit_cents ?? 0) > 0 ? `月度上限 ¥${yuan(Number(ov.budget.monthly_limit_cents))}` : "未设月度上限"}
                    </Text>
                    <View className="budget-edit-link" onTap={() => setEditingBudget(true)}>
                      {Number(ov.budget?.monthly_limit_cents ?? 0) > 0 ? "调整" : "设置"}
                    </View>
                  </View>
                  {Number(ov.budget?.monthly_limit_cents ?? 0) > 0 && budget && (
                    <>
                      <View className="budget-bar">
                        <View
                          className={`budget-bar-in budget-bar-${budget.tone}`}
                          style={{ width: `${Math.min(budget.pct, 100)}%` }}
                        />
                      </View>
                      <Text className={`budget-note tabular ${budget.tone === "over" ? "money-out" : budget.tone === "warn" ? "budget-warn" : "dim"}`}>
                        {budget.tone === "over"
                          ? `⚠️ 已超支 ¥${yuan(ov.outCents - Number(ov.budget.monthly_limit_cents))}（${budget.pct}%）`
                          : budget.tone === "warn"
                            ? `⚠️ 已用 ${budget.pct}%，接近上限，注意控制`
                            : `已用 ${budget.pct}%`}
                      </Text>
                    </>
                  )}
                </>
              )}
            </View>

            {/* 分类占比：横条 + 图例（前 6 类） */}
            {slices.length > 0 && (
              <View className="ov-sec">
                <View className="cat-bar">
                  {slices.map((s) => (
                    <View key={s.category} className="cat-bar-seg" style={{ width: `${s.pct}%`, backgroundColor: TX_COLORS[s.category] ?? "#64748b" }} />
                  ))}
                </View>
                <View className="cat-legend">
                  {slices.slice(0, 6).map((s) => (
                    <View key={s.category} className="cat-legend-item">
                      <View className="cat-dot" style={{ backgroundColor: TX_COLORS[s.category] ?? "#64748b" }} />
                      <Text className="cat-name">{s.category}</Text>
                      <Text className="cat-amt tabular">
                        ¥{yuan(s.cents)} · {s.pct}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* 账户卡（= web accounts-card.tsx） */}
          <View className="glass glass-p5 fin-card">
            <View className="fin-card-head">
              <View className="fin-card-head-l">
                <Chip icon="credit_card" label="账户" tone="sky" />
                <Text className="fin-card-sum">合计 {fmtMoney((ov.accounts ?? []).reduce((s, a) => s + Number(a.balanceCents), 0))}</Text>
              </View>
              <View className="fin-card-manage" onTap={() => setManagingAccount(true)}>
                管理
              </View>
            </View>
            <View className="acc-grid">
              {(ov.accounts ?? []).map((a) => (
                <View key={a.id} className="acc-cell cell-bg">
                  <Text className="acc-icon">{a.icon}</Text>
                  <Text className="acc-name">{a.name}</Text>
                  {Number(a.balanceCents) < 0 ? (
                    <Text className="acc-bal money-out">{fmtMoney(Number(a.balanceCents))} ⚠</Text>
                  ) : (
                    <Text className="acc-bal">{fmtMoney(Number(a.balanceCents))}</Text>
                  )}
                </View>
              ))}
              {(ov.accounts ?? []).length === 0 && (
                <Text className="acc-empty">还没有账户 —— 点「管理」添加现金/支付宝等</Text>
              )}
            </View>
          </View>

          {/* 待确认流水（= web tx-confirm-list.tsx；确认即计入报表） */}
          {drafts.length > 0 && (
            <View className="draft-area" id="draft-area">
              <View className="draft-head">
                <View className="draft-head-l">
                  <Chip icon="download" label="待确认流水" tone="amber" />
                  <Text className="draft-head-sub">来自动态识别 · 确认后计入报表</Text>
                </View>
                <Button
                  className={`draft-all-btn ${confirmBusy ? "disabled" : ""}`}
                  disabled={confirmBusy}
                  hoverClass="press"
                  onClick={() => void confirmAll()}
                >
                  {confirmBusy ? (
                    "确认中…"
                  ) : (
                    <View className="ico-row">
                      <LucideIcon name="zap" size={12} color="currentColor" />
                      <Text>全部确认</Text>
                    </View>
                  )}
                </Button>
              </View>
              {drafts.map((t) => (
                <View key={t.id} className="draft-row cell-bg">
                  <TxRow
                    tx={t}
                    onConfirm={() => void confirmOne(t)}
                    onEdit={() => setEditing(t)}
                    onDelete={() => void remove(t)}
                    delArmed={armDel === t.id}
                  />
                </View>
              ))}
            </View>
          )}

          {/* 流水列表（= web tx-confirmed-list.tsx） */}
          <View className="glass glass-p5 fin-card fin-card-last">
            <View className="fin-card-head">
              <View className="fin-card-head-l">
                <Chip icon="receipt" label="流水" tone="slate" />
                <Text className="fin-card-sum">{confirmed.length} 笔</Text>
              </View>
            </View>
            {confirmed.length === 0 && (
              <Text className="tx-empty">本月还没有流水 —— 说句"打车花了30"，或点「＋ 记一笔」</Text>
            )}
            {confirmed.map((t) => (
              <View key={t.id} className="tx-row">
                <TxRow tx={t} onEdit={() => setEditing(t)} onDelete={() => void remove(t)} delArmed={armDel === t.id} />
              </View>
            ))}
          </View>

          <Text className="fin-footer">流水仅作记录与月度统计，不影响账户余额（余额在「管理」中维护）</Text>
        </>
      )}

      {/* 记一笔/编辑流水弹层（= web Modal+TxForm；小程序用底部 sheet 承载） */}
      {(adding || editing) && (
        <View className="overlay" style={{ zIndex: 65 }} onTap={() => { setAdding(false); setEditing(null); }} />
      )}
      {adding && (
        <View className="sheet fin-sheet">
          <View className="sheet-head">
            <Text className="sheet-title">记一笔</Text>
            <View className="sheet-close" onTap={() => setAdding(false)}>
              <LucideIcon name="x" size={14} color="currentColor" />
            </View>
          </View>
          <TxForm
            initial={null}
            onCancel={() => setAdding(false)}
            onSubmit={async (payload) => {
              try {
                await createTx(payload);
              } catch (e) {
                // 失败提示且不关表单（无 catch 会静默 + 清空表单）
                showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
                return;
              }
              setAdding(false);
              showToast({ type: "ok", text: "✅ 已记一笔" });
              await load();
            }}
          />
        </View>
      )}
      {editing && (
        <View className="sheet fin-sheet">
          <View className="sheet-head">
            <Text className="sheet-title">修改流水</Text>
            <View className="sheet-close" onTap={() => setEditing(null)}>
              <LucideIcon name="x" size={14} color="currentColor" />
            </View>
          </View>
          <TxForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              try {
                await patchTx(editing.id, payload);
                setEditing(null);
                showToast({ type: "ok", text: "💾 流水已更新" });
                await load();
              } catch (e) {
                showToast({ type: "err", text: e instanceof Error ? e.message : String(e) });
              }
            }}
          />
        </View>
      )}

      {/* 账户管理弹层（遮罩与记一笔/编辑同款，点空白关闭） */}
      {managingAccount && <View className="overlay" style={{ zIndex: 65 }} onTap={() => setManagingAccount(false)} />}
      {managingAccount && (
        <View className="sheet fin-sheet">
          <View className="sheet-head">
            <Text className="sheet-title">账户管理</Text>
            <View className="sheet-close" onTap={() => setManagingAccount(false)}>
              <LucideIcon name="x" size={14} color="currentColor" />
            </View>
          </View>
          <AccountManager
            accounts={ov?.accounts ?? []}
            onChanged={async () => {
              await load();
            }}
          />
        </View>
      )}
      {/* 页脚徽章（REQ-全站页脚徽章） */}
      <PageFooter icon="wallet" label="财务" />
    </PageShell>
  );
}
