# 批③ finance/platform/entries 迁移冒烟回归（只读接口；登录态走 Bearer，无数据写入，无需清理）
import requests

BASE = "http://127.0.0.1:3100"
HDRS = {"Origin": BASE, "Sec-Fetch-Site": "same-origin"}

s = requests.Session()
r = s.post(f"{BASE}/api/auth/login", json={"phone": "13800003366", "password": "test3f-pass"},
           headers=HDRS, timeout=30)
ok = r.status_code == 200
token = (r.json() or {}).get("token") if ok else None
print(f"login: {r.status_code} token={'yes' if token else 'no'}")
if not token:
    print("body:", r.text[:300])
    raise SystemExit(1)

auth = {**HDRS, "Authorization": f"Bearer {token}"}

cases = [
    ("GET", "/api/accounts", None),
    ("GET", "/api/transactions?month=2026-09", None),
    ("GET", "/api/debts", None),
    ("GET", "/api/debts/overview", None),
    ("GET", "/api/finance/overview?month=2026-09", None),
    ("GET", "/api/export?format=json", None),
]
fails = 0
for method, path, _ in cases:
    r = s.request(method, BASE + path, headers=auth, timeout=60)
    tag = "PASS" if r.status_code == 200 else "FAIL"
    if r.status_code != 200:
        fails += 1
    print(f"{tag} {method} {path} -> {r.status_code} {r.text[:120] if r.status_code != 200 else ''}")

# 未登录 401 语义抽查（迁移后仍应 401 而非 403/500）
r = requests.get(f"{BASE}/api/accounts", timeout=30)
print(("PASS" if r.status_code == 401 else "FAIL"), "GET /api/accounts anon ->", r.status_code, r.text[:80])
fails += 0 if r.status_code == 401 else 1

raise SystemExit(1 if fails else 0)
