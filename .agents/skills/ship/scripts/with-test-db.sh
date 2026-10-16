#!/usr/bin/env bash
# 真库测试环境一键就绪（Mac 本机无 PG → ssh 隧道远端实例的 scratch 库）。
# 用法：source .agents/skills/ship/scripts/with-test-db.sh && npm test
# 幂等：隧道已通则复用；scratch 库不存在时报错退出（先在服务器 create database）。
set -euo pipefail

TUNNEL_PORT=15432
SCRATCH_DB="${SCRATCH_DB:-shiguangri_022_test}"
export PATH="$HOME/.local/node/bin:$PATH"

# 隧道幂等：端口通即复用，否则拉起（必须 127.0.0.1——localhost 会解析 ::1 撞 pg_hba ident；
# nohup+disown 防 Bash 会话退出 HUP 断连）
if ! nc -z 127.0.0.1 "$TUNNEL_PORT" >/dev/null 2>&1; then
  nohup ssh -N -L "$TUNNEL_PORT:127.0.0.1:5432" tencent >/tmp/sg_tunnel.log 2>&1 </dev/null &
  disown
  for _ in $(seq 1 10); do
    nc -z 127.0.0.1 "$TUNNEL_PORT" >/dev/null 2>&1 && break
    sleep 1
  done
  nc -z 127.0.0.1 "$TUNNEL_PORT" >/dev/null 2>&1 || { echo "ship: 隧道拉起失败（看 /tmp/sg_tunnel.log）" >&2; exit 1; }
fi

# 服务端部署 .env 的连接串（不回显）→ 换 host/port/db 指向 scratch 库
export REMOTE_URL
REMOTE_URL=$(ssh -o ConnectTimeout=8 tencent "grep '^DATABASE_URL=' /opt/shiguangri/.env | cut -d= -f2-" 2>/dev/null)
[ -n "$REMOTE_URL" ] || { echo "ship: 读取服务端 DATABASE_URL 失败（ssh tencent 不通？）" >&2; exit 1; }

export SHIGUANGRI_TEST_DB
SHIGUANGRI_TEST_DB=$(node -e "const u=new URL(process.env.REMOTE_URL); u.host='127.0.0.1:$TUNNEL_PORT'; u.pathname='/$SCRATCH_DB'; console.log(u.toString())")

# 连通性自检（探活失败快速报错，不带着假环境跑测试）
node -e "
const { Client } = require('pg');
const u = new URL(process.env.SHIGUANGRI_TEST_DB);
(async () => {
  const c = new Client({ host: u.hostname, port: u.port, user: u.username, password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
  await c.connect();
  const r = await c.query('select to_regclass(\'public.fitness_daily_plans\') as t');
  await c.end();
  if (!r.rows[0].t) { console.error('ship: scratch 库缺表——需先 npm run db:migrate -- --fresh（慎用，会清库）'); process.exit(1); }
  console.log('ship: 真库测试环境就绪 →', u.host, u.pathname);
})().catch(e => { console.error('ship: 测试库连通失败:', e.message); process.exit(1); });
"
