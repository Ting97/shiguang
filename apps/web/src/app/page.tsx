const modules = [
  {
    icon: "⏱",
    title: "时间日记",
    status: "开发中 · P0",
    desc: "说一句话，AI 自动识别类别与起止时间，日历自动登记",
    color: "border-sky-500/30 bg-sky-500/5",
  },
  {
    icon: "💰",
    title: "财务复盘",
    status: "Phase 2",
    desc: "记录中的金额自动入账，CSV 导入，月度上限与储蓄率",
    color: "border-emerald-500/30 bg-emerald-500/5",
  },
  {
    icon: "👥",
    title: "人际图谱",
    status: "Phase 3",
    desc: "星型关系图，点开 TA 即见共同经历与喜好提炼",
    color: "border-pink-500/30 bg-pink-500/5",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-6 py-20">
        <header className="text-center">
          <p className="text-sm tracking-[0.5em] text-amber-300/80">SHIGUANGRI</p>
          <h1 className="mt-4 text-6xl font-bold">拾光日</h1>
          <p className="mt-4 text-lg text-slate-400">
            拾起光阴，记录今日 —— 个人经营系统：钱 · 时间 · 人
          </p>
          <p className="mt-2 text-sm text-slate-500">
            一句话，同时落进时间轴、财务账、人情簿
          </p>
        </header>

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {modules.map((m) => (
            <div key={m.title} className={`rounded-xl border p-6 backdrop-blur ${m.color}`}>
              <div className="text-3xl">{m.icon}</div>
              <h2 className="mt-3 text-xl font-semibold">{m.title}</h2>
              <p className="mt-1 text-xs text-slate-400">{m.status}</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{m.desc}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="text-sm font-semibold text-slate-300">Phase 0 · 进行中</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-400">
            <li>✅ Monorepo 脚手架（apps/web · packages/ai · packages/db）</li>
            <li>✅ 数据库 Schema v1（时间模块 8 表 + 联动草稿表）</li>
            <li>▶️ 语音/文字多域解析 PoC（20 句话术，验收 ≥85%）</li>
            <li>⏭ Supabase 本地环境 + Auth + 输入流页面</li>
          </ul>
        </section>

        <footer className="mt-12 text-center text-xs text-slate-600">
          github.com/Ting97/shiguangri · 需求方 + ZCode 协作开发
        </footer>
      </div>
    </main>
  );
}
