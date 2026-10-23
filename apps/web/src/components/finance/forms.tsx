"use client";

import { useEffect, useState } from "react";
import { Archive } from "lucide-react";
import { Dismissable } from "@/components/dismissable";
import { TX_CATEGORIES, yuanToCents, centsToYuanInput } from "@/lib/finance";
import type { Account, Tx } from "./kit";
import { api, toLocalInput, fromLocalInput } from "./kit";
import { useArmConfirm } from "@/lib/use-arm-confirm";
import { useImeSubmit } from "@/lib/use-ime-submit";

export function TxForm({
  initial,
  accounts = [],
  onCancel,
  onSubmit,
  onBusyChange,
}: {
  initial?: Tx | null;
  /** 账户列表（记一笔可挂账户；空列表=不显示账户选择，保持旧行为） */
  accounts?: Account[];
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  /** busy 上报（二十轮 P2）：页面层传 <Modal busy> 提交中禁关闭，防在途提交反馈丢失后重复录入 */
  onBusyChange?: (b: boolean) => void;
}) {
  const [direction, setDirection] = useState<"out" | "in">(initial?.direction ?? "out");
  const [amount, setAmount] = useState(initial ? centsToYuanInput(initial.amount_cents) : "");
  const [category, setCategory] = useState(initial?.category ?? "餐饮");
  // 编辑态：无账户老流水保持「不挂账户」（??accounts[0] 会把它静默挂上第一账户，保存即改史）；
  // 新建态才默认选第一账户
  const [accountId, setAccountId] = useState<string>(initial ? (initial.account_id ?? "") : (accounts[0]?.id ?? ""));
  const [date, setDate] = useState(
    initial
      ? toLocalInput(initial.occurred_at).slice(0, 16)
      : toLocalInput(new Date().toISOString()).slice(0, 16),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? "");
  const [busy, setBusy] = useState(false);
  // 提交失败就地提示（历史 bug：无 catch 时静默失败，unhandled rejection 还会触发整页刷新清空表单）
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  /** 保存：按钮 submit 与表单 Enter 提交共用，守卫防双触发 */
  async function save() {
    if (busy || !amount) return;
    const cents = yuanToCents(amount);
    if (cents == null || cents <= 0) {
      // 区分非法/超限：yuanToCents 对 >¥100 万返回 null，笼统「需大于 0」会误导
      setErr(cents == null && amount.replace(/[¥￥,\s]/g, "").match(/^\d+(\.\d+)?$/) ? "单笔金额不能超过 ¥100 万" : "金额需大于 0");
      return;
    }
    // 时间被清空禁止提交：补记历史流水时误清空会按「现在」入账（记错发生时间且无提示）
    if (!date) {
      setErr("请填写发生时间");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        direction,
        amountCents: cents,
        category,
        // 账户：与语音记账/CSV 导入同口径挂账户（余额=期初口径不受影响）；显式选「不挂账户」时不带字段
        ...(accountId ? { accountId } : {}),
        // date 是北京墙上时间串（toLocalInput 产），须按 +08:00 解析——裸 new Date() 按宿主时区解释，海外设备记错账时间
        occurredAt: fromLocalInput(date) ?? new Date().toISOString(),
        note: note || null,
        counterparty: counterparty.trim() || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ime = useImeSubmit(save);
  return (
    <form
      className="space-y-2.5"
      onSubmit={ime.onSubmit}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
    >
      <div className="flex gap-1.5">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${
              direction === d
                ? d === "out"
                  ? "bg-rose-600 text-white"
                  : "bg-emerald-600 text-white"
                : "bg-elevated text-ink-mute hover:bg-soft"
            }`}
          >
            {d === "out" ? "支出" : "收入"}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <span className="flex items-center text-lg text-ink-dim">¥</span>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="金额"
          className="w-28 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-sky-500"
        >
          {TX_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      {accounts.length > 0 && (
        <div className="flex gap-2">
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            title="挂到哪个账户（只作标签，不改变账户余额）"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-sky-500"
          >
            <option value="">不挂账户</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular-nums outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex gap-2">
        <input
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          placeholder="对方（可空）"
          title="和谁有关 —— 填了会关联到 TA 的人情账（如：老王）"
          className="w-24 shrink-0 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <input
          value={note ?? ""}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可空）"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
      </div>
      {err && <p className="text-micro text-danger">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-lg px-4 py-1.5 text-xs text-ink-mute hover:bg-soft">
          取消
        </button>
        <button
          type="submit"
          disabled={busy || !amount || Number(amount) <= 0}
          className="btn-primary rounded-lg px-5 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          {busy ? "保存中…" : initial ? "保存" : "记入"}
        </button>
      </div>
    </form>
  );
}

/** 账户管理：新增（含期初余额）+ 行内改名/改图标 + 期初余额 + 归档（C1 FR-C1.5） */
export function AccountManager({ accounts, onChanged }: { accounts: Account[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💳");
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const ICONS = ["💵", "🅰", "💬", "💳", "🏦", "📈", "🎓", "🏠"];
  // 行内改名草稿与错误提示（重名 400 就地显示；期初余额/图标/归档失败也复用行内提示）
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [rowErr, setRowErr] = useState<Record<string, string | null>>({});
  // 新增账户失败提示（历史 bug：try/finally 无 catch，失败静默 + unhandled rejection）
  const [addErr, setAddErr] = useState<string | null>(null);
  // 图标选择浮层（打开的账户 id）
  const [iconPick, setIconPick] = useState<string | null>(null);
  // 归档两步确认（全站规范，替代原生 confirm）
  const armArchive = useArmConfirm();

  async function saveName(a: Account) {
    const draft = (nameDrafts[a.id] ?? a.name).trim();
    setRowErr((e) => ({ ...e, [a.id]: null }));
    if (!draft || draft === a.name) return;
    try {
      await api(`/api/accounts/${a.id}`, "PATCH", { name: draft });
      await onChanged();
    } catch (err) {
      setRowErr((e) => ({ ...e, [a.id]: err instanceof Error ? err.message : "改名失败" }));
    }
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {accounts.map((a) => (
          <li key={a.id} className="group rounded-lg border border-line-soft bg-bg/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIconPick(iconPick === a.id ? null : a.id)}
                title="点击更换图标"
                className="shrink-0 rounded px-0.5 text-lg transition hover:bg-soft"
              >
                {a.icon}
              </button>
              <input
                value={nameDrafts[a.id] ?? a.name}
                onChange={(e) => setNameDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                onBlur={() => void saveName(a)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveName(a);
                }}
                maxLength={20}
                title="点击编辑账户名，回车或移开焦点保存"
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition focus:border-sky-500 focus:bg-surface"
              />
              <input
                type="number"
                step="0.01"
                key={`${a.id}:${a.openingBalanceCents}`}
                defaultValue={centsToYuanInput(a.openingBalanceCents)}
                title="期初余额（元，改后账户余额=新期初+流水）"
                onBlur={async (e) => {
                  // 清空=放弃修改意图（二十轮 P3）：非受控 defaultValue 清空后失焦报
                  // 「金额格式不正确」是误报——恢复显示原值即可，不改库
                  if (!e.target.value.trim()) {
                    e.target.value = centsToYuanInput(a.openingBalanceCents);
                    setRowErr((prev) => ({ ...prev, [a.id]: null }));
                    return;
                  }
                  const v = yuanToCents(e.target.value);
                  if (v == null) {
                    // 非法输入就地提示（原 parseFloat NaN 版静默忽略，会让人以为已保存）
                    setRowErr((prev) => ({ ...prev, [a.id]: "金额格式不正确" }));
                    return;
                  }
                  if (v !== a.openingBalanceCents) {
                    try {
                      await api(`/api/accounts/${a.id}`, "PATCH", { openingBalanceCents: v });
                      await onChanged();
                    } catch (ce) {
                      setRowErr((prev) => ({ ...prev, [a.id]: ce instanceof Error ? ce.message : "保存失败" }));
                    }
                  }
                }}
                className="w-24 rounded border border-line bg-surface px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-sky-500"
              />
              <button
                title="归档账户（历史流水保留，3 秒内再点确认）"
                onClick={async () => {
                  if (!armArchive.arm(a.id)) return;
                  try {
                    await api(`/api/accounts/${a.id}`, "DELETE");
                    await onChanged();
                  } catch (ce) {
                    setRowErr((prev) => ({ ...prev, [a.id]: ce instanceof Error ? ce.message : "归档失败" }));
                  }
                }}
                className={`row-actions-hidden hidden group-hover:block ${armArchive.armedId === a.id ? "text-[10px] font-medium leading-none text-danger" : "text-ink-dim hover:text-danger"}`}
              >
                {armArchive.armedId === a.id ? "确认归档?" : <Archive size={12} />}
              </button>
            </div>
            {rowErr[a.id] && <p className="mt-1 text-micro text-danger">{rowErr[a.id]}</p>}
            {iconPick === a.id && (
              <Dismissable onClose={() => setIconPick(null)} className="mt-2 rounded-lg border border-line-soft bg-surface p-2">
                <div className="flex flex-wrap gap-1.5">
                  {ICONS.map((i) => (
                    <button
                      key={i}
                      onClick={async () => {
                        setIconPick(null);
                        if (i === a.icon) return;
                        try {
                          await api(`/api/accounts/${a.id}`, "PATCH", { icon: i });
                          await onChanged();
                        } catch (ce) {
                          setRowErr((prev) => ({ ...prev, [a.id]: ce instanceof Error ? ce.message : "更换图标失败" }));
                        }
                      }}
                      className={`h-8 w-8 rounded-lg text-lg transition hover:bg-soft ${i === a.icon ? "bg-sky-500/15 ring-1 ring-sky-500" : ""}`}
                    >
                      {i}
                    </button>
                  ))}
                </div>
              </Dismissable>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-line-soft pt-3">
        <select value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none">
          {ICONS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新账户名（如：招行储蓄卡）"
          className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />
        <input
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          type="number"
          step="0.01"
          placeholder="当前余额"
          title="当前余额（元），可留空"
          className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular-nums outline-none focus:border-sky-500"
        />
        <button
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            setAddErr(null);
            try {
              // 期初余额允许留空/为 0（原语义）；非法输入就地提示，不再静默按 0 入账
              const cents = opening ? yuanToCents(opening) : 0;
              if (cents == null) {
                setAddErr("金额格式不正确");
                return;
              }
              await api("/api/accounts", "POST", { name: name.trim(), icon, openingBalanceCents: cents });
              setName("");
              setOpening("");
              await onChanged();
            } catch (ce) {
              setAddErr(ce instanceof Error ? ce.message : "添加失败");
            } finally {
              setBusy(false);
            }
          }}
          className="btn-primary rounded-lg px-4 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          添加
        </button>
      </div>
      {addErr && <p className="text-micro text-danger">{addErr}</p>}
    </div>
  );
}
