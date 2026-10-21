// 迁移补丁：未接 as 强转的 readJsonCapped 调用补 `as any`（保持原 req.json() 的 any 语义）
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

let changed = 0;
for (const f of files) {
  let s = fs.readFileSync(f, "utf-8");
  const before = s;
  // 只匹配后面不跟 ` as ` 的调用；已显式 `as {...}` 的（unknown → T）保持原样
  s = s.replace(/await readJsonCapped\(req\)(?!\s+as\b)/g, "await readJsonCapped(req) as any");
  s = s.replace(/await readJsonCapped\(req, 9 \* 1024 \* 1024\)(?!\s+as\b)/g, "await readJsonCapped(req, 9 * 1024 * 1024) as any");
  if (s !== before) {
    fs.writeFileSync(f, s);
    changed++;
  }
}
console.log("patched:", changed);
