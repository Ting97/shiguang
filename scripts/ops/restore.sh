#!/usr/bin/env bash
# 恢复演练/灾难恢复（REQ-009 FR-F3）：把某个 db dump + uploads 包恢复到运行态。
# 用法： sudo ./restore.sh /opt/shiguangri_backups/db-20261003-033000.dump /opt/shiguangri_backups/uploads-20261003-033000.tar.gz
# 恢复前会自动做一次"当前状态"的兜底备份（防止误把坏档盖好档）。
set -euo pipefail

DB_DUMP="${1:?用法: restore.sh <db.dump> [uploads.tar.gz]}"
UPLOADS="${2:-}"
DB_NAME="${DB_NAME:-shiguangri}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/shiguangri_data/uploads}"
STAMP=$(date +%Y%m%d-%H%M%S)

[ -f "$DB_DUMP" ] || { echo "✗ 找不到 $DB_DUMP"; exit 1; }

echo "[restore] 兜底备份当前数据库 …"
# 兜底档用 keep- 前缀：db-*.dump 是每日轮转池（7 份），兜底档进池会被挤掉
sudo -u postgres pg_dump -Fc "$DB_NAME" > "/opt/shiguangri_backups/keep-before-restore-$STAMP.dump"

echo "[restore] 停服务 → 恢复数据库 …"
systemctl stop shiguangri
sudo -u postgres pg_restore --clean --if-exists -d "$DB_NAME" "$DB_DUMP"

if [ -n "$UPLOADS" ]; then
  [ -f "$UPLOADS" ] || { echo "✗ 找不到 $UPLOADS"; exit 1; }
  echo "[restore] 恢复上传目录 …"
  rm -rf "${UPLOADS_DIR:?}.old" && mv "$UPLOADS_DIR" "${UPLOADS_DIR}.old"
  tar xzf "$UPLOADS" -C "$(dirname "$UPLOADS_DIR")"
fi

echo "[restore] 启服务 …"
systemctl start shiguangri
sleep 3
systemctl is-active shiguangri
curl -s -m 10 https://shiguang.ting97.cn/api/health | head -c 120; echo
echo "[restore] ✓ 完成（如需回退：keep-before-restore-$STAMP.dump 仍在）"
