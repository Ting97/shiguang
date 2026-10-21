/**
 * 深度体验(动态流模块)种子数据——打到本地 3100(AUTH_DISABLED=1, 测试库)。
 * 用后即弃:qa 脚本自清理约定见 scripts/qa/。运行: node scripts/qa/seed-feed-gui.mjs --wipe 清掉本脚本动态。
 * 造数策略:POST /api/parse 走真实五域识别(需 .env GLM key),等待 analyzed_at;
 * 附带 1 条图片动态(1x1 PNG)与 1 条语音动态(项目根 asr-probe.wav);
 * 低置信文本尝试触发 pending 待确认登记簿。
 */
/* global FormData, Blob */
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
const form = async (method, path, fd) => {
  const res = await fetch(BASE + path, { method, headers: { origin: BASE, "sec-fetch-site": "same-origin" }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
};

const wipe = process.argv.includes("--wipe");
if (wipe) {
  const feed = await j("GET", "/api/feed?limit=200");
  const mine = (feed.moments ?? []).filter((m) => m.raw_text?.includes("[feed-gui]"));
  // DELETE /api/feed/[id]（旧版误写 /api/entries/:id → 404 被吞还报成功，测试数据只进不出）
  let ok = 0;
  for (const m of mine) {
    try {
      await j("DELETE", `/api/feed/${m.id}`);
      ok++;
    } catch {
      /* 单条失败继续删其余 */
    }
  }
  console.log(`[seed] 已删除本脚本动态 ×${ok}/${mine.length}`);
  process.exit(0);
}

const TAG = "[feed-gui]";
// 文案带 TAG 便于 wipe 识别;真实语义让 AI 识别有的放矢
const texts = [
  "中午和老王吃饭花了260，吃得挺开心 " + TAG + " 全域",
  "明天下午三点看牙医记得带医保卡 " + TAG + " 待办",
  "早上7点半到8点跑步5公里，出了很多汗 " + TAG + " 运动",
  "下午写了两个小时的项目周报 " + TAG + " 工作",
  "买了杯瑞幸生椰拿铁 19.9 " + TAG + " 小额",
  "晚上和女朋友吵架了，心情有点低落 " + TAG + " 心情",
  "带儿子去动物园玩了一上午，门票120 " + TAG + " 亲子",
  "读《置身事内》第三章一小时，税制部分有点难懂 " + TAG + " 阅读",
  "给妈转了2000块生活费 " + TAG + " 转账",
  "下午三点和客户开会聊了一小时合作方案 " + TAG + " 会议",
  "大概花了点钱买了些东西，记不清多少 " + TAG + " 模糊",
  "加班到晚上十点，改需求文档 " + TAG + " 加班",
  "周末爬香山，来回路费40 " + TAG + " 出行",
  "看电影《沙丘3》花了80，特效不错 " + TAG + " 娱乐",
];

const ids = [];
for (const text of texts) {
  const { entry } = await j("POST", "/api/parse", { text, source: "keyboard" });
  ids.push(entry.id);
  console.log(`[seed] 动态 ${ids.length}/${texts.length} → ${entry.id}`);
}

// 图片动态:1x1 红色 PNG(formData 字段 files,多文件)
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
await form("POST", `/api/entries/${ids[0]}/images`, (() => {
  const fd = new FormData();
  fd.append("files", new Blob([png], { type: "image/png" }), "seed.png");
  return fd;
})());
console.log("[seed] 图片动态 →", ids[0]);

// 语音动态:挂项目根 asr-probe.wav(若存在)
try {
  const wav = await import("node:fs/promises").then((fs) => fs.readFile("D:/project/shiguang/asr-probe.wav"));
  await form("POST", `/api/entries/${ids[1]}/audio`, (() => {
    const fd = new FormData();
    fd.append("file", new Blob([wav], { type: "audio/wav" }), "seed.wav");
    return fd;
  })());
  console.log("[seed] 语音动态 →", ids[1]);
} catch (e) {
  console.log("[seed] 语音动态跳过:", String(e).slice(0, 120));
}

// 等待后台五域识别完成(最长 120s)
console.log("[seed] 等待识别…");
let analyzed = 0;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const feed = await j("GET", `/api/feed?limit=50`);
  const mine = (feed.moments ?? []).filter((m) => m.raw_text?.includes(TAG));
  analyzed = mine.filter((m) => m.analyzed_at).length;
  const pending = mine.reduce((s, m) => s + Object.values(m.recognitions ?? {}).filter((r) => r.status === "pending").length, 0);
  if (i % 5 === 0) console.log(`[seed] t+${(i + 1) * 2}s 已识别 ${analyzed}/${mine.length} pending=${pending}`);
  if (analyzed >= mine.length) break;
}
console.log(`[seed] 完成:识别 ${analyzed}/${texts.length}`);
