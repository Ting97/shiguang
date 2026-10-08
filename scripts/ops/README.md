# 运维脚本与可重建资产（REQ-009 FR-F3）

目标：**服务器整台损坏时，仅凭本仓库 + 最新备份即可重建全部运行态**。

## 资产清单

| 文件 | 生产位置 | 说明 |
|---|---|---|
| `backup.sh` | `/opt/shiguangri_repo/scripts/ops/backup.sh` | pg_dump + uploads tar，保留 7 份；crontab 每日 03:30 |
| `restore.sh` | 同上 | 恢复演练/灾难恢复：恢复前自动兜底备份当前态 |
| `shiguangri.service` | `/etc/systemd/system/shiguangri.service` | systemd 单元模板（改动两边同步） |
| `Caddyfile` | `/etc/caddy/Caddyfile` | 反代模板（Caddy 自动 HTTPS） |
| `../deploy.mjs` | 本地执行 | 发布：备份快照 → 迁移 → 双 tar → 原子交换 → 冒烟 → 失败自动回滚 |

## 备份策略

- crontab（服务器）：`30 3 * * * /opt/shiguangri_repo/scripts/ops/backup.sh >> /var/log/shiguangri-backup.log 2>&1`
- 发布时 deploy.mjs 会在迁移前额外做一次 pg_dump 快照（`/opt/shiguangri_backups/db-*.dump`）
- 保留 7 份；建议异地同步（如 `rclone copy /opt/shiguangri_backups remote:shiguang-backups`，未配置前属已知缺口）

## trade → shiguang 负债 + 备付镜像同步（每日 06:10）

- `sync-debt-from-trade.mjs` 四件事：
  1. 负债余额：读 trade 资产模块快照（asset_snapshots_v1，你在「资产负债记账」页录入）按编码更新账户 15091587905 的负债余额（只改余额）
  2. **备付镜像**：读 `/opt/aitrade/资产/{data.js,备付核心.js}` 复刻 trade「每月备付追踪」的需还矩阵（静态 RULES + asset_loans_config_v1 用户覆盖/自定义负债），按银行合并出每月月供/到期本金/当月需还，连同账户剩余写入 `trade_reserve_banks`（2026-09~2033-09 全量重建）——备付页与 trade 逐行同源
  3. 储蓄账户：reserve 键 − 还款银行名（非 0）→ debt_reserve_sources
  4. 备付计划金额：reserve 银行行 → debt_reserve_checks.planned_cents（历史口径保留）
- **trade 侧改了需还矩阵（备付核心.js 的 RULES）后无需任何操作**：同步每日直接读服务器上的最新文件；TRADE_HOME 环境变量可覆盖 trade 目录
- 编码→负债映射：`/opt/shiguangri_repo/scripts/trade-debt-mapping.json`（自动建档自学习写回；手工调整直接改此文件）
- 未映射编码每次运行打印提醒；已建档负债：B3=中信银行信用卡、B4=招商银行信用卡B4、B5=中信银行信用卡B5、B6=招商银行信用卡B6、C5=工商银行C5、F1=网商银行F1、B1=华夏银行（名称来自 D:\ai\trade\资产\data.js 编码表）
- 手动跑：`cd /opt/shiguangri_repo && node scripts/ops/sync-debt-from-trade.mjs`（--dry 预览；脚本实际位于 scripts/ops/）

## 恢复演练（每季度跑一次）

```bash
# 1. 找最新备份
ls -1t /opt/shiguangri_backups/db-*.dump | head -1
# 2. 恢复（脚本会先兜底备份当前态）
sudo ./restore.sh <dump 路径> <uploads tar 路径>
# 3. 验证 health 与登录
curl -s https://shiguang.ting97.cn/api/health
```

## 整机重建顺序（新机器）

1. CentOS + PostgreSQL 13 + Caddy + Node 20 安装
2. `git clone` 仓库到 `/opt/shiguangri_repo`；还原最新备份到库与上传目录
3. 拷贝 `shiguangri.service` → `systemctl enable --now shiguangri`；拷贝 `Caddyfile` → `systemctl reload caddy`
4. `.env` 从密码管理器还原（含 DATABASE_URL/ZHIPUAI_API_KEY/JEV/短信/SMTP）
5. `node scripts/deploy.mjs` 走一次标准发布校验全链路

## 迁移前置依赖（一次性）

- **045-entries-search-trgm.sql 需要 pg_trgm 扩展**（postgresql-contrib 包）。生产已在 2026-10-08 前装好并执行；
  全新环境重建时需先 `yum install postgresqlXX-contrib && systemctl restart postgresql`，否则该迁移 fail-fast 挡发布
  （039 迁移因缺 contrib 放弃了 btree_gist EXCLUDE 约束——同一前提）。
