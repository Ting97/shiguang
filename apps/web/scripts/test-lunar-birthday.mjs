/* 农历生日端到端验证：建档 → 列表 → 提醒 → 编辑切换（本地 dev，AUTH_DISABLED） */
const BASE = "http://localhost:3000";

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

// 今天(2026-09-19)的农历日期，用于「今天生日」用例
const { default: solarLunar } = await import("solarlunar");
const today = solarLunar.solar2lunar(2026, 9, 19);
console.log(`今天农历：${today.monthCn}${today.dayCn} (month=${today.lMonth} day=${today.lDay})`);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? " —— " + JSON.stringify(detail) : ""}`); }
}

// ---- 1. 农历建档（今天生日：倒计时=0，提醒命中） ----
console.log("\n[1] 农历建档 + 今天生日命中提醒");
const r1 = await j("POST", "/api/contacts", {
  name: "农历测试-今天生日", group: "家人",
  birthdayCal: "lunar", lunarMonth: today.lMonth, lunarDay: today.lDay, lunarLeap: false,
});
check("建档 200", r1.status === 200, r1);
const c1 = r1.json.contact;
check("birthday_cal=lunar", c1?.birthday_cal === "lunar");
check("birthday 置空", c1?.birthday === null, c1?.birthday);
check("lunar 字段入库", c1?.lunar_month === today.lMonth && c1?.lunar_day === today.lDay && c1?.lunar_leap === false);

const rl = await j("GET", "/api/reminders");
const rc1 = (rl.json.contacts ?? []).find((c) => c.id === c1.id);
check("reminders 查询含农历生日联系人", !!rc1, rl.json.contacts?.length);

// ---- 2. 农历建档（闰月 + 非今天） ----
console.log("\n[2] 闰月农历建档");
const r2 = await j("POST", "/api/contacts", {
  name: "农历测试-闰六月", group: "朋友",
  birthdayCal: "lunar", lunarMonth: 6, lunarDay: 3, lunarLeap: true,
});
check("建档 200", r2.status === 200, r2);
const c2 = r2.json.contact;
check("lunar_leap=true", c2?.lunar_leap === true);

// ---- 3. 阳历建档不受影响 ----
console.log("\n[3] 阳历建档回归");
const r3 = await j("POST", "/api/contacts", { name: "阳历测试-普通", birthday: "1995-10-02" });
check("建档 200", r3.status === 200, r3);
check("birthday_cal=solar", r3.json.contact?.birthday_cal === "solar");
check("birthday 保留", r3.json.contact?.birthday === "1995-10-02");

// ---- 4. 农历缺月日 → 400 ----
console.log("\n[4] 参数校验");
const r4 = await j("POST", "/api/contacts", { name: "农历测试-缺日", birthdayCal: "lunar", lunarMonth: 5 });
check("缺农历日 400", r4.status === 400, r4);

// ---- 5. 编辑：农历 → 阳历切换，再切回 ----
console.log("\n[5] 编辑切换历法");
const p1 = await j("PATCH", `/api/contacts/${c2.id}`, {
  birthdayCal: "solar", birthday: "1990-08-15",
});
check("切阳历 200", p1.status === 200, p1);
check("birthday=solar 日期", p1.json.contact?.birthday === "1990-08-15");
check("lunar 字段清空", p1.json.contact?.lunar_month === null && p1.json.contact?.lunar_day === null && p1.json.contact?.lunar_leap === false);
const p2 = await j("PATCH", `/api/contacts/${c2.id}`, {
  birthdayCal: "lunar", lunarMonth: 6, lunarDay: 3, lunarLeap: true,
});
check("切回农历 200", p2.status === 200, p2);
check("birthday 置空", p2.json.contact?.birthday === null, p2.json.contact?.birthday);
check("lunar 字段恢复", p2.json.contact?.lunar_month === 6 && p2.json.contact?.lunar_day === 3 && p2.json.contact?.lunar_leap === true);

// ---- 6. 列表返回农历字段 ----
console.log("\n[6] 列表/详情字段");
const g = await j("GET", "/api/contacts");
const gc = (g.json.contacts ?? []).find((c) => c.id === c1.id);
check("列表含 birthday_cal/lunar_*", gc?.birthday_cal === "lunar" && gc?.lunar_month === today.lMonth, gc);
const gd = await j("GET", `/api/contacts/${c1.id}`);
check("详情含 lunar 字段", gd.json.contact?.lunar_day === today.lDay, gd.json.contact);

// ---- 清理测试数据 ----
console.log("\n[清理] 删除测试联系人");
for (const id of [c1.id, c2.id, r3.json.contact.id]) {
  const d = await j("DELETE", `/api/contacts/${id}`);
  check(`删除 ${id.slice(0, 8)}…`, d.status === 200, d);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
