/**
 * PoC 运行器 —— 20 句测试集（docs/07）
 *   npm run poc        规则引擎（无需 API Key，验证管线与确定性部分）
 *   npm run poc:live   LLM 实测（需 .env 配 ZHIPUAI_API_KEY）
 * 通过线：≥85%（17/20）activity+duration+finance+people 全对
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseInput } from "./parse";
import { hasApiKey } from "./glm";

const here = dirname(fileURLToPath(import.meta.url));
const set = JSON.parse(readFileSync(join(here, "../testset/poc-20.json"), "utf8"));

// 固定"当前时间"保证可复现：2026-09-17 15:00（周四下午，话术中的时段都已过去）
const NOW = new Date("2026-09-17T15:00:00+08:00");
const live = !!process.env.ZHIPUAI_LIVE && hasApiKey();

const fmt = (iso: string) => {
  // 北京时间展示：UTC getter + 8h（getHours 等本地 getter 在非 CST 宿主会偏 8 小时）
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

interface Case {
  id: number; text: string; activity: string; durationMin?: number; period?: string;
  finance?: any; people?: string[]; future?: boolean;
  diet?: boolean; dietMeal?: string; noSchedule?: boolean; mood?: string;
  /** 期望时间块开始的北京日期（YYYY-MM-DD）：相对日解析（昨天/上周X/周X）回归用 */
  startDay?: string;
}

const durationTolerance = 15; // 分钟容差
const PASS_LINE = 85; // 通过线（%）：docs/07 评测口径，≥85%（17/20）达标
let pass = 0;
const rows: string[] = [];

for (const c of set.cases as Case[]) {
  let r;
  try {
    // dry-run（未加 ZHIPUAI_LIVE=1）必须强制规则引擎：parseInput 只看有无 Key，
    // 宿主环境恰好导出了 ZHIPUAI_API_KEY 时旧版会实际跑 LLM 白烧 token，评测对象错位
    r = await parseInput(c.text, { now: NOW, forceRules: !live });
  } catch (e) {
    // live 模式下单句 API 失败（如限流）不应中断整轮：记为该句失败
    rows.push(`❌ #${String(c.id).padStart(2)} ${c.text.slice(0, 14).padEnd(14, "　")} API失败: ${String(e).slice(0, 60)}`);
    continue;
  }
  const checks: Record<string, boolean> = { activity: r.activity === c.activity };

  if (c.future) {
    // 未来话术：应生成 TODO（mode=future、intent=todo），时长/金额不参与判定
    checks.todo = r.intent === "todo" && r.time.mode === "future";
  } else {
    if (c.noSchedule) {
      // 纯感想/非事件话术：不强制建日程
      checks.noSchedule = r.intent === "status" && !r.scheduleApplicable;
    } else if (c.durationMin !== undefined) {
      checks.duration = Math.abs(r.time.durationMin - c.durationMin) <= durationTolerance;
    }
    if (c.startDay !== undefined) {
      // 时间块开始日期（北京日历日）：验证相对日解析落对了天
      const bj = new Date(new Date(r.time.start).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
      checks.date = bj === c.startDay;
    }
    checks.finance = c.finance
      ? r.finance.hasAmount &&
        r.finance.amountCents === c.finance.amountCents &&
        (!c.finance.direction || r.finance.direction === c.finance.direction) &&
        (!c.finance.category || r.finance.category === c.finance.category)
      : !r.finance.hasAmount;
    checks.people =
      (c.people ?? []).length === r.people.length &&
      (c.people ?? []).every((n) => r.people.some((p) => p.name.includes(n)));
    if (c.diet !== undefined) {
      checks.diet = r.diet.applicable === c.diet && (!c.dietMeal || r.diet.meal === c.dietMeal);
    }
    if (c.mood !== undefined) {
      checks.mood = r.mood.label === c.mood;
    }
  }

  const ok = Object.values(checks).every(Boolean);
  if (ok) pass++;
  const why = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join("+");
  rows.push(
    `${ok ? "✅" : "❌"} #${String(c.id).padStart(2)} ${c.text.slice(0, 14).padEnd(14, "　")} ` +
    `act=${r.activity}(期望${c.activity}) ` +
    `${c.future ? `${r.intent === "todo" ? "→TODO" : "✗未识别为TODO"} due=${fmt(r.time.start)}` : `dur=${r.time.durationMin}(期望${c.durationMin}) `}` +
    `${!c.future && r.finance.hasAmount ? `金额${(r.finance.amountCents! / 100).toFixed(0)}元 ` : ""}` +
    `${!c.future && r.people.length ? `人:${r.people.map((p) => p.name).join(",")} ` : ""}` +
    `${why ? `← 不符:${why}` : ""}`
  );
}

console.log(`\n引擎：${live ? "GLM（实测）" : "规则引擎（dry-run，未配 Key 或未加 ZHIPUAI_LIVE=1）"}`);
console.log(rows.join("\n"));
const pct = ((pass / set.cases.length) * 100).toFixed(0);
const ok = Number(pct) >= PASS_LINE;
console.log(`\n结果：${pass}/${set.cases.length}（${pct}%）  通过线 ${PASS_LINE}% → ${ok ? "🎉 达标" : "未达标"}`);
// 未达标退出 1：CI/脚本据此判定评测失败（旧版恒 exit 0，未达标也绿灯）
process.exit(ok ? 0 : 1);
