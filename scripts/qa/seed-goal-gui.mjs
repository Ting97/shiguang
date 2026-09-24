/**
 * 深度体验(目标主线·空间/待办)种子数据——打到本地 3100(AUTH_DISABLED=1, 开发库)。
 * 用后即弃:运行 node scripts/qa/seed-goal-gui.mjs --wipe 可清掉本脚本数据（按「QA·」前缀识别）。
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

const wipe = process.argv.includes("--wipe");
if (wipe) {
  const { spaces } = await j("GET", "/api/spaces");
  for (const s of spaces ?? []) {
    if (!s.name.startsWith("QA·")) continue;
    const detail = await j("GET", `/api/spaces/${s.id}`).catch(() => null);
    // 解除 todo 归属后再删空间（空间删除会一并删感悟，todo 仅解除归属）
    const todos = detail?.todos ?? [];
    for (const t of todos) await j("PATCH", `/api/todos/${t.id}`, { spaceId: null }).catch(() => {});
    await j("DELETE", `/api/spaces/${s.id}`).catch(() => {});
  }
  const { todos: all } = await j("GET", "/api/todos?view=all");
  for (const t of all ?? []) if (t.title.startsWith("QA·")) await j("DELETE", `/api/todos/${t.id}`).catch(() => {});
  console.log("[seed] 已清理 QA· 空间与待办");
  process.exit(0);
}

const day = (offset, hm = "12:00") => {
  const d = new Date(Date.now() + offset * 86_400_000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${hm}:00+08:00`;
};

// 1. 空间 ×3
const mk = await j("POST", "/api/spaces", {
  name: "QA·深蹲突破100kg",
  description: "力量训练主线：从 60kg 线性进阶到 100kg",
  icon: "🏋️",
  color: "#f43f5e",
  startedAt: day(0).slice(0, 10),
  targetDate: day(90).slice(0, 10),
});
const study = await j("POST", "/api/spaces", {
  name: "QA·日语N2备考",
  description: "12 月考试，每天一课",
  icon: "📗",
  color: "#0ea5e9",
  startedAt: day(-30).slice(0, 10),
});
const archived = await j("POST", "/api/spaces", {
  name: "QA·已归档旧目标",
  description: "2025 年的旧目标",
  icon: "📦",
});
await j("PATCH", `/api/spaces/${archived.space.id}`, { status: "archived" });

// 2. 待办/行动
const t1 = await j("POST", "/api/todos", { title: "QA·完成第 3 单元语法", spaceId: study.space.id, dueAt: day(1, "20:00") });
await j("POST", "/api/todos", { title: "QA·背核心 1500 词（重要）", spaceId: study.space.id, important: true });
await j("POST", "/api/todos", { title: "QA·做一套真题", spaceId: study.space.id, today: true });
await j("POST", "/api/todos", { title: "QA·精听第 3 课", parentId: t1.todo.id });
await j("POST", "/api/todos", { title: "QA·语法错题本整理", parentId: t1.todo.id });
// 未关联空间的 todo（「关联已有」浮层测试用）
await j("POST", "/api/todos", { title: "QA·无主 todo 甲" });
await j("POST", "/api/todos", { title: "QA·无主 todo 乙" });
// 每日重复行动（深蹲空间）
const sq = await j("POST", "/api/todos", { title: "QA·深蹲训练日", spaceId: mk.space.id });
await j("POST", "/api/todos", { title: "QA·5×5 深蹲 60kg", parentId: sq.todo.id, repeatDaily: true });

// 3. 感悟 ×2
await j("POST", `/api/spaces/${study.space.id}/reflections`, {
  content: "第一周打卡完成。发现听力是短板，真题精听比泛听有效——明天开始每天 30 分钟精听。",
});
await j("POST", `/api/spaces/${study.space.id}/reflections`, {
  content: "词汇量测了 4200，距离 N2 要求还差 800。把通勤时间用来过词书。",
});

console.log(`[seed] 完成：空间 ×3（${mk.space.id.slice(0, 8)}… 主空间）、待办 ${7} 条、感悟 ×2`);
