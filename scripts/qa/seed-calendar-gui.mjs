/**
 * 深度体验(日历四视图)种子数据——打到本地 3100(AUTH_DISABLED=1, 开发库)。
 * 用后即弃:运行 node scripts/qa/seed-calendar-gui.mjs --wipe 可清掉本脚本数据(按「QA·」前缀识别)。
 * 覆盖:今日多块+缺口、本周各日多分类(周占比条)、上周/本月前几周、上月、年初以来零星(年热力图)。
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

const day = (offset, hm = "12:00") => {
  const d = new Date(Date.now() + offset * 86_400_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}:00+08:00`;
};
const dayYmd = (offset) => day(offset).slice(0, 10);

const wipe = process.argv.includes("--wipe");
if (wipe) {
  // 一年范围一次拉全,清 QA· 前缀(幂等)
  const { blocks } = await j("GET", `/api/blocks/range?from=${dayYmd(-400)}&to=${dayYmd(30)}`);
  for (const b of blocks ?? []) {
    if (!String(b.title).startsWith("QA·")) continue;
    await j("DELETE", `/api/blocks/${b.id}`).catch(() => {});
  }
  console.log("[seed] 已清理 QA· 时间块");
  process.exit(0);
}

// 预设分类 id 映射(sleep/work/exercise/social/learn/other 等预设本就是固定串,但自定义可能被删后重建;
// 以接口返回为准)
const { activities } = await j("GET", "/api/activities");
const act = (name) => activities.find((a) => a.name.includes(name))?.id ?? "other";
console.log(`[seed] 分类:${activities.map((a) => `${a.name}=${a.id}`).join(", ")}`);

const mk = async (offset, hmStart, hmEnd, title, activityName) =>
  j("POST", "/api/blocks", {
    title,
    startAt: day(offset, hmStart),
    endAt: day(offset, hmEnd),
    activityId: act(activityName),
  });

let n = 0;
const safeMk = async (...args) => {
  try { await mk(...args); n++; } catch (e) { console.warn(`[seed] 跳过(${args[3]}): ${e.message}`); }
};

// —— 今天:3 块 + 留缺口(16:00 后无块,缺口补录用);14:00-15:30 兼作冲突检测基准块
await safeMk(0, "09:00", "10:30", "QA·晨间英语精读", "学习");
await safeMk(0, "11:00", "12:00", "QA·午间慢跑", "健身");
await safeMk(0, "14:00", "15:30", "QA·项目周会", "工作");

// —— 昨天:2 块(日视图翻页)
await safeMk(-1, "10:00", "11:30", "QA·代码评审", "工作");
await safeMk(-1, "20:00", "21:00", "QA·夜跑 5km", "健身");

// —— 本周前几日:多分类,喂周视图列合计/分类占比
for (const off of [-2, -3]) {
  await safeMk(off, "09:30", "11:00", "QA·深度编码", "工作");
  await safeMk(off, "14:00", "15:00", "QA·日语网课", "学习");
  await safeMk(off, "19:00", "20:00", "QA·健身房力量", "健身");
}

// —— 上周(每天 1-2 块):周视图 ‹ 导航
for (const off of [-7, -8, -9, -10]) {
  await safeMk(off, "10:00", "11:00", "QA·上周事务", "工作");
  if (off % 2 === 0) await safeMk(off, "16:00", "17:30", "QA·上周阅读", "学习");
}

// —— 本月更早(两周前):月视图网格
for (const off of [-14, -16, -18]) {
  await safeMk(off, "09:00", "10:00", "QA·月内早读", "学习");
}

// —— 上月:月视图 ‹ 导航
for (const off of [-32, -35, -38]) {
  await safeMk(off, "15:00", "16:00", "QA·上月复盘", "工作");
}

// —— 年内零星(1/3/5/7 月方向,-90/-150/-210/-270):年视图热力图非空格 + 年日均
for (const off of [-95, -150, -210, -270]) {
  await safeMk(off, "10:00", "11:00", "QA·年度长线", "工作");
}

console.log(`[seed] 日历种子完成:${n} 个时间块(今天 14:00-15:30 为冲突检测基准;16:00 后为缺口区)`);
