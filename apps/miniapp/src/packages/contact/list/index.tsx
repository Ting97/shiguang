import { useState } from "react";
import { View, Text, Input } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { loadContacts } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { birthdayBadge, GROUP_EMOJI, IMPORTANCE_LABEL } from "../shared";
import "./index.scss";

/**
 * 联系人行契约（grep apps/api/src/server/people/repo.ts listWithStats 查证）：
 * GET /api/contacts → {contacts:[{id,name,alias,group_tag,birthday,birthday_cal,lunar_month,
 *   lunar_day,anniversary,intimacy,importance,notes,interaction_count,last_at,last_summary,
 *   gift_net_cents,...}]}（SQL 按 last_at desc 排序，最近往来在前）。
 * 坑：birthday/anniversary 经 to_char 已是纯 "YYYY-MM-DD" 串（无时区漂移），可直接取子串。
 */
interface ContactRow {
  id: string;
  name: string;
  alias?: string | null;
  group_tag?: string;
  birthday?: string | null;
  birthday_cal?: string | null;
  lunar_month?: number | null;
  lunar_day?: number | null;
  importance?: number;
  notes?: string | null;
  interaction_count?: number | string;
  last_summary?: string | null;
}

export default function ContactListPage() {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [inited, setInited] = useState(false);

  async function refresh() {
    try {
      const j = await loadContacts();
      setContacts(j.contacts ?? []);
      setMsg(null);
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

  function go(id: string) {
    Taro.navigateTo({ url: `/packages/contact/detail/index?id=${id}` });
  }

  // 服务端列表没有 q 参数，搜索走本地过滤（姓名/备注名/分组/档案备注）
  const kw = keyword.trim().toLowerCase();
  const shown = kw
    ? contacts.filter((c) =>
        [c.name, c.alias, c.group_tag, c.notes]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(kw)),
      )
    : contacts;

  return (
    <View className="page-pad">
      {msg && <View className="banner banner-err">{msg}</View>}

      <Input
        className="input search"
        value={keyword}
        placeholder="搜索姓名 / 分组 / 备注"
        placeholderClass="dim"
        onInput={(e) => setKeyword(e.detail.value)}
      />

      {shown.length === 0 && (
        <View className="card">
          <Text className="dim">
            {contacts.length === 0
              ? getSessionToken()
                ? "还没有联系人 —— 在动态里提及 TA 即可自动建档"
                : "未登录，请先登录"
              : "没有匹配的联系人"}
          </Text>
        </View>
      )}

      <View className="card">
        {shown.map((c) => {
          const bd = birthdayBadge(c); // 阳历生日才有倒计时；农历显示「农历M/D」
          const important = (c.importance ?? 0) >= 4;
          return (
            <View key={c.id} className="row" onClick={() => go(c.id)}>
              <View className="avatar">
                <Text>{c.name.slice(0, 1)}</Text>
              </View>
              <View className="grow">
                <View className="name-line">
                  <Text className="name">{c.name}</Text>
                  {!!c.alias && c.alias !== c.name && <Text className="dim alias">{c.alias}</Text>}
                  {important && <Text className="imp-tag">{IMPORTANCE_LABEL[c.importance as number] ?? ""}⭐</Text>}
                </View>
                <Text className="dim sub">
                  {GROUP_EMOJI[c.group_tag ?? ""] ?? "👤"} {c.group_tag ?? "其他"} · 互动 {Number(c.interaction_count ?? 0)} 次
                  {bd ? ` · ${bd}` : ""}
                </Text>
              </View>
              <Text className="arrow">›</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
