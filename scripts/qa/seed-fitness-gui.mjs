/**
 * 深度体验(健身模块·运动空间)种子数据——打到本地 3100(AUTH_DISABLED=1, 测试库)。
 * 运行: node scripts/qa/seed-fitness-gui.mjs          # 造数（幂等：同日指标/睡眠/计划 note 标记去重）
 *       node scripts/qa/seed-fitness-gui.mjs --wipe   # 清掉本脚本造的计划与活跃目标
 * 造数: 档案/目标/8 周体重腰围/近 7 天睡眠/今日力量(draft)+今日跑步(confirmed)+明日跑步(draft)
 *       + 上周两条已完成(带实际数据) —— 覆盖今日/计划/趋势/目标&档案四 tab。
 */
const BASE = "http://127.0.0.1:3100";
const TAG = "[fit-gui]";

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

// 北京「今天」（与后端 UTC+8 口径一致）
const bjToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const addDays = (d, n) => {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};
const thisMonday = (d) => {
  const dt = new Date(d + "T00:00:00Z");
  const dow = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();
  return addDays(d, 1 - dow);
};

const wipe = process.argv.includes("--wipe");
if (wipe) {
  const today = bjToday();
  const { plans } = await j("GET", `/api/fitness/plans?from=${addDays(today, -13)}&to=${addDays(today, 1)}`);
  const mine = (plans ?? []).filter((p) => JSON.stringify(p.content ?? {}).includes(TAG));
  for (const p of mine) await j("DELETE", `/api/fitness/plans/${p.id}`).catch(() => {});
  const { goals } = await j("GET", "/api/fitness/goals");
  for (const g of (goals ?? []).filter((g) => g.title?.includes(TAG) && g.status === "active"))
    await j("PATCH", `/api/fitness/goals/${g.id}`, { status: "archived" }).catch(() => {});
  console.log(`[seed] 已删除计划 ×${mine.length}，活跃目标已归档`);
  process.exit(0);
}

const today = bjToday();
const monday = thisMonday(today);

// 1) 档案（upsert 幂等）
await j("PUT", "/api/fitness/profile", {
  heightCm: 172,
  weeklyDays: "每周 4 练（跑 2 力量 2）",
  experience: "中级（系统训练 2 年）",
  equipment: ["哑铃", "杠铃", "弹力带"],
  constraints: "左膝旧伤，深蹲避免大重量",
});
console.log("[seed] 档案 ✓");

// 2) 活跃目标（run 模块唯一；已有活跃目标则跳过）
try {
  await j("POST", "/api/fitness/goals", {
    moduleCode: "run",
    title: `10km 跑进 55 分 ${TAG}`,
    targetDate: addDays(today, 60),
    targets: { distanceKm: 10, paceSPerKm: 330 },
    strategy: { weekly: "1 间歇 + 1 长距离 + 1 轻松跑" },
  });
  console.log("[seed] 活跃目标 ✓");
} catch (e) {
  console.log(`[seed] 目标已存在（跳过）：${String(e).slice(0, 80)}`);
}

// 3) 身体指标：近 8 个周一（体重 72→69.6 递减，腰围 88→85）
for (let i = 7; i >= 0; i--) {
  const d = addDays(monday, -7 * i);
  const w = 72 - (7 - i) * 0.3;
  await j("POST", "/api/fitness/metrics", {
    measuredOn: d,
    weightKg: Math.round(w * 10) / 10,
    waistCm: Math.round((88 - (7 - i) * 0.5) * 10) / 10,
    bodyFatPct: Math.round((20 - (7 - i) * 0.2) * 10) / 10,
    heightCm: 172,
  });
}
console.log("[seed] 身体指标 ×8 ✓");

// 4) 睡眠：近 7 天（6.1~7.9h，含感受与得分）
const sleepSeed = [
  [7.2, "good", 86],
  [6.4, "ok", 74],
  [7.8, "good", 91],
  [6.1, "bad", 62],
  [6.9, "ok", 78],
  [7.5, "good", 88],
  [6.6, "ok", 80],
];
for (let i = 7; i >= 1; i--) {
  const [h, f, s] = sleepSeed[7 - i];
  await j("POST", "/api/fitness/sleep", { date: addDays(today, -i), hours: h, feeling: f, score: s });
}
console.log("[seed] 睡眠 ×7 ✓");

// 5) 计划：今日力量(draft) + 今日跑步(confirmed) + 明日跑步(draft) + 上周一/三(done 带实练)
const strength = {
  title: `下肢力量 ${TAG}A`,
  durationMin: 60,
  exercises: [
    { name: "杠铃深蹲", sets: 5, repsText: "8-10", weightG: 60000, rir: 2 },
    { name: "罗马尼亚硬拉", sets: 4, repsText: "10", weightG: 50000, rir: 3 },
    { name: "保加利亚分腿蹲", sets: 3, repsText: "12/边", weightG: 12000, rir: 2 },
    { name: "提踵", sets: 4, repsText: "15", weightG: 20000 },
  ],
  note: `${TAG} 左膝注意热身`,
};
const runToday = {
  workoutType: "interval",
  title: `间歇 6×800 ${TAG}B`,
  segments: [
    { label: "热身", distanceM: 2000, durationMin: 12, paceSPerKm: 375 },
    { label: "主课", distanceM: 4800, reps: 6, paceSPerKm: 320, hrZone: 4, note: "组间 400 慢跑" },
    { label: "放松", distanceM: 1200, durationMin: 8 },
  ],
  totalDistanceM: 8000,
  durationMin: 55,
  note: `${TAG} 配速按体感微调`,
};
const runTomorrow = {
  workoutType: "easy",
  title: `轻松跑 ${TAG}C`,
  segments: [{ label: "有氧", distanceM: 6000, durationMin: 42, paceSPerKm: 385, hrZone: 2 }],
  totalDistanceM: 6000,
  durationMin: 42,
};
const runLastMon = {
  workoutType: "tempo",
  title: `乳酸阈值跑 ${TAG}D`,
  segments: [
    { label: "热身", distanceM: 1500, durationMin: 9 },
    { label: "主课", distanceM: 5000, paceSPerKm: 330, hrZone: 3 },
    { label: "放松", distanceM: 1000, durationMin: 7 },
  ],
  totalDistanceM: 7500,
  durationMin: 42,
};
const strengthLastWed = {
  title: `上肢推拉 ${TAG}E`,
  durationMin: 55,
  exercises: [
    { name: "卧推", sets: 5, repsText: "8", weightG: 47500, rir: 2 },
    { name: "杠铃划船", sets: 4, repsText: "10", weightG: 40000, rir: 3 },
    { name: "肩推", sets: 3, repsText: "10", weightG: 25000 },
  ],
};

const mk = (planDate, moduleCode, content, source = "import") =>
  j("POST", "/api/fitness/plans", { planDate, moduleCode, source, content, rationale: null });

await mk(today, "strength", strength);
await mk(today, "run", runToday);
await mk(addDays(today, 1), "run", runTomorrow);

// 上周已完成两条：建后 PATCH done + actual（落执行记录）
for (const [d, mod, content, actual] of [
  [addDays(monday, 0), "run", runLastMon, { distanceM: 7600, durationS: 2520, paceSPerKm: 332, avgHr: 158 }],
  [addDays(monday, 2), "strength", strengthLastWed, { exercises: [
    { name: "卧推", sets: 5, repsText: "8", weightG: 47500 },
    { name: "杠铃划船", sets: 4, repsText: "10", weightG: 40000 },
    { name: "肩推", sets: 3, repsText: "10", weightG: 25000 },
  ] }],
]) {
  const { plan } = await mk(d, mod, content);
  await j("PATCH", `/api/fitness/plans/${plan.id}`, { status: "done", actual, fatigue: 6, soreness: "大腿前侧", note: "上周实练" });
}
console.log("[seed] 计划 ×5（今日 2 / 明日 1 / 上周已完成 2）✓");

// 输出运动空间地址供 GUI 测试
const { spaces } = await j("GET", "/api/spaces");
const sport = (spaces ?? []).find((s) => s.kind === "sport");
console.log(`[seed] 运动空间: ${BASE}/spaces/${sport?.id ?? "?"}?tab=fitness`);
