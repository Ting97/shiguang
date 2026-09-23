/**
 * Jev PoC 对照评测（REQ-003 3-B / FR-B1 前置门）
 *   npm run poc:jev          Jev 问题组 vs GLM 基线（基线缓存 testset/poc-glm-baseline.json）
 *   npm run poc:jev:live     强制重跑 GLM 基线（消耗 GLM token，46 次调用）
 *
 * 评分口径（两引擎完全一致，仅闭集字段；开放词汇如人名/标题不参评——Jev 硬限制不能生成）：
 *   schedule/todo/finance/mood/diet/people 六域适用性（noul）
 *   activity（choice，仅日程适用句）/ record_type / period（期望为 now 的句跳过）
 *   fin_direction / fin_category（仅财务适用句）/ diet_meal（仅饮食适用句）
 * 达标线（01 §8 FR-B1）：闭集整体准确率 ≥ GLM × 95%，且 activity 单独 ≥ 80%。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseInput } from "./parse";
import { GLM_DEFAULT_MODEL, hasApiKey } from "./glm";
import { jevAsk, qChoice, qNoul, type JevQuestions } from "./jev";

const here = dirname(fileURLToPath(import.meta.url));
const set = JSON.parse(readFileSync(join(here, "../testset/poc-20.json"), "utf8"));
const BASELINE_FILE = join(here, "../testset/poc-glm-baseline.json");
const glmLive = process.argv.includes("--glm-live");

// 固定"当前时间"保证可复现（与 run-poc.ts 一致）
const NOW = new Date("2026-09-17T15:00:00+08:00");
const NOW_LABEL = "2026-09-17 15:00（周四，北京时间）";

interface Case {
  id: number; text: string; activity: string; durationMin?: number; period?: string;
  finance?: { amountCents: number; direction: string; category?: string } | null;
  people?: string[]; future?: boolean; diet?: boolean; dietMeal?: string;
  noSchedule?: boolean; mood?: string; startDay?: string;
}

/** Jev 问题组（02 §7.2）：一次调用并行评估全部闭集问题 */
function questionsFor(_text: string): JevQuestions {
  return {
    sched_applicable: qNoul("这句话记录了一个已经发生或正在进行的、有具体内容的事件或活动（不是纯感想，不是未来计划，也不只是吃喝）"),
    todo_applicable: qNoul("这句话表达了一个计划要做、还没发生的事情"),
    fin_applicable: qNoul("这句话包含有具体金额的花钱或收钱行为"),
    mood_applicable: qNoul("这句话表达了说话者的情绪或心情（情绪可能藏在动作里）"),
    diet_applicable: qNoul("这句话提到吃了或喝了具体的食物或饮品（喝白开水不算）"),
    people_applicable: qNoul("这句话提到了具体的人（称谓也算，比如爸妈、小陈、张老师）"),
    activity: qChoice("如果这句话在记录一个活动，它最接近哪一类？", {
      sleep: "睡眠：睡觉、午睡、赖床补觉",
      work: "工作：开会、写周报、处理邮件、见客户、上班",
      study: "学习：看书、学英语、上课、刷题",
      fitness: "健身：跑步、撸铁、球类、瑜伽、散步锻炼",
      social: "社交：与亲友同事吃饭聊天通话、随礼帮忙",
      fun: "娱乐：刷抖音、看电影、玩游戏、逛街",
      chores: "家务：做饭、打扫、买菜、洗衣",
      commute: "通勤：上下班路上、打车地铁",
      other: "以上皆非",
    }),
    record_type: qChoice("这句话描述的是已经发生的事，还是计划要做的事？", {
      past: "已经发生或正在发生的事",
      future: "计划/将要发生的事",
    }),
    period: qChoice("这件事大致发生在什么时段？", {
      now: "当下、刚刚",
      morning: "早晨/上午",
      noon: "中午",
      afternoon: "下午",
      evening: "傍晚/晚上",
      night: "夜里",
      lateNight: "凌晨",
    }),
    fin_direction: qChoice("如果这句话涉及钱，是花钱还是收钱？", { out: "花钱/支出", income: "收钱/收入" }),
    fin_category: qChoice("如果这句话涉及钱，最接近哪个分类？", {
      餐饮: "吃饭、饮品、外卖",
      交通: "打车、地铁、公交、加油",
      人情往来: "随礼、份子钱、送礼",
      学习: "课程、书籍、培训",
      购物: "购买商品",
      娱乐: "娱乐消费",
      其他: "其他支出",
    }),
    diet_meal: qChoice("如果吃了或喝了东西，最接近哪一餐？", {
      早餐: "早餐", 午餐: "午餐", 晚餐: "晚餐", 加餐: "下午茶、零食", 夜宵: "深夜进食", 未知: "说不清",
    }),
  };
}

// ---------- 期望值推导（两引擎同一把尺） ----------
// 日程适用：纯感想/未来计划不算事件；吃喝事件带时间也算事件（实测 GLM 对饮食句同样判适用——
// 与产品落库行为一致，因此饮食句期望为 true，只有 noSchedule/future 才为 false）
const expectSched = (c: Case) => !(c.noSchedule || c.future);
// GLM 侧 period 从时间块开始钟点推导（time.start 为本地时刻串，getHours 即北京钟点，勿重复加 8h）
const hourBucket = (iso: string): string => {
  const h = new Date(iso).getHours();
  if (h <= 5) return "lateNight";
  if (h <= 9) return "morning";
  if (h <= 12) return "noon";
  if (h <= 16) return "afternoon";
  if (h <= 20) return "evening";
  return "night";
};

type Field = string;
const jevScore: Record<Field, { n: number; ok: number }> = {};
const glmScore: Record<Field, { n: number; ok: number }> = {};
const bump = (table: Record<Field, { n: number; ok: number }>, f: Field, okv: boolean) => {
  table[f] ??= { n: 0, ok: 0 };
  table[f].n++;
  if (okv) table[f].ok++;
};
const divergences: string[] = [];

function grade(
  c: Case,
  engine: "jev" | "glm",
  a: {
    sched: boolean; todo: boolean; fin: boolean; mood: boolean; diet: boolean; people: boolean;
    activity: string | null; recordType: "past" | "future"; period: string | null;
    finDirection: string | null; finCategory: string | null; dietMeal: string | null;
  },
) {
  const bumpT = (f: Field, okv: boolean) => bump(engine === "jev" ? jevScore : glmScore, f, okv);
  const note = (f: Field, got: unknown, want: unknown) => {
    if (engine === "jev") {
      divergences.push(`| ${c.id} | ${c.text.slice(0, 22)} | ${f} | ${JSON.stringify(got)} | ${JSON.stringify(want)} |`);
    }
  };
  const g = (f: Field, got: unknown, want: unknown) => {
    const okv = got === want;
    bumpT(f, okv);
    if (!okv) note(f, got, want);
    return okv;
  };

  g("schedule适用", a.sched, expectSched(c));
  g("todo适用", a.todo, !!c.future);
  g("财务适用", a.fin, c.finance != null);
  g("心情适用", a.mood, c.mood !== undefined);
  if (c.diet !== undefined) g("饮食适用", a.diet, c.diet);
  g("人物适用", a.people, (c.people ?? []).length > 0);
  if (expectSched(c)) {
    g("activity", a.activity, c.activity);
    if (c.period !== undefined && c.period !== "now") g("period", a.period, c.period);
  }
  if (c.finance) {
    g("fin_direction", a.finDirection, c.finance.direction);
    if (c.finance.category) g("fin_category", a.finCategory, c.finance.category);
  }
  if (c.dietMeal) g("diet_meal", a.dietMeal, c.dietMeal);
  g("record_type", a.recordType, c.future ? "future" : "past");
}

// ---------- 主流程 ----------
async function main() {
  const cases = set.cases as Case[];

  // ---- GLM 基线（缓存复用，--glm-live 强制重跑）----
  let glm: Record<number, any> = {};
  // 同场景耗时对照：Jev 单次并行答 13 题闭集 vs GLM 单次五域全量抽取
  const jevMs: Record<number, number> = {};
  let glmMs: Record<number, number> = {};
  if (!glmLive && existsSync(BASELINE_FILE)) {
    glm = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    glmMs = Object.fromEntries(Object.entries(glm).map(([k, v]: [string, any]) => [k, v.ms ?? 0]));
    console.log(`GLM 基线：复用缓存（${Object.keys(glm).length} 句）\n`);
  } else {
    if (!hasApiKey()) {
      console.error("GLM 基线需要 ZHIPUAI_API_KEY（--glm-live）");
      process.exit(1);
    }
    console.log("GLM 基线：live 重跑（46 次调用）…");
    for (const c of cases) {
      try {
        const t0 = Date.now();
        const r = await parseInput(c.text, { now: NOW });
        glmMs[c.id] = Date.now() - t0;
        glm[c.id] = {
          sched: r.scheduleApplicable && r.intent === "schedule",
          todo: r.intent === "todo",
          fin: r.finance.hasAmount,
          mood: !!r.mood.label,
          diet: r.diet.applicable,
          people: r.people.length > 0,
          activity: r.activity,
          recordType: r.intent === "todo" ? "future" : "past",
          period: r.time?.start ? hourBucket(r.time.start) : null,
          finDirection: r.finance.direction ?? null,
          finCategory: r.finance.category ?? null,
          dietMeal: r.diet.meal ?? null,
          ms: glmMs[c.id],
        };
      } catch (e) {
        console.warn(`  GLM #${c.id} 失败：${String(e).slice(0, 80)}`);
      }
    }
    writeFileSync(BASELINE_FILE, JSON.stringify(glm, null, 1));
    console.log(`GLM 基线完成（${Object.keys(glm).length} 句），已缓存到 testset/poc-glm-baseline.json\n`);
  }

  // ---- Jev 问题组逐句调用 ----
  console.log("Jev：46 句 × 1 次并行调用 …");
  const jevRaw: Record<number, any> = {};
  for (const c of cases) {
    const state = `用户随口记录了一句话（当前时间：${NOW_LABEL}）：\n「${c.text}」`;
    try {
      const t0 = Date.now();
      const res = await jevAsk(state, questionsFor(c.text));
      jevMs[c.id] = Date.now() - t0;
      jevRaw[c.id] = { answers: res.answers, model: res.model };
      process.stdout.write(`  #${c.id} ✓\n`);
    } catch (e) {
      process.stdout.write(`  #${c.id} ✗ ${String(e).slice(0, 100)}\n`);
    }
  }
  const jevOkCount = Object.keys(jevRaw).length;
  console.log(`Jev 完成：${jevOkCount}/${cases.length}\n`);

  // ---- 统一评分 ----
  for (const c of cases) {
    const g = glm[c.id];
    if (g) grade(c, "glm", g);
    const j = jevRaw[c.id];
    if (!j) continue;
    const A = (k: string) => j.answers[k]?.value ?? null;
    grade(c, "jev", {
      sched: A("sched_applicable") === true,
      todo: A("todo_applicable") === true,
      fin: A("fin_applicable") === true,
      mood: A("mood_applicable") === true,
      diet: A("diet_applicable") === true,
      people: A("people_applicable") === true,
      activity: typeof A("activity") === "string" ? (A("activity") as string) : null,
      recordType: A("record_type") === "future" ? "future" : A("record_type") === "past" ? "past" : (null as never),
      period: typeof A("period") === "string" ? (A("period") as string) : null,
      finDirection: A("fin_direction") === "income" ? "in" : A("fin_direction"),
      finCategory: typeof A("fin_category") === "string" ? (A("fin_category") as string) : null,
      dietMeal: typeof A("diet_meal") === "string" ? (A("diet_meal") as string) : null,
    });
  }

  // ---- 汇总与判定 ----
  const total = (t: Record<Field, { n: number; ok: number }>) => {
    let n = 0, okc = 0;
    for (const v of Object.values(t)) { n += v.n; okc += v.ok; }
    return { n, ok: okc, pct: n ? okc / n : 0 };
  };
  const gT = total(glmScore);
  const jT = total(jevScore);
  const actJ = jevScore["activity"] ?? { n: 0, ok: 0 };
  const _actG = glmScore["activity"] ?? { n: 0, ok: 0 };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const passOverall = gT.n > 0 && jT.pct >= gT.pct * 0.95;
  const passActivity = actJ.n > 0 && actJ.ok / actJ.n >= 0.8;
  const verdict = passOverall && passActivity ? "✅ 达标（可进入 shadow）" : "❌ 未达标（止步归档）";

  // ---- 耗时统计（ms：avg / P50 / P95 / min / max）----
  const stats = (ms: Record<number, number>) => {
    const arr = Object.values(ms).filter((x) => x > 0).sort((a, b) => a - b);
    if (!arr.length) return null;
    const q = (p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
    const sum = arr.reduce((a, b) => a + b, 0);
    return { n: arr.length, avg: Math.round(sum / arr.length), p50: q(0.5), p95: q(0.95), min: arr[0], max: arr[arr.length - 1], total: sum };
  };
  const gMs = stats(glmMs);
  const jMs = stats(jevMs);
  const msRow = (label: string, s: ReturnType<typeof stats>) =>
    s ? `| ${label} | ${s.avg} | ${s.p50} | ${s.p95} | ${s.min} | ${s.max} | ${s.total} |` : `| ${label} | —（缓存无耗时数据，--glm-live 重跑获取） | — | — | — | — | — |`;
  const speedup = gMs && jMs && jMs.avg > 0 ? (gMs.avg / jMs.avg).toFixed(0) : null;

  const fieldRows = [...new Set([...Object.keys(glmScore), ...Object.keys(jevScore)])]
    .map((f) => {
      const g = glmScore[f] ?? { n: 0, ok: 0 };
      const j = jevScore[f] ?? { n: 0, ok: 0 };
      return `| ${f} | ${j.ok}/${j.n}（${pct(j.n ? j.ok / j.n : 0)}） | ${g.ok}/${g.n}（${pct(g.n ? g.ok / g.n : 0)}） |`;
    })
    .join("\n");

  const report = `# Jev PoC 对照评测报告（REQ-003 3-B）

| 项 | 值 |
|---|---|
| 日期 | ${new Date().toISOString().slice(0, 10)} |
| 测试集 | packages/ai/testset/poc-20.json（${cases.length} 句真实记录） |
| 模型 | Jev：${process.env.JEV_MODEL ?? "jev-latest"}；GLM：${process.env.GLM_MODEL ?? GLM_DEFAULT_MODEL} |
| 固定当前时间 | ${NOW_LABEL}（与 poc:live 同基准） |
| Jev 响应 | ${jevOkCount}/${cases.length} 句成功 |
| 评分口径 | 闭集字段两引擎同尺；开放词汇（人名/标题）不参评 |

## 达标判定（FR-B1）

| 指标 | 阈值 | 实测 | 判定 |
|---|---|---|---|
| 闭集整体准确率（Jev） | ≥ GLM × 95% | ${pct(jT.pct)} vs GLM ${pct(gT.pct)}（门槛 ${pct(gT.pct * 0.95)}，${jT.ok}/${jT.n} 对 ${gT.ok}/${gT.n}） | ${passOverall ? "✅" : "❌"} |
| activity 单独准确率 | ≥ 80% | ${pct(actJ.n ? actJ.ok / actJ.n : 0)}（${actJ.ok}/${actJ.n}） | ${passActivity ? "✅" : "❌"} |
| **结论** | | | **${verdict}** |

## 分字段对照

| 字段 | Jev | GLM |
|---|---|---|
${fieldRows}

## 调用耗时对照（同 46 句，各自单次调用，毫秒）

Jev = 单次并行回答 13 个闭集问题；GLM = 单次五域全量抽取（含 JSON 生成）。生产同场景下两种调用是互替的。

| 引擎 | 平均 | P50 | P95 | 最小 | 最大 | 总耗时 |
|---|---|---|---|---|---|---|
${msRow("Jev（jev-latest）", jMs)}
${msRow("GLM（五域抽取）", gMs)}

${speedup ? `**同场景平均耗时比：GLM ≈ Jev 的 ${speedup} 倍。**` : ""}

## 分歧样本（Jev 答错的字段，前 ${Math.min(divergences.length, 40)} 条）

| # | 句子 | 字段 | Jev 答案 | 期望 |
|---|---|---|---|---|
${divergences.slice(0, 40).join("\n")}
`;

  const outPath = join(here, "../../../docs/requirements/003-综合迭代/04-Jev-PoC报告.md");
  writeFileSync(outPath, report, "utf8");
  console.log("\n" + report.split("\n").slice(0, 22).join("\n"));
  console.log(`\n报告已写入：${outPath}`);
  process.exit(0);
}

await main();
