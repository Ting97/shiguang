# -*- coding: utf-8 -*-
"""3-F Phase A（AUTH_DISABLED=1 = dev admin）：负债 CRUD/还款联动/总览/模拟 + 统计对账 + 交易周报缓存/配额 + admin grants API"""
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

# ---------- me.modules ----------
s, me = call("GET", "/api/auth/me")
check("me 200 且 admin", s == 200 and me.get("isAdmin") is True)
check("me.modules 含 debt+trade_review", set(me.get("modules", [])) >= {"debt", "trade_review"}, str(me.get("modules")))

# ---------- 负债校验 ----------
s, r = call("POST", "/api/debts", {"name": "x", "type": "credit_card", "principalCents": 1000, "ratePct": 40})
check("rate>36 拒 400", s == 400, str(r))
s, r = call("POST", "/api/debts", {"name": "x", "type": "loan", "principalCents": 1000})
check("非法 type 拒 400", s == 400, str(r))
s, r = call("POST", "/api/debts", {"name": "", "type": "credit_card", "principalCents": 1000})
check("空名称拒 400", s == 400, str(r))
s, r = call("POST", "/api/debts", {"name": "x", "type": "credit_card", "principalCents": 10.5})
check("非整数本金拒 400", s == 400, str(r))

# ---------- 建档 ----------
s, r = call("POST", "/api/debts", {"name": "招行信用卡", "type": "credit_card", "principalCents": 100000,
                                    "ratePct": 18, "monthlyCents": 50000, "payDay": 10})
check("建档 信用卡", s == 200 and r["debt"]["balance_cents"] == 100000, str(r))
card = r["debt"]
s, r = call("POST", "/api/debts", {"name": "老爸借款", "type": "family", "principalCents": 50000,
                                    "ratePct": 0, "monthlyCents": None})
check("建档 亲友(月供空)", s == 200 and r["debt"]["monthly_cents"] is None, str(r))
fam = r["debt"]
due = __import__("datetime").date.today() + __import__("datetime").timedelta(days=60)
s, r = call("POST", "/api/debts", {"name": "房贷", "type": "mortgage", "principalCents": 1000000,
                                    "ratePct": 4.9, "monthlyCents": 300000, "dueDate": due.isoformat()})
check("建档 房贷(60d 到期)", s == 200, str(r))
mort = r["debt"]

# ---------- 账户 + 还款联动 ----------
s, r = call("POST", "/api/accounts", {"name": "测试钱包", "icon": "💵", "openingBalanceCents": 200000})
acct = r["account"]
today = __import__("datetime").date.today().isoformat()
s, r = call("POST", f"/api/debts/{card['id']}/payments",
            {"amountCents": 30000, "paidAt": today, "accountId": acct["id"], "note": "第一次还"})
check("还款 200 余额递减", s == 200 and r["debt"]["balance_cents"] == 70000, str(r))
check("还款联动生成流水 tx_id 回填", r.get("transactionId") == r["payment"]["tx_id"] and r["transactionId"], str(r.get("transactionId")))
check("还款自动结清 status", r["debt"]["status"] == "active")
tx_id = r["transactionId"]

s, r = call("POST", f"/api/debts/{card['id']}/payments", {"amountCents": 30000, "paidAt": today, "accountId": acct["id"]})
check("同日同额重复 409", s == 409, str(r))

s, r = call("GET", f"/api/debts/{card['id']}/payments")
check("还款记录列表 1 条", s == 200 and len(r["payments"]) == 1 and r["payments"][0]["amount_cents"] == 30000, str(r))

# 联动流水真的存在且分类还款、账户正确
s, r = call("GET", f"/api/transactions/{today[:7]}")
month_key = today[:7]
s, r = call("GET", f"/api/transactions?month={month_key}")
txs = r.get("transactions", [])
repay = [t for t in txs if t["id"] == tx_id]
check("联动流水在月列表中 分类=还款", len(repay) == 1 and repay[0]["category"] == "还款" and repay[0]["is_draft"] is False, str(repay))

# 还清：余额 0 → 自动 cleared
s, r = call("POST", f"/api/debts/{card['id']}/payments", {"amountCents": 70000, "paidAt": today, "accountId": acct["id"]})
check("还清后 balance=0 且 status=cleared", s == 200 and r["debt"]["balance_cents"] == 0 and r["debt"]["status"] == "cleared", str(r))
s, r = call("POST", f"/api/debts/{card['id']}/payments", {"amountCents": 100, "paidAt": today})
check("对已结清负债还款 400", s == 400, str(r))

# ---------- 总览数学 ----------
s, ov = call("GET", "/api/debts/overview")
check("总览 200", s == 200)
# active: family 50000 + mortgage 1000000；信用卡已清
check("总负债=1050000(含亲友)", ov["totals"]["balanceCents"] == 1050000, str(ov["totals"]))
check("银行口径=1000000", ov["totals"]["bankCents"] == 1000000, str(ov["totals"]))
check("月供合计=300000(亲友无月供/卡已清)", ov["totals"]["monthlyDueCents"] == 300000, str(ov["totals"]))
# 加权利率 = (50000*0 + 1000000*4.9)/1050000
expect_rate = round(1000000 * 4.9 / 1050000, 2)
check("加权利率≈%.2f" % expect_rate, abs(ov["totals"]["weightedRatePct"] - expect_rate) < 0.02, str(ov["totals"]))
s, ar = call("GET", "/api/accounts")
accts = [a for a in ar["accounts"] if a["id"] == acct["id"]]
check("账户动态余额=200000-100000", accts[0]["balance_cents"] == 100000, str(accts))
check("净资产恒等式=资产-负债", ov["netWorthCents"] == ov["assetBalanceCents"] - ov["totals"]["balanceCents"], str(ov["netWorthCents"]))
check("资产合计含测试钱包", ov["assetBalanceCents"] >= 100000, str(ov["assetBalanceCents"]))
check("到期墙含房贷且 danger", any(w["id"] == mort["id"] and w["level"] == "danger" for w in ov["wall"]), str(ov["wall"]))
check("现金流已记还款=100000", ov["cashFlow"]["paidThisMonthCents"] == 100000, str(ov["cashFlow"]))
check("缺口=结余-剩余月供", ov["cashFlow"]["gapCents"] == (ov["cashFlow"]["realizedCents"] - ov["cashFlow"]["remainingDueCents"]), str(ov["cashFlow"]))

# ---------- 策略模拟 ----------
s, r = call("POST", "/api/debts/simulate", {"extraMonthlyCents": 0})
check("模拟 200", s == 200)
check("extra=0 雪球利息=基线", r["snowball"]["totalInterestCents"] == r["baseline"]["totalInterestCents"], str(r["baseline"]["totalInterestCents"]))
check("基线不清零(亲友无月供)", r["baseline"]["notCleared"] is True)
s, r = call("POST", "/api/debts/simulate", {"extraMonthlyCents": 200000})
check("雪球顺序 先小额(亲友)", r["snowball"]["order"][0] == "老爸借款", str(r["snowball"]["order"]))
check("雪崩顺序 先高息(房贷)", r["avalanche"]["order"][0] == "房贷", str(r["avalanche"]["order"]))
check("策略均清零", r["snowball"]["notCleared"] is False and r["avalanche"]["notCleared"] is False)
check("节省额≥0", r["snowball"]["interestSavedVsBaselineCents"] >= 0 and r["avalanche"]["interestSavedVsBaselineCents"] >= 0)
check("高息额外还款 雪崩省息≥雪球", r["avalanche"]["interestSavedVsBaselineCents"] >= r["snowball"]["interestSavedVsBaselineCents"],
      f"snow={r['snowball']['interestSavedVsBaselineCents']} aval={r['avalanche']['interestSavedVsBaselineCents']}")
s, r = call("POST", "/api/debts/simulate", {"extraMonthlyCents": -5})
check("负额外还款 400", s == 400, str(r))

# ---------- PATCH/DELETE ----------
s, r = call("PATCH", f"/api/debts/{fam['id']}", {"name": "老爸借款2", "priority": 1})
check("PATCH 更新", s == 200 and r["debt"]["name"] == "老爸借款2" and r["debt"]["priority"] == 1, str(r))
s, r = call("DELETE", f"/api/debts/{fam['id']}")
check("DELETE=归档", s == 200)
s, r = call("GET", "/api/debts")
fam_after = [d for d in r["debts"] if d["id"] == fam["id"]][0]
check("归档后 status=archived", fam_after["status"] == "archived", str(fam_after["status"]))

# ---------- 统计对账（day） ----------
month_key = today[:7]
s, r = call("GET", f"/api/transactions?month={month_key}")
txs = r.get("transactions", [])
def bj_day(iso):
    return (iso[:10] if "T" not in iso else __import__("datetime").datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(__import__("datetime").timezone(__import__("datetime").timedelta(hours=8))).date().isoformat())
day_out = sum(t["amount_cents"] for t in txs if not t["is_draft"] and t["direction"] == "out" and bj_day(t["occurred_at"]) == today)
day_in = sum(t["amount_cents"] for t in txs if not t["is_draft"] and t["direction"] == "in" and bj_day(t["occurred_at"]) == today)
s, st = call("GET", f"/api/finance/stats?period=day&date={today}")
check("stats day 200", s == 200)
check("stats day 支出对账", st["totals"]["outCents"] == day_out, f"stats={st['totals']['outCents']} calc={day_out}")
check("stats day 收入对账", st["totals"]["inCents"] == day_in, f"stats={st['totals']['inCents']} calc={day_in}")
check("stats day 环比字段", "outCents" in st["prev"] and "inCents" in st["prev"])
check("stats day 分类合计=支出", sum(c["cents"] for c in st["byCategory"]) == day_out, str(st["byCategory"]))
repay_cat = [c for c in st["byCategory"] if c["category"] == "还款"]
check("stats day 含还款分类", len(repay_cat) == 1 and repay_cat[0]["cents"] == 100000, str(repay_cat))

# ---------- 统计对账（week） ----------
s, st = call("GET", f"/api/finance/stats?period=week&date={today}")
check("stats week 200 且 daily=7", s == 200 and len(st["daily"]) == 7, str(len(st.get("daily", []))))
check("stats week daily 求和=总支出", sum(d["outCents"] for d in st["daily"]) == st["totals"]["outCents"], str(st["totals"]))
check("stats week range 周一..周日", st["range"]["from"] <= today <= st["range"]["to"], str(st["range"]))
check("stats week 账户分布含测试钱包", any(a["name"] == "测试钱包" for a in st["byAccount"]), str(st["byAccount"]))

# ---------- 交易周报（真实 GLM，admin 免配额） ----------
s, r = call("GET", f"/api/finance/review/week?date={today}")
check("周报缓存 GET 先为空", s == 200 and r.get("review") is None, str(r))
s, r = call("POST", "/api/finance/review/week", {"date": today})
check("周报生成 200", s == 200, str(r))
first_summary = r.get("review", {}).get("summary", "")
check("周报有 summary", len(first_summary) > 0, first_summary)
check("周报标注未缓存", r.get("cached") is False)
gen_at = r.get("generatedAt")
monday = ( __import__("datetime").date.fromisoformat(today) - __import__("datetime").timedelta(days=__import__("datetime").date.fromisoformat(today).weekday()) ).isoformat()
s, r = call("GET", f"/api/finance/review/week?date={today}")
check("周报缓存命中 内容一致", s == 200 and r.get("cached") is True and r["review"]["summary"] == first_summary
      and r.get("range", {}).get("from") == monday, str(r))

# ---------- admin grants API（为 Phase B 的测试用户授权） ----------
INVITE = "TEST3F01"
s, r = call("POST", "/api/auth/register", {"phone": "13800003366", "password": "test3f-pass", "inviteCode": INVITE, "nickname": "权限测试"})
check("注册测试用户(或已存在)", s == 200 or (s == 400 and "已注册" in str(r)), f"{s} {r}")

print(f"\n== Phase A 结果：PASS {PASS} / FAIL {len(FAILS)} ==")
for n, d in FAILS:
    print("  FAIL:", n, d[:200])
sys.exit(1 if FAILS else 0)
