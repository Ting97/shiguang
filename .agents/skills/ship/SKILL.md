---
name: ship
description: 拾光批次交付流程：开发完成后充分测试（真库全量单测+lint+typecheck）→ 合并推送远程 main → 生产部署（deploy.mjs 自动备份/迁移/冒烟）→ 补录 03 部署文档。凡用户说「部署」「发布」「上线」「提交远程」「推送 main」「走交付流程」「收尾这一批」，或某批次开发/修复完成准备送线上时使用——即使没说「部署」二字，只要意图是把已完成的工作送上线就触发本 skill。
---

# 拾光批次交付（ship）

把一批已完成开发的改动送上线并闭环。四个阶段必须依次走完，任何一步红了就停下修复，禁止跳步或「先上了再说」。

## 第 0 步：前置检查

- `git status`：工作区必须干净（有未提交改动就先完成本批提交；无关的脏文件问用户）。
- 确认用户说的「这一批」包含哪些改动（本会话内做完的功能/修复），漏提交的先补。
- Android 壳（apps/android）改动**不在**本流程内：APK 由 Windows 机构建（`./gradlew assembleRelease`），提醒用户出包即可。

## 第 1 步：充分测试

```bash
npm run lint        # 0 error，warning 数不新增
npm run typecheck   # 三端全绿
```

真库单测（需要 PostgreSQL；Mac 本机无 PG，用隧道脚本，仓库根执行）：

```bash
source .agents/skills/ship/scripts/with-test-db.sh
npm test
```

**判定标准（不是全绿就收）：**

- 结果必须是「全绿」或「恰好 2 个已知基线存量失败」：`finance：备付清单计算（R3）` 和 `timeline-fix：appendManual`。这两个是 016 起记录的宿主环境存量，与本批无关。
- 出现**任何其他**失败 = 本批引入，停下排查修复，不许带着过。
- 真库用例整组 skip（隧道没通）不算测试通过——必须看到 pass 数。

## 第 2 步：合并推送远程 main

```bash
git checkout main && git merge --no-ff feat/<批次分支> -m "Merge branch '<批次分支>'：<一句话>"
git push origin main
```

- 没开分支的小改动可直接在 main 提交推送，但功能批次一律走分支合并（保留批次边界）。
- 提交信息规范见既有 log：`feat(domain): …` / `fix(domain): …` / `docs(batch): …`，正文说清动机与关键决策。

## 第 3 步：部署生产

```bash
kill $(lsof -ti:3100) 2>/dev/null   # 3100 占用会卡死构建（Windows 文件锁）
node scripts/deploy.mjs             # 自动：构建 → pg_dump 备份 → 服务器侧迁移 → 双 tar 原子交换 → 冒烟
```

- **Mac 注意**：node 在 `~/.local/node/bin`，不在默认 PATH（`export PATH="$HOME/.local/node/bin:$PATH"`）。
- 脚本自带失败自动回滚；冒烟失败会回滚旧版并报错，此时排查后重跑，不要手动绕过。
- 新迁移会随脚本在服务器侧执行；**迁移未在生产执行前，不得发布依赖新表的代码路径**（本脚本顺序已保证：先迁移后交换）。

## 第 4 步：验证与文档闭环

1. 追加冒烟（按批次挑重点）：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://shiguang.ting97.cn/api/<本批新端点>   # 未登录应 401
   ```
   涉新表/新行为：ssh 上生产库 `select` 确认表已建/数据落对（只读）。
2. 补录本批 `docs/requirements/<批次>/03-测试与部署.md`：测试结果表（含基线失败说明）+ 部署记录（commit、迁移号、冒烟结果、用户操作路径）；新批次补 `README.md` 索引行并把状态改「已部署」。
3. 提交并推送文档（`docs(batch): 补录部署记录…`）。

## 收尾汇报

向用户汇报一张小表：测试（pass/skip/基线失败）、推送（commit 号）、部署（迁移执行、冒烟）、文档；并列出用户侧待办（如 Android 出包、实机验证点）。
