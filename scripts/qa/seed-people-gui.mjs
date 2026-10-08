/**
 * 深度体验(人际主线·联系人/往来/人情账)种子数据——打到本地 3100(AUTH_DISABLED=1, 开发库)。
 * 用后即弃：node scripts/qa/seed-people-gui.mjs --wipe 可清掉本脚本数据（按「QA·」前缀识别）。
 */
const BASE = "http://127.0.0.1:3100";

const j = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
};

const pad = (n) => String(n).padStart(2, "0");
/** 北京日历日 offset 天前/后，返回 YYYY-MM-DD（UTC+8 推算） */
const bjDate = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000 + 8 * 3600_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
/** 北京时刻 ISO：offset 天前 hm 时分（+08:00 显式） */
const bjIso = (offset, hm = "12:00") => `${bjDate(offset)}T${hm}:00+08:00`;

const wipe = process.argv.includes("--wipe");
if (wipe) {
  const { contacts } = await j("GET", "/api/contacts");
  for (const c of contacts ?? []) {
    if (!c.name.startsWith("QA·")) continue;
    const detail = await j("GET", `/api/contacts/${c.id}`).catch(() => null);
    for (const it of detail?.timeline ?? []) await j("DELETE", `/api/interactions/${it.id}`).catch(() => {});
    await j("DELETE", `/api/contacts/${c.id}`).catch(() => {});
  }
  // 流水不随联系人删除（按 QA· 对方前缀清理），防重复种子翻倍；接口按月查询，扫最近 2 个月
  for (const off of [0, 1]) {
    const d = new Date(Date.now() - off * 30 * 86_400_000 + 8 * 3600_000);
    const month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    const { transactions } = await j("GET", `/api/transactions?month=${month}&status=all`);
    for (const t of transactions ?? []) {
      if (t.counterparty?.startsWith("QA·")) await j("DELETE", `/api/transactions/${t.id}`).catch(() => {});
    }
  }
  console.log("[seed] 已清理 QA· 联系人、往来与人情流水");
  process.exit(0);
}

// 1. 联系人档案 ×5（覆盖：有往来/只有人情账/农历生日/今天生日/纪念日/仅档案无往来）
const wang = await j("POST", "/api/contacts", {
  name: "QA·老王",
  alias: "球友",
  group: "朋友",
  birthday: "1988-06-15",
  importance: 4,
  intimacy: 72,
  notes: "羽毛球搭子，周一三五晚上固定打球；不喝碳酸饮料。",
});

const chen = await j("POST", "/api/contacts", {
  name: "QA·小陈",
  group: "同事",
  birthday: bjDate(0).replace(/^\d{4}/, "1995"), // 今天生日（跨年取月日）
  importance: 3,
  intimacy: 55,
  notes: "同组前端，帮我带过两次饭。",
});
const lin = await j("POST", "/api/contacts", {
  name: "QA·林姨",
  group: "家人",
  birthdayCal: "lunar",
  lunarMonth: 5,
  lunarDay: 8,
  importance: 5,
  intimacy: 90,
  notes: "母亲大人。",
});
const zhao = await j("POST", "/api/contacts", {
  name: "QA·赵总",
  group: "客户",
  anniversary: "2023-10-20",
  importance: 5,
  intimacy: 40,
  notes: "重要客户，忌讳谈竞品。",
});
// stranger / lin 由下方汇总打印引用（覆盖「仅档案无往来」与「农历生日」两形态）
const stranger = await j("POST", "/api/contacts", {
  name: "QA·新朋友",
  group: "朋友",
  importance: 2,
  intimacy: 10,
});
void stranger; void lin;

// 2. 手动补往来 ×4（不同类型/时间分布：今天/昨天/上周/上月）
await j("POST", `/api/contacts/${wang.contact.id}/interactions`, {
  type: "聚会", summary: "羽毛球局 2 小时，赢了三局", occurredAt: bjIso(0, "19:30"),
});
await j("POST", `/api/contacts/${wang.contact.id}/interactions`, {
  type: "吃饭", summary: "打了球一起吃烧烤", occurredAt: bjIso(-1, "21:00"),
});
await j("POST", `/api/contacts/${chen.contact.id}/interactions`, {
  type: "互助", summary: "帮我 review 了发版 PR", occurredAt: bjIso(-2, "15:00"),
});
await j("POST", `/api/contacts/${zhao.contact.id}/interactions`, {
  type: "会谈", summary: "Q4 续约沟通，意向积极", occurredAt: bjIso(-30, "10:00"),
});

// 3. 人情账（财务流水：对方=联系人名，分类=人情往来）×3
const tx = async (contactName, direction, cents, note, daysAgo) =>
  j("POST", "/api/transactions", {
    direction,
    amountCents: cents,
    category: "人情往来",
    counterparty: contactName,
    note,
    occurredAt: bjIso(-daysAgo, "12:00"),
  });
await tx("QA·老王", "out", 26000, "生日红包", 20);
await tx("QA·老王", "in", 52000, "随礼回礼", 10);
await tx("QA·赵总", "out", 88000, "中秋礼盒", 15);
// 非人情往来对照（不应进「关联人情账」列表）
await j("POST", "/api/transactions", {
  direction: "out", amountCents: 9900, category: "餐饮", counterparty: "QA·老王",
  note: "工作餐", occurredAt: bjIso(-5, "12:00"),
});

const { contacts } = await j("GET", "/api/contacts");
console.log(`[seed] 联系人 ${contacts.length} 个：`);
for (const c of contacts.filter((x) => x.name.startsWith("QA·"))) {
  console.log(`  - ${c.name}（${c.group_tag}）往来 ${c.interaction_count} 次，人情净额 ${(c.gift_net_cents / 100).toFixed(0)} 元，id=${c.id}`);
}
console.log("[seed] 完成——打开 /contacts 体验");
