#!/bin/bash
# E2E 测试会话铸造：为专用测试账号（13900000001，E2E 专号，非真实用户）签发临时会话 token。
# 用法：./e2e-session.sh [小时数=2]  → 输出 TOKEN（供浏览器 cookie 注入 / curl Authorization: Bearer）
# 注意：所有针对线上环境的自动化测试一律使用本测试账号；真实用户账号（15091587905）禁止用于测试。
set -euo pipefail
HOURS="${1:-2}"
cd /tmp
TOKEN=$(openssl rand -hex 32)
HASH=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)
P="sudo -n -u postgres psql -d shiguangri -tAc"
USERID=$($P "select id from profiles where phone='13900000001'")
if [ -z "$USERID" ]; then
  echo "E2E 测试账号不存在（phone=13900000001）" >&2
  exit 1
fi
$P "insert into sessions (user_id, token_hash, user_agent, expires_at) values ('$USERID','$HASH','e2e-test', now() + interval '$HOURS hours')" >/dev/null
echo "$TOKEN"
