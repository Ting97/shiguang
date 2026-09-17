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
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface Case { id: number; text: string; activity: string; durationMin?: number; period?: string; finance?: any; people?: string[]; future?: boolean }

const durationTolerance = 15; // 分钟容差
let pass = 0;
const rows: string[] = [];

for (const c of set.cases as Case[]) {
  let r;
  try {
    r = await parseInput(c.text, { now: NOW });
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
    checks.duration =
      Math.abs(r.time.durationMin - (c.durationMin as number)) <= durationTolerance;
    checks.finance = c.finance
      ? r.finance.hasAmount &&
        r.finance.amountCents === c.finance.amountCents &&
        (!c.finance.category || r.finance.category === c.finance.category)
      : !r.finance.hasAmount;
    checks.people =
      (c.people ?? []).length === r.people.length &&
      (c.people ?? []).every((n) => r.people.some((p) => p.name.includes(n)));
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
console.log(`\n结果：${pass}/${set.cases.length}（${pct}%）  通过线 85% → ${Number(pct) >= 85 ? "🎉 达标" : "未达标"}`);
process.exit(0);
