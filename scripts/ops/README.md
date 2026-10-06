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

## trade → shiguang 负债同步（每日 06:10）

- `sync-debt-from-trade.mjs`：读 trade 资产模块快照（asset_snapshots_v1，你在「资产负债记账」页录入）按编码更新账户 15091587905 的负债余额（只改余额）；并同步每月备付计划金额到 debt_reserve_checks（source='trade'）
- 编码→负债映射：`/opt/shiguangri_repo/scripts/trade-debt-mapping.json`（自动建档自学习写回；手工调整直接改此文件）
- 未映射编码每次运行打印提醒；B4/B5/B6/C5/F1 为自动建档占位名，请在界面改成真实名称
- 手动跑：`cd /opt/shiguangri_repo && node scripts/sync-debt-from-trade.mjs`（--dry 预览）

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
