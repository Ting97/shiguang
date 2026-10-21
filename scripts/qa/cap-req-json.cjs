// 一次性迁移脚本：把 api 路由裸 req.json() 收口到 readJsonCapped（本轮检视加固，跑完可删）
const fs = require("fs");
const path = require("path");

const root = "apps/api/src/app/api";
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === "route.ts") files.push(p.split(path.sep).join("/"));
  }
})(root);

// 特殊体量：文件 → 调用表达式（默认 1MB 不传第二参）
const customCap = new Map([
  ["apps/api/src/app/api/transactions/import/route.ts", "readJsonCapped(req, 9 * 1024 * 1024)"],
]);

let changed = 0;
for (const f of files) {
  let s = fs.readFileSync(f, "utf-8");
  if (!s.includes("await req.json()")) continue;
  const replacement = customCap.get(f) ?? "readJsonCapped(req)";
  const before = s;
  // .catch(() => ({})) 冗余一并去掉：readJsonCapped 解析失败回 {}
  s = s.split("(await req.json().catch(() => ({})))").join(`(await ${replacement})`);
  s = s.split("await req.json().catch(() => ({}))").join(`await ${replacement}`);
  s = s.split("(await req.json())").join(`(await ${replacement})`);
  s = s.split("await req.json()").join(`await ${replacement}`);
  if (s === before) continue;
  // 确保 import：优先并入既有 @/server/platform/http/route 导入
  const importRe = /import\s*\{([^}]*)\}\s*from\s*"@\/server\/platform\/http\/route";/;
  const m = s.match(importRe);
  if (m) {
    const names = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    if (!names.includes("readJsonCapped")) {
      names.push("readJsonCapped");
      s = s.replace(importRe, `import { ${names.join(", ")} } from "@/server/platform/http/route";`);
    }
  } else {
    const fn = replacement.split("(")[0];
    const firstImport = s.match(/^import[^\n]*\n/m);
    s = s.slice(0, firstImport.index) + `import { ${fn} } from "@/server/platform/http/route";\n` + s.slice(firstImport.index);
  }
  fs.writeFileSync(f, s);
  changed++;
  console.log("patched", f);
}
console.log("total changed:", changed);
