"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import Skeleton from "@/components/skeleton";
import FinanceTabs from "@/components/finance-tabs";
import { yuan } from "@/lib/finance";
import { api } from "@/shared/api";
import { useSession } from "@/shared/session";
import ModuleLocked from "@/components/module-locked";
import { toast } from "@/shared/ui/toast";
import { useArmConfirm } from "@/lib/use-arm-confirm";
import AssistantDock from "@/components/assistant-dock";

import {
  type Tx,
  type Overview,
  monthTitle,
  shiftMonth,
  nowMonth,
} from "../../components/finance/kit";
import { TxForm, AccountManager } from "../../components/finance/forms";
import { Modal } from "../../components/finance/display";
import { OverviewCard } from "../../components/finance/display-overview";
import { AccountsCard } from "../../components/finance/accounts-card";
import { DraftConfirmSection } from "../../components/finance/tx-confirm-list";
import { ConfirmedTxSection } from "../../components/finance/tx-confirmed-list";

export default function FinancePage() {
  // SSG 防 hydration mismatch：nowMonth() 作初值会把构建月烤进静态导出 HTML，跨月后客户端水合必失配。
  // 与日历四视图同款 mounted 骨架门：初始 null，mount 后再初始化当月，就绪前渲染骨架
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => setMonth(nowMonth()), []);
  const [ov, setOv] = useState<Overview | null>(null);
  // 流水分页（REQ-027）：草稿是待办不限量；已确认流水按月先取最近 PAGE_SIZE 条，「加载更多」扩窗重取
  const PAGE_SIZE = 20;
  const [drafts, setDrafts] = useState<Tx[]>([]);
  const [confirmed, setConfirmed] = useState<Tx[]>([]);
  const [confirmedTotal, setConfirmedTotal] = useState(0);
  const [visible, setVisible] = useState(PAGE_SIZE);
  // 加载失败态：给出重试入口，避免网络异常时永远停在骨架屏
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 「加载更多」在途态（二十轮 P3）：按钮反馈 + 防连点
  const [loadingMore, setLoadingMore] = useState(false);
  const [adding, setAdding] = useState(false);
  // 记一笔提交中禁关弹层（二十轮 P2）：POST 在途关弹层会丢成功反馈、诱发重复记账
  const [txBusy, setTxBusy] = useState(false);
  const [managingAccount, setManagingAccount] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false); // 确认提交中：防双击双发 PATCH
  const [editing, setEditing] = useState<Tx | null>(null);
  // 删除流水两步确认：全站规范 useArmConfirm（自带 3s 超时/换目标复位/<16ms 双击 ref 镜像），
  // 替代手写 armDel state + timer 版（缺 ref 镜像，极速双击需三击才删）
  const arm = useArmConfirm();

  // seq 守卫：快速切月时旧响应可能后到（头部已是新月、数据却是旧月），只让最新请求落地
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!month) return; // mounted 前不取数（month 由 mount effect 初始化）
    const seq = ++loadSeq.current;
    setLoadErr(null);
    // 扩窗加载在途反馈（二十轮 P3）：visible > 首页才亮「加载中…」，切月加载不误亮
    if (visible > PAGE_SIZE) setLoadingMore(true);
    try {
      // 已确认流水分块拉取：API 单次 limit 钳 500，旧版直接把窗口传给 limit，
      // 单月 >500 笔时返回恒 500 条、txs.length < total 恒真 →「加载更多」成死按钮
      const confirmedPaged = async (): Promise<{ transactions: Tx[]; total: number }> => {
        const SERVER_PAGE = 500;
        let rows: Tx[] = [];
        let total = 0;
        for (let offset = 0; offset < visible; offset += SERVER_PAGE) {
          const size = Math.min(SERVER_PAGE, visible - offset);
          const c = await api<{ transactions?: Tx[]; total?: number }>(
            `/api/transactions?month=${month}&status=confirmed&limit=${size}&offset=${offset}`,
          );
          total = c.total ?? 0;
          rows = rows.concat(c.transactions ?? []);
          if ((c.transactions?.length ?? 0) < size) break; // 已到底
        }
        return { transactions: rows, total };
      };
      const [o, d, c] = await Promise.all([
        api<Overview>(`/api/finance/overview?month=${month}`),
        api<{ transactions?: Tx[] }>(`/api/transactions?month=${month}&status=draft`),
        confirmedPaged(),
      ]);
      if (seq !== loadSeq.current) return; // 过期响应丢弃
      setOv(o);
      setDrafts(d.transactions ?? []);
      setConfirmed(c.transactions);
      setConfirmedTotal(c.total);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      // 失败不停在骨架屏（历史 bug：无 catch 时 unhandled rejection + 永久加载中）
      setLoadErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  }, [month, visible]);
  useEffect(() => {
    load();
  }, [load]);

  /** 切月重置分页窗口：新月份从头展示最近一页 */
  function gotoMonth(delta: number) {
    setVisible(PAGE_SIZE);
    setMonth((m) => (m ? shiftMonth(m, delta) : m));
  }

  async function confirmTx(t: Tx) {
    if (confirmBusy) return;
    setConfirmBusy(true); // 提交期间锁按钮：防双击双发 PATCH 重复确认
    try {
      await api(`/api/transactions/${t.id}`, "PATCH", { confirm: true });
      toast(`✅ 已确认：${t.direction === "out" ? "支出" : "收入"} ¥${yuan(t.amount_cents)}`);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    } finally {
      setConfirmBusy(false);
    }
  }

  /** 一键全部确认（流水不入账：确认即计入报表，无需选账户） */
  async function confirmAllTx() {
    if (drafts.length === 0 || confirmBusy) return;
    setConfirmBusy(true); // 提交期间锁按钮：防双击双发整批 PATCH
    try {
      // allSettled：旧版 Promise.all 任一失败即进 catch 立刻刷新——其余在途 PATCH 随后成功的
      // 会被这次刷新显示回「待确认」，且用户不知道哪几笔已生效；逐笔 settle 后统一刷新+计数
      const results = await Promise.allSettled(drafts.map((t) => api(`/api/transactions/${t.id}`, "PATCH", { confirm: true })));
      const fails = results.filter((r) => r.status === "rejected");
      if (fails.length === 0) toast(`✅ 已全部确认（${drafts.length} 笔）`);
      else {
        const firstErr = fails[0] as PromiseRejectedResult;
        toast(`已确认 ${drafts.length - fails.length} 笔，${fails.length} 笔失败：${firstErr.reason instanceof Error ? firstErr.reason.message : String(firstErr.reason)}`, "err");
      }
      await load();
    } finally {
      setConfirmBusy(false);
    }
  }

  async function removeTx(t: Tx) {
    // 两步确认（全站规范）：首点进入待确认态（行内按钮变「确认删除?」），3 秒内再点执行
    if (!arm.arm(t.id)) return;
    try {
      await api(`/api/transactions/${t.id}`, "DELETE");
      toast("🗑 已删除流水");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  }

  // 模块关闭兜底（REQ-028）：入口隐藏后仍可能直连 /finance——API 层已 403，这里出未开通页
  const { user: meUser } = useSession();
  if (meUser && !meUser.modules.includes("finance")) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          <ModuleLocked
            title="财务"
            desc="该模块已关闭。可在【我的 → 功能管理】重新开启（数据保留不丢），或联系管理员。"
            backHref="/"
            backLabel="返回首页"
          />
        </div>
      </main>
    );
  }

  // mounted 门：month 未就绪时与首帧 SSG HTML 同构地渲染骨架（此时 loadErr 必为 null，不会误显错误态）
  if (!month || !ov) {
    return (
      <main className="min-h-screen text-ink">
        <div className="mx-auto max-w-2xl px-5 py-8">
          {loadErr ? (
            <div className="py-10 text-center">
              <p className="text-sm text-danger">加载失败：{loadErr}</p>
              <button onClick={() => void load()} className="btn-primary mt-3 rounded-xl px-5 py-2 text-xs">
                重试
              </button>
            </div>
          ) : (
            <Skeleton rows={3} className="py-2" />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-ink">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <header className="mb-5 text-center">
          <h1 className="text-gradient text-3xl font-bold tracking-wide sm:text-4xl">
            拾光<span className="ml-2 align-middle text-sm font-normal tracking-normal text-ink-dim">财务</span>
          </h1>
          <p className="mt-2 text-xs text-ink-dim">动态里说的钱都在这里 —— 确认草稿、管账户、看月度结构</p>
        </header>

        <FinanceTabs />

        {/* 月份导航 + 记一笔（窄屏自动换行，避免按钮溢出） */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => gotoMonth(-1)} aria-label="上一月" className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-ink-mute transition hover:border-sky-500/50 hover:text-accent"><ChevronLeft size={13} /></button>
            <span className="min-w-24 text-center text-sm font-semibold text-ink tabular-nums">{monthTitle(month)}</span>
            <button onClick={() => gotoMonth(1)} aria-label="下一月" className="rounded-lg border border-line-soft bg-surface/60 px-2.5 py-1.5 text-ink-mute transition hover:border-sky-500/50 hover:text-accent"><ChevronRight size={13} /></button>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button onClick={() => setAdding(true)} className="btn-primary flex items-center gap-1 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium">
              <Plus size={13} aria-hidden /> 记一笔
            </button>
          </div>
        </div>

        {/* 已有数据时的刷新失败提示（首次加载失败走上方整页错误态） */}
        {loadErr && (
          <div className="msg-banner msg-banner-err mb-4">
            加载失败：{loadErr}
            <button onClick={() => void load()} className="ml-2 underline underline-offset-2">
              重试
            </button>
          </div>
        )}

        {/* 草稿提醒 */}
        {drafts.length > 0 && (
          <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-warn">
            <Download size={13} className="shrink-0" aria-hidden />
            <span>
              有 <span className="font-bold">{drafts.length}</span> 笔动态识别的流水待确认
            </span>
            <button onClick={() => document.getElementById("draft-area")?.scrollIntoView({ behavior: "smooth" })} className="ml-2 underline underline-offset-2 hover:text-warn">
              去确认
            </button>
          </div>
        )}

        {/* 概览卡 */}
        <OverviewCard
          ov={ov}
          editingBudget={editingBudget}
          onEditBudget={setEditingBudget}
          onBudgetSaved={async () => {
            toast("💾 月度上限已保存");
            await load();
          }}
        />

        {/* 账户 */}
        <AccountsCard accounts={ov.accounts} onManage={() => setManagingAccount(true)} />

        {/* 待确认流水（确认即计入报表，不再选账户入账） */}
        <DraftConfirmSection
          drafts={drafts}
          confirmBusy={confirmBusy}
          onConfirm={confirmTx}
          onConfirmAll={confirmAllTx}
          onEdit={setEditing}
          onRemove={removeTx}
          delArmed={arm.armedId}
        />

        {/* 流水列表（每月最近 20 条 + 加载更多） */}
        <ConfirmedTxSection
          txs={confirmed}
          total={confirmedTotal}
          loadingMore={loadingMore}
          onLoadMore={() => setVisible((v) => v + PAGE_SIZE)}
          editing={editing}
          setEditing={setEditing}
          onSubmitEdit={async (t, payload) => {
            await api(`/api/transactions/${t.id}`, "PATCH", payload);
            setEditing(null);
            toast("💾 流水已更新");
            await load();
          }}
          onRemove={removeTx}
          delArmed={arm.armedId}
        />

        {/* 手动记账弹层 */}
        {adding && (
          <Modal title="记一笔" onClose={() => setAdding(false)} busy={txBusy}>
            <TxForm
              accounts={ov.accounts}
              onCancel={() => setAdding(false)}
              onBusyChange={setTxBusy}
              onSubmit={async (payload) => {
                try {
                  await api("/api/transactions", "POST", payload);
                } catch (e) {
                  // 失败提示且不关表单（无 catch 会静默 + unhandled rejection 触发整页刷新清空表单）
                  toast(e instanceof Error ? e.message : String(e), "err");
                  return;
                }
                setAdding(false);
                toast("✅ 已记一笔");
                await load();
              }}
            />
          </Modal>
        )}


        {/* 账户管理弹层 */}
        {managingAccount && (
          <Modal title="账户管理" onClose={() => setManagingAccount(false)}>
            <AccountManager
              accounts={ov.accounts}
              onChanged={async () => {
                await load();
              }}
            />
          </Modal>
        )}

<footer className="mt-10 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/15 px-2 py-0.5 text-[10px] text-ai">拾光 · 财务</span>
        </footer>
      </div>
      {/* 财务管家（REQ-019 FR-C4） */}
      <AssistantDock scope="finance" />
    </main>
  );
}
