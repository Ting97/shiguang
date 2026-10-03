#!/usr/bin/env bash
# 数据库 + 上传目录备份（REQ-009 FR-F3）：服务器 crontab 每日执行，本地保留 7 份轮转。
# 安装（服务器上）：crontab -e 加一行
#   30 3 * * * /opt/shiguangri_repo/scripts/ops/backup.sh >> /var/log/shiguangri-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/shiguangri_backups}"
KEEP=7
STAMP=$(date +%Y%m%d-%H%M%S)
UPLOADS_DIR="${UPLOADS_DIR:-/opt/shiguangri_data/uploads}"
DB_NAME="${DB_NAME:-shiguangri}"

mkdir -p "$BACKUP_DIR"

# 1) 数据库（pg_dump -Fc 自定义格式，pg_restore 可并行恢复）
sudo -u postgres pg_dump -Fc "$DB_NAME" > "$BACKUP_DIR/db-$STAMP.dump"

# 2) 上传目录（增量代价高、总量可控，直接整目录打包）
tar czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"

# 3) 轮转：只保留最近 KEEP 份
ls -1t "$BACKUP_DIR"/db-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm --
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "[backup] ok: db-$STAMP.dump uploads-$STAMP.tar.gz"
