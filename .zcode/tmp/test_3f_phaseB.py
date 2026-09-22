# -*- coding: utf-8 -*-
"""3-F Phase B（真实登录）：非管理员用户的模块门禁 401/403/200 矩阵 + me.modules 实时生效 + trade_week 配额计提"""
import json, urllib.request, urllib.error, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://localhost:3100"
PASS = 0
FAILS = []

def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def check(name, cond, detail=""):
    global PASS
    if cond:
        PASS += 1
        print("PASS", name)
    else:
        FAILS.append((name, detail))
        print("FAIL", name, detail)

# 未登录 401
s, r = call("GET", "/api/debts")
check("未登录 /api/debts 401", s == 401, str(r))
s, r = call("GET", "/api/finance/stats")
check("未登录 stats 401", s == 401, str(r))

# 登录测试用户
s, r = call("POST", "/api/auth/login", {"phone": "13800003366", "password": "test3f-pass"})
check("登录 200", s == 200 and r.get("token"), f"{s} {str(r)[:120]}")
token = r["token"]

s, me = call("GET", "/api/auth/me", token=token)
check("me.modules=两模块", sorted(me.get("modules", [])) == ["debt", "trade_review"], str(me.get("modules")))
check("me 非 admin", me.get("isAdmin") is False)

# 普通用户访问 admin grants API → 403
s, r = call("GET", "/api/admin/grants", token=token)
check("普通用户 grants API 403", s == 403, str(r))
s, r = call("POST", "/api/admin/grants", {"userId": me["id"], "module": "debt"}, token=token)
check("普通用户授权操作 403", s == 403, str(r))

# 已授权：200，且数据隔离（测试用户自己没有负债）
s, r = call("GET", "/api/debts", token=token)
check("已授权 /api/debts 200 且列表为空(数据隔离)", s == 200 and r.get("debts") == [], str(r)[:120])
s, r = call("GET", "/api/finance/stats", token=token)
check("已授权 stats 200", s == 200, str(r))

# 交易周报：非管理员真实生成 + 配额计提
today = __import__("datetime").date.today().isoformat()
s, r = call("POST", "/api/finance/review/week", {"date": today}, token=token)
check("非管理员周报生成 200(周池 3 次内)", s == 200, f"{s} {str(r)[:150]}")

print(f"\n== Phase B 结果：PASS {PASS} / FAIL {len(FAILS)} ==")
for n, d in FAILS:
    print("  FAIL:", n, d[:200])
sys.exit(1 if FAILS else 0)
