/**
 * 微信绑定冲突选择弹层（REQ-账号数据保留选择）：
 * 密码登录绑定微信时，若该微信已被「有数据」的账号占用，服务端 409 返回双方数据概览，
 * 本弹层让用户明确选择保留哪份数据继续使用（两个账号的数据都原样保留，绝不删除）：
 * - 保留当前账号：微信从对方解绑并绑到当前账号（对方数据原地保留，仅失去微信入口）
 * - 保留微信账号：本次会话切换为微信绑定的账号（当前账号仍可密码登录网页版）
 * 登录页与「我的」页共用（bind-session 409 → ApiError.data）。
 */
import { View, Text, Button } from "@tarojs/components";
import LucideIcon from "@/components/lucide-icon";
import type { WechatBindConflict } from "@/lib/api";
import "./index.scss";

function totalOf(c: WechatBindConflict["owner"]): number {
  const n = c.counts;
  return n.entries + n.transactions + n.todos + n.blocks + n.contacts + n.goalSpaces + n.spaceReflections;
}

/** 数据概览一行：只列非零主项 + 合计兜底（0 条显示「空账号」） */
function countsLine(c: WechatBindConflict["owner"]): string {
  const n = c.counts;
  const parts: string[] = [];
  if (n.entries) parts.push(`动态 ${n.entries}`);
  if (n.transactions) parts.push(`账单 ${n.transactions}`);
  if (n.todos) parts.push(`待办 ${n.todos}`);
  if (n.blocks) parts.push(`日程 ${n.blocks}`);
  if (n.contacts) parts.push(`联系人 ${n.contacts}`);
  if (!parts.length) return "空账号，暂无记录";
  const total = totalOf(c);
  return parts.join(" · ") + (total > n.entries + n.transactions + n.todos + n.blocks + n.contacts ? ` · 共 ${total} 条` : "");
}

export default function WxBindSheet({
  open,
  conflict,
  busy,
  onResolve,
  onClose,
}: {
  open: boolean;
  conflict: WechatBindConflict | null;
  busy: boolean;
  onResolve: (resolve: "current" | "wechat") => void;
  onClose: () => void;
}) {
  if (!open || !conflict) return null;
  return (
    <>
      <View className="overlay" onClick={busy ? undefined : onClose} />
      <View className="sheet wxbs safe-bottom">
        <View className="wxbs-handle" />
        <Text className="wxbs-title">该微信已绑定其他账号</Text>
        <Text className="hint wxbs-desc">
          两份选择都不删除任何数据：选定「保留哪份数据」后，另一个账号会原样保留（可随时用密码登录网页版查看）。
        </Text>

        <View className="wxbs-acc">
          <View className="wxbs-acc-head">
            <Text className="wxbs-acc-name">{conflict.current.nickname || "当前账号"}</Text>
            <Text className="wxbs-tag wxbs-tag-on">当前登录</Text>
          </View>
          <Text className="wxbs-acc-counts">{countsLine(conflict.current)}</Text>
        </View>
        <View className="wxbs-acc">
          <View className="wxbs-acc-head">
            <Text className="wxbs-acc-name">{conflict.owner.nickname || "微信账号"}</Text>
            <Text className="wxbs-tag">微信绑定中</Text>
          </View>
          <Text className="wxbs-acc-counts">{countsLine(conflict.owner)}</Text>
        </View>

        <Button
          className={`btn-reset btn-primary wxbs-btn${busy ? " disabled" : ""}`}
          hoverClass="press"
          disabled={busy}
          onClick={() => onResolve("current")}
        >
          {busy ? "处理中…" : "保留当前账号的数据（微信改绑到这里）"}
        </Button>
        <Button
          className={`btn-reset wxbs-btn-alt${busy ? " disabled" : ""}`}
          hoverClass="press"
          disabled={busy}
          onClick={() => onResolve("wechat")}
        >
          <LucideIcon name="repeat" size={13} color="var(--accent)" />
          <Text> 保留微信账号的数据（本次登录切到它）</Text>
        </Button>
        <Text className="wxbs-cancel" onClick={busy ? undefined : onClose}>
          暂不处理，以后再说
        </Text>
      </View>
    </>
  );
}
