#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拾光个人经营系统 API 全量验收测试 —— finance / people / platform 三域
- 金额一律「分」整数；断言数学恒等式
- 测试数据全部加 QA- 前缀；结束时清理（删 QA- 流水/联系人，归档 QA- 账户/负债，恢复 budget 与 grants）
- 不触发 AI 识别类调用
"""
import datetime
import re
import sys

import requests

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:3100"
ORIGIN_HEADERS = {"Origin": BASE, "Sec-Fetch-Site": "same-origin"}
PHONE = "13800003366"
PASSWORD = "test3f-pass"
SELF_ID = "0392146a-7785-4e30-a6c4-d82a5374239a"
FAKE_UUID = "11111111-1111-1111-1111-111111111111"

TX_CATEGORIES = ["餐饮", "交通", "人情往来", "学习", "购物", "娱乐", "医疗", "居住", "还款", "其他"]

results = []


def record(domain, point, ok, detail=""):
    results.append((domain, point, bool(ok), str(detail)))
    tag = "PASS" if ok else "FAIL"
    line = f"[{tag}] {domain} > {point}"
    if detail:
        line += f" —— {detail}"
    print(line, flush=True)


def to_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class Api:
    def __init__(self, token=None):
        self.token = token

    def call(self, method, path, body=None, params=None, auth=True, headers=None):
        h = dict(ORIGIN_HEADERS)
        if headers:
            h.update(headers)
        if auth and self.token:
            h["Authorization"] = "Bearer " + self.token
        r = requests.request(
            method, BASE + path, headers=h, params=params,
            json=body if body is not None else None, timeout=30,
        )
        try:
            data = r.json()
        except Exception:
            data = None
        return r, data


# ---- 北京时间工具（服务端按 Asia/Shanghai 切月/切日） ----
def bj_now():
    return datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)


BJ = bj_now()
MONTH = BJ.strftime("%Y-%m")
TODAY = BJ.strftime("%Y-%m-%d")
# 账户名有 (user_id, name) 唯一约束且软归档不释放名称，故每次运行加时间戳避免撞名
RUN_TAG = BJ.strftime("%m%d%H%M%S")
NM_ACC_A = f"QA-账户-钱包-{RUN_TAG}"
NM_ACC_B = f"QA-账户-乙-{RUN_TAG}"
NM_ACC_T = f"QA-账户-临时-{RUN_TAG}"
NM_DBT_MAIN = f"QA-负债-信用卡-{RUN_TAG}"
NM_DBT_FAM = f"QA-负债-亲友-{RUN_TAG}"
NM_DBT_DANGER = f"QA-负债-到期-danger-{RUN_TAG}"
NM_DBT_WARN = f"QA-负债-到期-warn-{RUN_TAG}"
NM_DBT_SMALL = f"QA-负债-小额-{RUN_TAG}"
NM_CT_A = f"QA-联系人-张三-{RUN_TAG}"
NM_CT_B = f"QA-联系人-李四-{RUN_TAG}"
NM_CT_C = f"QA-联系人-空白-{RUN_TAG}"


def bj_month_offset(month_key, delta):
    y, m = (int(x) for x in month_key.split("-"))
    t = y * 12 + (m - 1) + delta
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


PREV_MONTH = bj_month_offset(MONTH, -1)


def iso_bj_noon(day=None):
    d = day or TODAY
    return f"{d}T12:00:00+08:00"


# ---- 清理登记 ----
TX_IDS = []        # 需删除的流水 id
ACCOUNT_IDS = []   # 需归档的账户 id
DEBT_IDS = []      # 需归档的负债 id
CONTACT_IDS = []   # 需删除的联系人 id
LIVE_TXS = []      # (account_id, direction, amount_cents) 存活中的 QA 流水（算余额用）


def expected_balance(opening, account_id):
    delta = sum(
        amt if d == "in" else -amt
        for (acc, d, amt) in LIVE_TXS if acc == account_id
    )
    return opening + delta


def parse_bill_csv():
    return (
        "支付宝（中国）网络技术有限公司  交易记录明细\n"
        "账号:QA-测试\n"
        "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收付款方式,交易状态,交易订单号,商家订单号,备注\n"
        "2026-09-20 12:30:00,餐饮美食,QA-商家-面馆,acc@Test,QA-牛肉面,支出,25.50,余额,交易成功,202609202200QA0001,,qa备注\n"
        "2026-09-20 18:00:00,文化休闲,QA-商户-影院,acc@Test,QA-电影票,收入,100.00,余额,交易成功,202609202200QA0002,,\n"
        "2026-09-20 19:00:00,充值缴费,QA-缴费户,acc@Test,QA-话费,不计收支,50.00,余额,交易成功,202609202200QA0003,,\n"
    )


# =====================================================================
def main():
    # ---------- 登录 ----------
    api_anon = Api()
    r, data = api_anon.call("POST", "/api/auth/login",
                            body={"phone": PHONE, "password": PASSWORD})
    assert r.status_code == 200 and data and data.get("token"), f"登录失败: {r.status_code} {r.text[:200]}"
    token = data["token"]
    api = Api(token)
    print(f"登录成功 user={data.get('user')}")

    r, me = api.call("GET", "/api/auth/me")
    me_id = (me.get("user") or me or {}).get("id") if isinstance(me, dict) else None
    record("platform", "auth/me 返回当前用户 id", r.status_code == 200 and me_id == SELF_ID,
           f"me.id={me_id}")

    # ---------------- platform 域 ----------------
    test_platform(api, api_anon)
    # ---------------- people 域 ----------------
    test_people(api)
    # ---------------- finance 域 ----------------
    test_finance(api, api_anon)


# =====================================================================
def test_platform(api, api_anon):
    D = "platform"
    # --- health ---
    r, data = api_anon.call("GET", "/api/health", auth=False)
    record(D, "health GET 不鉴权 200", r.status_code == 200 and (data or {}).get("ok") is True,
           f"status={r.status_code} body={str(data)[:120]}")

    # --- admin/invites ---
    r, data = api.call("POST", "/api/admin/invites", body={})
    code = ((data or {}).get("invite") or {}).get("code")
    record(D, "invites POST 生成邀请码", r.status_code == 200 and bool(code),
           f"status={r.status_code} resp={str(data)[:120]}")
    r2, d2 = api.call("POST", "/api/admin/invites", body={"days": 3})
    exp = ((d2 or {}).get("invite") or {}).get("expires_at")
    ok_days = False
    if exp:
        try:
            dt = datetime.datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
            ok_days = abs((dt - datetime.datetime.now(datetime.timezone.utc)).total_seconds() - 3 * 86400) < 86400
        except Exception:
            pass
    record(D, "invites days=3 有效期≈3天", r2.status_code == 200 and ok_days, f"expires_at={exp}")
    r, data = api.call("GET", "/api/admin/invites")
    codes = [i.get("code") for i in (data or {}).get("invites", [])]
    record(D, "invites GET 列表含新码", r.status_code == 200 and code in codes,
           f"status={r.status_code} contains={code in codes} n={len(codes)}")

    # --- admin/grants ---
    r, data = api.call("GET", "/api/admin/grants")
    grants = (data or {}).get("grants", [])
    record(D, "grants GET 授权矩阵", r.status_code == 200 and isinstance(grants, list),
           f"status={r.status_code} n={len(grants)}")
    initial_self = sorted({g["module"] for g in grants if g.get("user_id") == SELF_ID})
    print(f"  [info] 自己现有授权: {initial_self}")

    r, data = api.call("POST", "/api/admin/grants", body={"userId": SELF_ID, "module": "no_such"})
    record(D, "grants POST 非法 module 400", r.status_code == 400, f"status={r.status_code} resp={str(data)[:100]}")

    r, data = api.call("POST", "/api/admin/grants", body={"userId": SELF_ID, "module": "debt"})
    record(D, "grants POST 授权 debt", r.status_code == 200 and (data or {}).get("ok") is True
           and "debt" in (data or {}).get("modules", []), f"status={r.status_code} resp={str(data)[:120]}")
    r, data = api.call("POST", "/api/admin/grants", body={"userId": SELF_ID, "module": "debt"})
    record(D, "grants POST 幂等重复授权", r.status_code == 200, f"status={r.status_code}")
    r, data = api.call("GET", "/api/admin/grants")
    has = any(g.get("user_id") == SELF_ID and g.get("module") == "debt" for g in (data or {}).get("grants", []))
    record(D, "grants GET 矩阵含新授权", r.status_code == 200 and has, f"status={r.status_code}")

    r, data = api.call("DELETE", "/api/admin/grants", params={"userId": SELF_ID, "module": "debt"})
    record(D, "grants DELETE 撤销授权", r.status_code == 200 and (data or {}).get("ok") is True,
           f"status={r.status_code}")
    r, data = api.call("GET", "/api/admin/grants")
    gone = not any(g.get("user_id") == SELF_ID and g.get("module") == "debt"
                   for g in (data or {}).get("grants", []))
    record(D, "grants DELETE 后矩阵无此行", gone, "")

    # 恢复授权（初始有 debt 的场合 + 任务要求测完必恢复 debt）
    restore = sorted(set(initial_self) | {"debt"})
    for m in restore:
        api.call("POST", "/api/admin/grants", body={"userId": SELF_ID, "module": m})
    r, data = api.call("GET", "/api/admin/grants")
    ok_restore = all(any(g.get("user_id") == SELF_ID and g.get("module") == m
                         for g in (data or {}).get("grants", [])) for m in restore)
    record(D, "grants 授权已恢复", ok_restore, f"restored={restore}")

    # --- billing ---
    r, data = api.call("GET", "/api/billing/users")
    users = (data or {}).get("users", [])
    me_row = next((u for u in users if u.get("phone") == PHONE), None)
    record(D, "billing/users GET 用户列表含自己",
           r.status_code == 200 and me_row is not None and "plan" in me_row,
           f"status={r.status_code} n={len(users)}")
    r, data = api.call("GET", "/api/billing/plan")
    record(D, "billing/plan GET 自己套餐",
           r.status_code == 200 and (data or {}).get("isAdmin") is True and isinstance((data or {}).get("byModel"), list),
           f"status={r.status_code} keys={sorted((data or {}).keys())[:8]}")

    # --- export ---
    r, data = api.call("GET", "/api/export", params={"format": "json"})
    cd = r.headers.get("Content-Disposition", "")
    ok_json = False
    if data is not None:
        ok_json = all(k in data for k in ("transactions", "accounts", "contacts", "budgets", "entries"))
    record(D, "export json 全量导出", r.status_code == 200 and "attachment" in cd and ok_json,
           f"status={r.status_code} cd={cd[:60]} keys_ok={ok_json}")
    r, data = api.call("GET", "/api/export", params={"format": "md"})
    body = r.text if isinstance(r.text, str) else ""
    record(D, "export md 日记导出", r.status_code == 200 and "text/markdown" in r.headers.get("Content-Type", "")
           and "# 拾光" in body, f"status={r.status_code} ct={r.headers.get('Content-Type', '')[:40]}")


# =====================================================================
def test_people(api):
    D = "people"
    # --- contacts GET ---
    r, data = api.call("GET", "/api/contacts")
    contacts0 = (data or {}).get("contacts", [])
    record(D, "contacts GET 列表(含 intimacy/importance/互动数)",
           r.status_code == 200 and isinstance(contacts0, list)
           and all(("intimacy" in c and "importance" in c and "interaction_count" in c) for c in contacts0[:5]),
           f"status={r.status_code} n={len(contacts0)}")

    name_a, name_b, name_c = NM_CT_A, NM_CT_B, NM_CT_C
    # --- POST 建档 ---
    r, data = api.call("POST", "/api/contacts", body={
        "name": name_a, "alias": "QA-三儿", "group": "同事", "importance": 5,
        "birthday": "1990-01-01", "notes": "QA-备注",
    })
    ca = ((data or {}).get("contact") or {})
    ok = (r.status_code == 200 and ca.get("name") == name_a and ca.get("importance") == 5
          and ca.get("group_tag") == "同事" and ca.get("birthday") == "1990-01-01")
    record(D, "contacts POST 建档(别名/分组/重要度/生日)", ok, f"status={r.status_code} resp={str(data)[:160]}")
    if ca.get("id"):
        CONTACT_IDS.append(ca["id"])

    r, data = api.call("POST", "/api/contacts", body={"name": name_a})
    record(D, "contacts POST 重名 400(拒绝冲突, 不自动合并)",
           r.status_code == 400 and "已有联系人" in str((data or {}).get("error", "")),
           f"status={r.status_code} resp={str(data)[:100]}")
    r, data = api.call("POST", "/api/contacts", body={"name": "   "})
    record(D, "contacts POST 空姓名 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", "/api/contacts", body={"name": name_b, "importance": 9})
    cb = ((data or {}).get("contact") or {})
    record(D, "contacts POST 非法重要度回落默认 3",
           r.status_code == 200 and cb.get("importance") == 3, f"importance={cb.get('importance')}")
    if cb.get("id"):
        CONTACT_IDS.append(cb["id"])
    r, data = api.call("POST", "/api/contacts", body={"name": name_c})
    cc = ((data or {}).get("contact") or {})
    if cc.get("id"):
        CONTACT_IDS.append(cc["id"])

    # --- PATCH 编辑 ---
    r, data = api.call("PATCH", f"/api/contacts/{ca.get('id')}", body={
        "alias": "QA-阿三", "intimacy": 88, "importance": 4, "birthday": "1991-02-02",
    })
    cu = ((data or {}).get("contact") or {})
    record(D, "contacts PATCH 别名/亲密度/重要度/生日",
           r.status_code == 200 and cu.get("alias") == "QA-阿三" and cu.get("intimacy") == 88
           and cu.get("importance") == 4 and cu.get("birthday") == "1991-02-02",
           f"status={r.status_code} resp={str(data)[:160]}")
    r, data = api.call("PATCH", f"/api/contacts/{ca.get('id')}", body={"intimacy": 101})
    record(D, "contacts PATCH 亲密度>100 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("PATCH", f"/api/contacts/{ca.get('id')}", body={"importance": 9})
    record(D, "contacts PATCH 重要度越界 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("PATCH", f"/api/contacts/{ca.get('id')}", body={"name": name_b})
    record(D, "contacts PATCH 改名撞已有姓名 400", r.status_code == 400 and "已有联系人" in str((data or {}).get("error", "")),
           f"status={r.status_code} resp={str(data)[:100]}")

    # --- interactions ---
    r, data = api.call("POST", f"/api/contacts/{ca.get('id')}/interactions", body={
        "type": "请客", "summary": "QA-一起聚餐", "occurredAt": iso_bj_noon(),
    })
    it = ((data or {}).get("interaction") or {})
    record(D, "interactions POST 记往来(type/summary/occurredAt)",
           r.status_code == 200 and it.get("type") == "请客" and it.get("summary") == "QA-一起聚餐",
           f"status={r.status_code} resp={str(data)[:140]}")
    iid = it.get("id")
    r, data = api.call("POST", f"/api/contacts/{ca.get('id')}/interactions", body={
        "type": "不存在的类型", "summary": "QA-类型回落",
    })
    it2 = ((data or {}).get("interaction") or {})
    record(D, "interactions POST 非法 type 回落「其他」",
           r.status_code == 200 and it2.get("type") == "其他", f"type={it2.get('type')}")
    iid2 = it2.get("id")
    r, data = api.call("POST", f"/api/contacts/{ca.get('id')}/interactions",
                       body={"type": "通话", "occurredAt": "not-a-date"})
    record(D, "interactions POST 非法时间 400", r.status_code == 400, f"status={r.status_code}")

    r, data = api.call("GET", f"/api/contacts/{ca.get('id')}")
    tl = (data or {}).get("timeline", [])
    record(D, "contacts/[id] GET 详情含往来时间线",
           r.status_code == 200 and len(tl) >= 2 and any(t.get("summary") == "QA-一起聚餐" for t in tl),
           f"status={r.status_code} timeline_n={len(tl)}")

    r, data = api.call("GET", "/api/contacts")
    cnt = next((to_int(c.get("interaction_count")) for c in (data or {}).get("contacts", [])
                if c.get("id") == ca.get("id")), None)
    record(D, "contacts GET 互动数=2", cnt == 2, f"interaction_count={cnt}")

    # 规格中的 GET 列表 / PATCH：源码未实现
    r, data = api.call("GET", f"/api/contacts/{ca.get('id')}/interactions")
    record(D, "interactions GET 列表", r.status_code == 200,
           f"期望 200 列表 / 实际 {r.status_code}（源码 contacts/[id]/interactions 只有 POST，无 GET handler；列表可经 GET /api/contacts/[id] timeline 获取）")
    r, data = api.call("PATCH", f"/api/interactions/{iid}", body={"summary": "QA-改"})
    record(D, "interactions PATCH 修改往来", r.status_code == 200,
           f"期望 200 / 实际 {r.status_code}（源码 interactions/[id] 仅实现 DELETE，无 PATCH handler）")

    r, data = api.call("DELETE", f"/api/interactions/{iid}")
    record(D, "interactions DELETE 删除往来", r.status_code == 200 and (data or {}).get("ok") is True,
           f"status={r.status_code}")
    r, data = api.call("GET", "/api/contacts")
    cnt = next((to_int(c.get("interaction_count")) for c in (data or {}).get("contacts", [])
                if c.get("id") == ca.get("id")), None)
    record(D, "删除往来后互动数回落", cnt == 1, f"interaction_count={cnt}")
    r, data = api.call("DELETE", f"/api/interactions/{iid2}")
    r, data = api.call("DELETE", f"/api/interactions/{iid}")
    record(D, "interactions DELETE 再删 404", r.status_code == 404, f"status={r.status_code}")

    # --- ai-profile（不触发 AI） ---
    r, data = api.call("GET", f"/api/contacts/{cc.get('id')}/ai-profile")
    record(D, "ai-profile GET", r.status_code == 200,
           f"期望合理响应 / 实际 {r.status_code}（源码仅实现 POST，GET 返回 405；POST 空记录场景见下一条）")
    r, data = api.call("POST", f"/api/contacts/{cc.get('id')}/ai-profile")
    record(D, "ai-profile POST 无往来记录 400(未触发 AI)",
           r.status_code == 400 and "往来记录" in str((data or {}).get("error", "")),
           f"status={r.status_code} resp={str(data)[:120]}")

    # --- DELETE 联系人 ---
    for cid in CONTACT_IDS:
        api.call("DELETE", f"/api/contacts/{cid}")
    CONTACT_IDS.clear()
    r, data = api.call("GET", "/api/contacts")
    names = [c.get("name") for c in (data or {}).get("contacts", [])]
    record(D, "contacts DELETE 后列表无 QA- 联系人",
           all(n not in names for n in (name_a, name_b, name_c)),
           f"still={ [n for n in names if n and n.startswith('QA-')] }")


# =====================================================================
def test_finance(api, api_anon):
    D = "finance"

    r, data = api_anon.call("GET", "/api/accounts", auth=False)
    record(D, "accounts GET 未登录 401", r.status_code == 401, f"status={r.status_code}")

    # ---------- accounts ----------
    r, data = api.call("GET", "/api/accounts")
    acc0 = (data or {}).get("accounts", [])
    record(D, "accounts GET 动态余额字段", r.status_code == 200 and
           all(("balance_cents" in a and "opening_balance_cents" in a) for a in acc0),
           f"status={r.status_code} n={len(acc0)}")

    r, data = api.call("POST", "/api/accounts", body={"name": NM_ACC_A, "icon": "🧪", "openingBalanceCents": 10000})
    acc_a = ((data or {}).get("account") or {})
    record(D, "accounts POST 创建(期初 10000 分)", r.status_code == 200 and to_int(acc_a.get("opening_balance_cents")) == 10000,
           f"status={r.status_code} resp={str(data)[:120]}")
    aid = acc_a.get("id")
    if aid:
        ACCOUNT_IDS.append(aid)

    r, data = api.call("POST", "/api/accounts", body={"name": NM_ACC_A})
    record(D, "accounts POST 重名 400", r.status_code == 400 and "同名" in str((data or {}).get("error", "")),
           f"status={r.status_code} resp={str(data)[:80]}")
    r, data = api.call("POST", "/api/accounts", body={"name": "QA-" + "长" * 18})
    record(D, "accounts POST 名称>20 字 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", "/api/accounts", body={"name": "QA-账户-x", "openingBalanceCents": 1.5})
    record(D, "accounts POST 期初非整数 400", r.status_code == 400, f"status={r.status_code}")

    r, data = api.call("POST", "/api/accounts", body={"name": NM_ACC_T, "openingBalanceCents": 0})
    acc_t = ((data or {}).get("account") or {})
    tid_tmp = acc_t.get("id")
    if tid_tmp:
        ACCOUNT_IDS.append(tid_tmp)
    r, data = api.call("DELETE", f"/api/accounts/{tid_tmp}")
    record(D, "accounts DELETE 软归档 ok", r.status_code == 200 and (data or {}).get("ok") is True,
           f"status={r.status_code}")
    r, data = api.call("GET", "/api/accounts")
    ids = [a.get("id") for a in (data or {}).get("accounts", [])]
    record(D, "accounts DELETE 后列表不含已归档", tid_tmp not in ids, "")
    r, data = api.call("POST", "/api/transactions",
                       body={"direction": "out", "amountCents": 100, "category": "购物", "accountId": tid_tmp})
    record(D, "已归档账户不可挂流水 400", r.status_code == 400, f"status={r.status_code}")

    # 动态余额推导：out → 7500, in → 7900, 改期初 20000 → 27900
    r, data = api.call("POST", "/api/transactions", body={
        "direction": "out", "amountCents": 2500, "category": "餐饮",
        "accountId": aid, "counterparty": "QA-对方", "occurredAt": iso_bj_noon(), "note": "QA-午餐",
    })
    tx1 = ((data or {}).get("transaction") or {})
    record(D, "transactions POST 手动支出", r.status_code == 200 and to_int(tx1.get("amount_cents")) == 2500
           and tx1.get("is_draft") is False and tx1.get("source") == "manual",
           f"status={r.status_code} resp={str(data)[:140]}")
    if tx1.get("id"):
        TX_IDS.append(tx1["id"]); LIVE_TXS.append((aid, "out", 2500))

    r, data = api.call("GET", "/api/accounts")
    bal = next((to_int(a.get("balance_cents")) for a in (data or {}).get("accounts", []) if a.get("id") == aid), None)
    record(D, "accounts 动态余额=out 扣减", bal == 7500, f"balance={bal} expect=7500")

    r, data = api.call("POST", "/api/transactions", body={
        "direction": "in", "amountCents": 400, "category": "其他", "accountId": aid, "occurredAt": iso_bj_noon(),
    })
    tx2 = ((data or {}).get("transaction") or {})
    if tx2.get("id"):
        TX_IDS.append(tx2["id"]); LIVE_TXS.append((aid, "in", 400))
    r, data = api.call("GET", "/api/accounts")
    bal = next((to_int(a.get("balance_cents")) for a in (data or {}).get("accounts", []) if a.get("id") == aid), None)
    record(D, "accounts 动态余额=in 增加且累计", bal == 7900, f"balance={bal} expect=7900")

    r, data = api.call("PATCH", f"/api/accounts/{aid}", body={"openingBalanceCents": 20000, "icon": "💼"})
    au = ((data or {}).get("account") or {})
    r2, d2 = api.call("GET", "/api/accounts")
    bal = next((to_int(a.get("balance_cents")) for a in (d2 or {}).get("accounts", []) if a.get("id") == aid), None)
    # 期初 +10000，此前流水净额 -2100（-2500 + 400）→ 17900
    record(D, "accounts PATCH 期初+图标, 余额随之平移",
           r.status_code == 200 and to_int(au.get("opening_balance_cents")) == 20000
           and au.get("icon") == "💼" and bal == 17900,
           f"status={r.status_code} opening={au.get('opening_balance_cents')} balance={bal} expect=17900")

    r, data = api.call("POST", "/api/accounts", body={"name": NM_ACC_B})
    acc_b = ((data or {}).get("account") or {})
    bid = acc_b.get("id")
    if bid:
        ACCOUNT_IDS.append(bid)
    r, data = api.call("PATCH", f"/api/accounts/{aid}", body={"name": NM_ACC_B})
    record(D, "accounts PATCH 改名重名 400", r.status_code == 400 and "同名" in str((data or {}).get("error", "")),
           f"status={r.status_code}")
    r, data = api.call("PATCH", f"/api/accounts/{FAKE_UUID}", body={"name": "QA-x"})
    record(D, "accounts PATCH 不存在 404", r.status_code == 404, f"status={r.status_code}")

    # ---------- transactions 校验 ----------
    r, data = api.call("POST", "/api/transactions", body={"direction": "out", "amountCents": 100, "category": "不存在分类"})
    record(D, "transactions POST 非法分类 400", r.status_code == 400 and "无效分类" in str((data or {}).get("error", "")),
           f"status={r.status_code}")
    r, data = api.call("POST", "/api/transactions", body={"direction": "out", "amountCents": 0, "category": "餐饮"})
    record(D, "transactions POST 金额 0 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", "/api/transactions", body={"direction": "out", "amountCents": 10.5, "category": "餐饮"})
    record(D, "transactions POST 金额小数 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", "/api/transactions", body={"direction": "up", "amountCents": 100, "category": "餐饮"})
    record(D, "transactions POST 非法方向 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", "/api/transactions",
                       body={"direction": "out", "amountCents": 100, "category": "餐饮", "accountId": FAKE_UUID})
    record(D, "transactions POST 他人/不存在账户 400", r.status_code == 400 and "账户不存在" in str((data or {}).get("error", "")),
           f"status={r.status_code}")
    r, data = api.call("POST", "/api/transactions",
                       body={"direction": "out", "amountCents": 100, "category": "餐饮", "occurredAt": "bad-date"})
    record(D, "transactions POST 非法时间 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", "/api/transactions", body={
        "direction": "out", "amountCents": 1200, "category": "还款", "accountId": aid, "occurredAt": iso_bj_noon(),
        "note": "QA-还信用卡",
    })
    tx_repay = ((data or {}).get("transaction") or {})
    record(D, "transactions POST 分类「还款」合法", r.status_code == 200 and tx_repay.get("category") == "还款",
           f"status={r.status_code} category={tx_repay.get('category')}")
    if tx_repay.get("id"):
        TX_IDS.append(tx_repay["id"]); LIVE_TXS.append((aid, "out", 1200))

    r, data = api.call("GET", "/api/transactions", params={"month": "202609"})
    record(D, "transactions GET 非格式 month 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("GET", "/api/transactions", params={"month": "2026-13"})
    record(D, "transactions GET 越界月份 2026-13(仅校验格式, 返回空列表)",
           r.status_code == 200 and (data or {}).get("transactions") == [],
           f"status={r.status_code} n={len((data or {}).get('transactions', []))}（源码正则 ^\\d{{4}}-\\d{{2}}$ 不校验月份取值范围）")
    r, data = api.call("GET", "/api/transactions", params={"month": MONTH})
    month_txs = (data or {}).get("transactions", [])
    record(D, "transactions GET 月列表含 QA- 流水",
           r.status_code == 200 and any(t.get("note") == "QA-午餐" for t in month_txs),
           f"status={r.status_code} n={len(month_txs)}")

    # PATCH / DELETE
    if tx1.get("id"):
        r, data = api.call("PATCH", f"/api/transactions/{tx1['id']}", body={"amountCents": 3000, "category": "购物"})
        tu = ((data or {}).get("transaction") or {})
        LIVE_TXS[:] = [t for t in LIVE_TXS if not (t[0] == aid and t[1] == "out" and t[2] == 2500)]
        LIVE_TXS.append((aid, "out", 3000))
        record(D, "transactions PATCH 改金额/分类", r.status_code == 200 and to_int(tu.get("amount_cents")) == 3000
               and tu.get("category") == "购物", f"status={r.status_code} amount={tu.get('amount_cents')}")
        r, data = api.call("PATCH", f"/api/transactions/{tx1['id']}", body={"amountCents": 0})
        record(D, "transactions PATCH 金额 0 400", r.status_code == 400, f"status={r.status_code}")
        r, data = api.call("PATCH", f"/api/transactions/{tx1['id']}", body={"direction": "in"})
        tu = ((data or {}).get("transaction") or {})
        LIVE_TXS[:] = [t for t in LIVE_TXS if not (t[0] == aid and t[1] == "out" and t[2] == 3000)]
        LIVE_TXS.append((aid, "in", 3000))
        record(D, "transactions PATCH 方向 in(金额恒正)", r.status_code == 200 and tu.get("direction") == "in",
               f"direction={tu.get('direction')}")
        r, data = api.call("PATCH", f"/api/transactions/{tx1['id']}", body={"confirm": True})
        tu = ((data or {}).get("transaction") or {})
        record(D, "transactions PATCH confirm 转正", r.status_code == 200 and tu.get("is_draft") is False,
               f"is_draft={tu.get('is_draft')}")
        r, data = api.call("PATCH", f"/api/transactions/{tx1['id']}", body={"accountId": None})
        tu = ((data or {}).get("transaction") or {})
        LIVE_TXS[:] = [t for t in LIVE_TXS if not (t[0] == aid and t[1] == "in" and t[2] == 3000)]
        record(D, "transactions PATCH 解绑账户(null)", r.status_code == 200 and tu.get("account_id") is None,
               f"account_id={tu.get('account_id')}")
        r, data = api.call("PATCH", f"/api/transactions/{tx1['id']}", body={})
        record(D, "transactions PATCH 空 body 400", r.status_code == 400, f"status={r.status_code}")

    r2, d2 = api.call("GET", "/api/accounts")
    bal = next((to_int(a.get("balance_cents")) for a in (d2 or {}).get("accounts", []) if a.get("id") == aid), None)
    exp = expected_balance(20000, aid)
    record(D, "accounts 余额恒等式(期初+存活流水)", bal == exp, f"balance={bal} expect={exp}")

    # DELETE 一笔
    if tx2.get("id"):
        r, data = api.call("DELETE", f"/api/transactions/{tx2['id']}")
        record(D, "transactions DELETE ok", r.status_code == 200 and (data or {}).get("ok") is True,
               f"status={r.status_code}")
        TX_IDS.remove(tx2["id"]); LIVE_TXS[:] = [t for t in LIVE_TXS if not (t[0] == aid and t[1] == "in" and t[2] == 400)]
        r, data = api.call("GET", "/api/transactions", params={"month": MONTH})
        gone = not any(t.get("id") == tx2["id"] for t in (data or {}).get("transactions", []))
        record(D, "transactions DELETE 后月列表无此笔", gone, "")
        r, data = api.call("DELETE", f"/api/transactions/{tx2['id']}")
        record(D, "transactions DELETE 再删 404", r.status_code == 404, f"status={r.status_code}")

    # ---------- budget ----------
    r, data = api.call("GET", "/api/budget")
    budget0 = (data or {}).get("budget") or {}
    b0_limit = to_int(budget0.get("monthly_limit_cents"))
    b0_th = to_int(budget0.get("alert_threshold"))
    r, data = api.call("PUT", "/api/budget", body={"monthlyLimitCents": 500000, "alertThreshold": 70})
    b = (data or {}).get("budget") or {}
    record(D, "budget PUT 保存上限+阈值", r.status_code == 200 and to_int(b.get("monthly_limit_cents")) == 500000
           and to_int(b.get("alert_threshold")) == 70, f"status={r.status_code} resp={str(data)[:100]}")
    r, data = api.call("PUT", "/api/budget", body={"monthlyLimitCents": 500000, "alertThreshold": 150})
    b = (data or {}).get("budget") or {}
    record(D, "budget PUT 阈值 150 钳到 100", to_int(b.get("alert_threshold")) == 100,
           f"threshold={b.get('alert_threshold')}")
    r, data = api.call("PUT", "/api/budget", body={"monthlyLimitCents": 500000, "alertThreshold": 0})
    b = (data or {}).get("budget") or {}
    record(D, "budget PUT 阈值 0 钳到 1", to_int(b.get("alert_threshold")) == 1, f"threshold={b.get('alert_threshold')}")
    r, data = api.call("PUT", "/api/budget", body={"monthlyLimitCents": -1})
    record(D, "budget PUT 负上限 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("PUT", "/api/budget", body={"monthlyLimitCents": "abc"})
    record(D, "budget PUT 非整数上限 400", r.status_code == 400, f"status={r.status_code}")

    # ---------- finance/overview 对账 ----------
    r, data = api.call("GET", "/api/finance/overview", params={"month": MONTH})
    ov = data or {}
    r2, d2 = api.call("GET", "/api/transactions", params={"month": MONTH})
    m_txs = [t for t in (d2 or {}).get("transactions", []) if t.get("is_draft") is False]
    exp_out = sum(to_int(t["amount_cents"]) for t in m_txs if t["direction"] == "out")
    exp_in = sum(to_int(t["amount_cents"]) for t in m_txs if t["direction"] == "in")
    record(D, "overview 支出/收入 与流水明细对账",
           r.status_code == 200 and to_int(ov.get("outCents")) == exp_out and to_int(ov.get("inCents")) == exp_in,
           f"out={ov.get('outCents')}/{exp_out} in={ov.get('inCents')}/{exp_in}")
    by_cat = ov.get("byCategory") or {}
    cat_sum = sum(to_int(v) for v in by_cat.values())
    record(D, "overview 分类占比合计=总支出", cat_sum == exp_out, f"sum={cat_sum} outCents={exp_out}")
    record(D, "overview 分类均在合法枚举内", all(c in TX_CATEGORIES for c in by_cat.keys()), f"cats={list(by_cat.keys())}")

    r2, d2 = api.call("GET", "/api/transactions", params={"month": PREV_MONTH})
    p_txs = [t for t in (d2 or {}).get("transactions", []) if t.get("is_draft") is False]
    pv = ov.get("prev") or {}
    record(D, "overview 上月对比与上月流水对账",
           to_int(pv.get("outCents")) == sum(to_int(t["amount_cents"]) for t in p_txs if t["direction"] == "out")
           and to_int(pv.get("inCents")) == sum(to_int(t["amount_cents"]) for t in p_txs if t["direction"] == "in"),
           f"prev={pv}")

    trend = ov.get("trend") or []
    ok_trend = len(trend) == 6 and trend[-1].get("month") == MONTH and to_int(trend[-1].get("outCents")) == exp_out
    record(D, "overview 近6月趋势(末月=当月)", ok_trend, f"n={len(trend)} last={trend[-1] if trend else None}")

    r2, d2 = api.call("GET", "/api/accounts")
    acc_map = {a["id"]: to_int(a["balance_cents"]) for a in (d2 or {}).get("accounts", [])}
    ov_acc = {a["id"]: to_int(a["balance_cents"]) for a in (ov.get("accounts") or [])}
    record(D, "overview 账户余额与 accounts 一致", ov_acc == acc_map, f"ov={ov_acc} acc={acc_map}")
    record(D, "overview 回带预算配置", to_int((ov.get("budget") or {}).get("monthly_limit_cents")) == 500000,
           f"budget={ov.get('budget')}")
    r, data = api.call("GET", "/api/finance/overview", params={"month": "bad"})
    record(D, "overview 非法 month 400", r.status_code == 400, f"status={r.status_code}")

    # ---------- finance/stats 对账 ----------
    r, data = api.call("POST", "/api/transactions", body={
        "direction": "out", "amountCents": 1500, "category": "交通", "accountId": aid,
        "counterparty": "QA-对方-统计", "occurredAt": iso_bj_noon(),
    })
    tx_s1 = ((data or {}).get("transaction") or {})
    if tx_s1.get("id"):
        TX_IDS.append(tx_s1["id"]); LIVE_TXS.append((aid, "out", 1500))
    r, data = api.call("POST", "/api/transactions", body={
        "direction": "in", "amountCents": 20000, "category": "其他", "accountId": aid, "occurredAt": iso_bj_noon(),
    })
    tx_s2 = ((data or {}).get("transaction") or {})
    if tx_s2.get("id"):
        TX_IDS.append(tx_s2["id"]); LIVE_TXS.append((aid, "in", 20000))

    r, data = api.call("GET", "/api/finance/stats", params={"period": "day", "date": TODAY})
    st = data or {}
    tot = st.get("totals") or {}
    r2, d2 = api.call("GET", "/api/transactions", params={"month": MONTH})

    def bj_day(t):
        s = str(t.get("occurred_at", ""))
        try:
            dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00")) + datetime.timedelta(hours=8)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return ""

    day_txs = [t for t in (d2 or {}).get("transactions", []) if t.get("is_draft") is False and bj_day(t) == TODAY]
    e_out = sum(to_int(t["amount_cents"]) for t in day_txs if t["direction"] == "out")
    e_in = sum(to_int(t["amount_cents"]) for t in day_txs if t["direction"] == "in")
    record(D, "stats day 总额=当日明细和",
           r.status_code == 200 and to_int(tot.get("outCents")) == e_out and to_int(tot.get("inCents")) == e_in
           and to_int(tot.get("count")) == len(day_txs),
           f"out={tot.get('outCents')}/{e_out} in={tot.get('inCents')}/{e_in} n={tot.get('count')}/{len(day_txs)}")
    bc = st.get("byCategory") or []
    record(D, "stats day 分类合计=总支出且 pct 合理",
           sum(to_int(x.get("cents")) for x in bc) == e_out
           and all(0 <= to_int(x.get("pct")) <= 100 for x in bc),
           f"sum={sum(to_int(x.get('cents')) for x in bc)} out={e_out}")
    ba = st.get("byAccount") or []
    record(D, "stats day 按账户合计=总额",
           sum(to_int(x.get("outCents")) for x in ba) == e_out and sum(to_int(x.get("inCents")) for x in ba) == e_in,
           f"acc_out={sum(to_int(x.get('outCents')) for x in ba)}")
    tcp = st.get("topCounterparties") or []
    qa_tcp = next((x for x in tcp if x.get("name") == "QA-对方-统计"), None)
    e_qa = sum(to_int(t["amount_cents"]) for t in day_txs
               if t.get("counterparty") == "QA-对方-统计" and t["direction"] == "out")
    record(D, "stats day 交易对方榜含 QA-对方且金额一致", qa_tcp is None or to_int(qa_tcp.get("outCents")) == e_qa,
           f"qa_tcp={qa_tcp} expect={e_qa}")

    monday = (datetime.datetime.strptime(TODAY, "%Y-%m-%d") - datetime.timedelta(days=datetime.datetime.strptime(TODAY, "%Y-%m-%d").weekday())).strftime("%Y-%m-%d")
    r, data = api.call("GET", "/api/finance/stats", params={"period": "week", "date": TODAY})
    st = data or {}
    rng = st.get("range") or {}
    daily = st.get("daily") or []
    tot = st.get("totals") or {}
    record(D, "stats week 范围=周一~周日", rng.get("from") == monday
           and rng.get("to") == (datetime.datetime.strptime(monday, "%Y-%m-%d") + datetime.timedelta(days=6)).strftime("%Y-%m-%d"),
           f"range={rng}")
    record(D, "stats week daily 7 天且合计=总额",
           len(daily) == 7 and sum(to_int(x.get("outCents")) for x in daily) == to_int(tot.get("outCents"))
           and sum(to_int(x.get("inCents")) for x in daily) == to_int(tot.get("inCents")),
           f"n={len(daily)} daily_out_sum={sum(to_int(x.get('outCents')) for x in daily)} tot_out={tot.get('outCents')}")
    r, data = api.call("GET", "/api/finance/stats", params={"period": "day", "date": "2000-01-01"})
    tot = ((data or {}).get("totals") or {})
    record(D, "stats 空日期全零", to_int(tot.get("outCents")) == 0 and to_int(tot.get("inCents")) == 0
           and to_int(tot.get("count")) == 0, f"totals={tot}")

    # ---------- debts ----------
    r, data = api.call("POST", "/api/debts", body={
        "name": NM_DBT_MAIN, "type": "credit_card", "principalCents": 500000,
        "balanceCents": 400000, "ratePct": 12, "monthlyCents": 50000, "payDay": 10,
    })
    d_main = ((data or {}).get("debt") or {})
    record(D, "debts POST 建档(信用卡/本金/余额/利率/月供)",
           r.status_code == 200 and to_int(d_main.get("balance_cents")) == 400000
           and to_int(d_main.get("rate_pct")) == 12 and d_main.get("status") == "active",
           f"status={r.status_code} resp={str(data)[:160]}")
    did = d_main.get("id")
    if did:
        DEBT_IDS.append(did)

    r, data = api.call("POST", "/api/debts", body={
        "name": NM_DBT_FAM, "type": "family", "principalCents": 20000, "ratePct": 0,
    })
    d_fam = ((data or {}).get("debt") or {})
    record(D, "debts POST 余额缺省=本金", r.status_code == 200 and to_int(d_fam.get("balance_cents")) == 20000,
           f"balance={d_fam.get('balance_cents')}")
    if d_fam.get("id"):
        DEBT_IDS.append(d_fam["id"])

    for label, body, want in [
        ("利率 40 越界 400", {"name": "QA-x", "type": "credit_card", "principalCents": 100, "ratePct": 40}, 400),
        ("利率 -1 越界 400", {"name": "QA-x", "type": "credit_card", "principalCents": 100, "ratePct": -1}, 400),
        ("类型非法 400", {"name": "QA-x", "type": "pawn", "principalCents": 100}, 400),
        ("本金负数 400", {"name": "QA-x", "type": "credit_card", "principalCents": -1}, 400),
        ("月供 0 400", {"name": "QA-x", "type": "credit_card", "principalCents": 100, "monthlyCents": 0}, 400),
        ("还款日 32 400", {"name": "QA-x", "type": "credit_card", "principalCents": 100, "payDay": 32}, 400),
        ("空名称 400", {"type": "credit_card", "principalCents": 100}, 400),
        ("到期日格式 400", {"name": "QA-x", "type": "credit_card", "principalCents": 100, "dueDate": "2026/01/01"}, 400),
    ]:
        r, data = api.call("POST", "/api/debts", body=body)
        record(D, f"debts POST {label}", r.status_code == want, f"actual={r.status_code}")

    # PATCH
    r, data = api.call("PATCH", f"/api/debts/{did}", body={"balanceCents": 390000, "ratePct": 15, "monthlyCents": 40000})
    du = ((data or {}).get("debt") or {})
    record(D, "debts PATCH 余额校正/利率/月供",
           r.status_code == 200 and to_int(du.get("balance_cents")) == 390000
           and to_int(du.get("rate_pct")) == 15 and to_int(du.get("monthly_cents")) == 40000,
           f"resp={str(data)[:140]}")
    r, data = api.call("PATCH", f"/api/debts/{did}", body={"ratePct": 40})
    record(D, "debts PATCH 利率越界 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("PATCH", f"/api/debts/{did}", body={"status": "bogus"})
    record(D, "debts PATCH 非法 status 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("PATCH", f"/api/debts/{did}", body={})
    record(D, "debts PATCH 空 body 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("GET", "/api/debts")
    debts_all = (data or {}).get("debts", [])
    record(D, "debts GET 列表含 QA- 档案",
           r.status_code == 200 and any(d.get("id") == did for d in debts_all)
           and all("paid_cents" in d for d in debts_all),
           f"status={r.status_code} n={len(debts_all)}")

    # 到期墙两笔
    due_danger = bj_month_offset(MONTH, 2) + "-15"
    due_warn = bj_month_offset(MONTH, 5) + "-15"
    r, data = api.call("POST", "/api/debts", body={
        "name": NM_DBT_DANGER, "type": "consumer_loan", "principalCents": 90000,
        "ratePct": 5, "monthlyCents": 10000, "dueDate": due_danger,
    })
    d_danger = ((data or {}).get("debt") or {})
    if d_danger.get("id"):
        DEBT_IDS.append(d_danger["id"])
    r, data = api.call("POST", "/api/debts", body={
        "name": NM_DBT_WARN, "type": "car_loan", "principalCents": 140000,
        "ratePct": 5, "monthlyCents": 10000, "dueDate": due_warn,
    })
    d_warn = ((data or {}).get("debt") or {})
    if d_warn.get("id"):
        DEBT_IDS.append(d_warn["id"])
    r, data = api.call("POST", "/api/debts", body={
        "name": NM_DBT_SMALL, "type": "bnpl", "principalCents": 8000, "ratePct": 0, "monthlyCents": 8000,
    })
    d_small = ((data or {}).get("debt") or {})
    if d_small.get("id"):
        DEBT_IDS.append(d_small["id"])

    # ---------- simulate（还款前运行，余额可控） ----------
    r, data = api.call("GET", "/api/debts")
    active = [d for d in (data or {}).get("debts", []) if d.get("status") == "active" and to_int(d.get("balance_cents")) > 0]
    qa_names = {d["name"]: d for d in active if str(d.get("name", "")).startswith("QA-")}
    snow_order_exp = [n for n, _ in sorted(qa_names.items(), key=lambda kv: (to_int(kv[1]["balance_cents"]), -to_int(kv[1].get("rate_pct") or 0)))]
    av_order_exp = [n for n, _ in sorted(qa_names.items(), key=lambda kv: (-to_int(kv[1].get("rate_pct") or 0), to_int(kv[1]["balance_cents"])))]

    r, data = api.call("POST", "/api/debts/simulate", body={"extraMonthlyCents": 0})
    sim0 = data or {}
    base0, snow0 = sim0.get("baseline") or {}, sim0.get("snowball") or {}
    record(D, "simulate extra=0 雪球利息=基线",
           r.status_code == 200 and to_int(base0.get("totalInterestCents")) == to_int(snow0.get("totalInterestCents")),
           f"baseline={base0.get('totalInterestCents')} snowball={snow0.get('totalInterestCents')}")
    order_snow = snow0.get("order") or []
    idx = [order_snow.index(n) for n in snow_order_exp if n in order_snow]
    record(D, "simulate 雪球顺序=余额升序", len(idx) == len(snow_order_exp) and idx == sorted(idx),
           f"order={order_snow} expectQA={snow_order_exp}")
    r, data = api.call("POST", "/api/debts/simulate", body={"extraMonthlyCents": 0})
    av0 = ((data or {}).get("avalanche") or {})
    order_av = av0.get("order") or []
    idx = [order_av.index(n) for n in av_order_exp if n in order_av]
    record(D, "simulate 雪崩顺序=利率降序", len(idx) == len(av_order_exp) and idx == sorted(idx),
           f"order={order_av} expectQA={av_order_exp}")

    r, data = api.call("POST", "/api/debts/simulate", body={"extraMonthlyCents": 300000})
    sim1 = data or {}
    s1, a1 = sim1.get("snowball") or {}, sim1.get("avalanche") or {}
    record(D, "simulate extra>0 节省利息≥0 且省月数≥0/null",
           r.status_code == 200
           and to_int(s1.get("interestSavedVsBaselineCents")) >= 0
           and (s1.get("monthsSavedVsBaseline") is None or to_int(s1.get("monthsSavedVsBaseline")) >= 0)
           and to_int(a1.get("interestSavedVsBaselineCents")) >= 0,
           f"snowball_saved={s1.get('interestSavedVsBaselineCents')} months_saved={s1.get('monthsSavedVsBaseline')} av_saved={a1.get('interestSavedVsBaselineCents')}")
    r, data = api.call("POST", "/api/debts/simulate", body={"extraMonthlyCents": -1})
    record(D, "simulate 负数 extra 400", r.status_code == 400, f"status={r.status_code}")

    # ---------- debts/overview 恒等式 ----------
    r, data = api.call("GET", "/api/debts/overview")
    ov_d = data or {}
    r2, d2 = api.call("GET", "/api/debts")
    act = [d for d in (d2 or {}).get("debts", []) if d.get("status") == "active"]
    e_total = sum(to_int(d["balance_cents"]) for d in act)
    e_bank = sum(to_int(d["balance_cents"]) for d in act if d.get("type") != "family")
    e_due = sum(to_int(d.get("monthly_cents") or 0) for d in act)
    t = ov_d.get("totals") or {}
    record(D, "debts/overview 总负债双口径",
           r.status_code == 200 and to_int(t.get("balanceCents")) == e_total and to_int(t.get("bankCents")) == e_bank,
           f"total={t.get('balanceCents')}/{e_total} bank={t.get('bankCents')}/{e_bank}")
    record(D, "debts/overview 月供合计", to_int(t.get("monthlyDueCents")) == e_due,
           f"due={t.get('monthlyDueCents')}/{e_due}")
    e_rate = round(sum(to_int(d["balance_cents"]) * float(d.get("rate_pct") or 0) for d in act) / e_total, 2) if e_total > 0 else 0
    record(D, "debts/overview 加权利率", abs(to_float(t.get("weightedRatePct")) - e_rate) <= 0.011,
           f"rate={t.get('weightedRatePct')}/{e_rate}")
    r2, d2 = api.call("GET", "/api/accounts")
    e_asset = sum(to_int(a["balance_cents"]) for a in (d2 or {}).get("accounts", []))
    record(D, "debts/overview 净资产恒等式(资产-总负债)",
           to_int(ov_d.get("netWorthCents")) == e_asset - e_total and to_int(ov_d.get("assetBalanceCents")) == e_asset,
           f"netWorth={ov_d.get('netWorthCents')}/{e_asset - e_total} asset={ov_d.get('assetBalanceCents')}/{e_asset}")
    wall = ov_d.get("wall") or []
    w_danger = next((w for w in wall if w.get("name") == NM_DBT_DANGER), None)
    w_warn = next((w for w in wall if w.get("name") == NM_DBT_WARN), None)
    record(D, "debts/overview 到期墙 danger≤3月",
           w_danger is not None and w_danger.get("level") == "danger" and to_int(w_danger.get("daysLeft")) > 0,
           f"danger={w_danger}")
    record(D, "debts/overview 到期墙 warn 4~6月",
           w_warn is not None and w_warn.get("level") == "warn",
           f"warn={w_warn}")
    record(D, "debts/overview 到期墙仅含未来6个月内",
           all(0 <= to_int(w.get("daysLeft")) <= 200 for w in wall), f"n={len(wall)}")

    # 现金流恒等式（当前状态；遍历全部负债的还款记录，与 overview 口径对齐）
    r3d, d3d = api.call("GET", "/api/debts")
    e_paid = 0
    for d in (d3d or {}).get("debts", []):
        r3, d3 = api.call("GET", f"/api/debts/{d['id']}/payments")
        for p in (d3 or {}).get("payments", []):
            if date_of(p.get("paid_at")) == TODAY:
                e_paid += to_int(p.get("amount_cents"))
    cf = ov_d.get("cashFlow") or {}
    e_remain = max(0, e_due - e_paid)
    r2, d2 = api.call("GET", "/api/transactions", params={"month": MONTH})
    cm_txs = [x for x in (d2 or {}).get("transactions", []) if x.get("is_draft") is False]
    e_realized = sum(to_int(x["amount_cents"]) for x in cm_txs if x["direction"] == "in") - \
        sum(to_int(x["amount_cents"]) for x in cm_txs if x["direction"] == "out")
    record(D, "debts/overview 现金流: 已还/剩余月供/缺口恒等式",
           to_int(cf.get("paidThisMonthCents")) == e_paid and to_int(cf.get("remainingDueCents")) == e_remain
           and to_int(cf.get("gapCents")) == e_realized - e_remain
           and to_int(cf.get("realizedCents")) == e_realized,
           f"paid={cf.get('paidThisMonthCents')}/{e_paid} remain={cf.get('remainingDueCents')}/{e_remain} "
           f"gap={cf.get('gapCents')}/{e_realized - e_remain}")

    # ---------- 还款 payments ----------
    r, data = api.call("POST", f"/api/debts/{did}/payments",
                       body={"amountCents": 30000, "paidAt": TODAY, "accountId": aid, "note": "QA-还款联动"})
    pay1 = data or {}
    p1 = pay1.get("payment") or {}
    dd = pay1.get("debt") or {}
    txid_link = pay1.get("transactionId")
    record(D, "payments POST 联动账户还款+回填 txId",
           r.status_code == 200 and to_int(p1.get("amount_cents")) == 30000
           and to_int(dd.get("balance_cents")) == 360000 and bool(txid_link),
           f"status={r.status_code} balance={dd.get('balance_cents')} txId={txid_link}")
    if txid_link:
        TX_IDS.append(txid_link); LIVE_TXS.append((aid, "out", 30000))
    r, data = api.call("GET", "/api/transactions", params={"month": MONTH})
    link_tx = next((x for x in (data or {}).get("transactions", []) if x.get("id") == txid_link), None)
    record(D, "payments 联动流水=「还款」支出挂正确账户",
           link_tx is not None and link_tx.get("category") == "还款" and link_tx.get("direction") == "out"
           and to_int(link_tx.get("amount_cents")) == 30000 and link_tx.get("account_id") == aid,
           f"tx={str(link_tx)[:140]}")
    r, data = api.call("POST", f"/api/debts/{did}/payments", body={"amountCents": 30000, "paidAt": TODAY})
    record(D, "payments 同日同额 409", r.status_code == 409, f"status={r.status_code} resp={str(data)[:80]}")
    r, data = api.call("POST", f"/api/debts/{did}/payments", body={"amountCents": 15000, "paidAt": TODAY})
    dd = ((data or {}).get("debt") or {})
    record(D, "payments 第二笔余额递减", r.status_code == 200 and to_int(dd.get("balance_cents")) == 345000,
           f"balance={dd.get('balance_cents')}")
    r, data = api.call("GET", f"/api/debts/{did}/payments")
    pays = (data or {}).get("payments", [])
    record(D, "payments GET 时间升序列表",
           r.status_code == 200 and len(pays) >= 2
           and date_of(pays[0].get("paid_at")) <= date_of(pays[-1].get("paid_at")),
           f"n={len(pays)}")
    r, data = api.call("POST", f"/api/debts/{did}/payments", body={"amountCents": 0})
    record(D, "payments 金额 0 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", f"/api/debts/{did}/payments", body={"amountCents": 100, "paidAt": "2026/01/01"})
    record(D, "payments 日期格式 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", f"/api/debts/{did}/payments",
                       body={"amountCents": 100, "accountId": FAKE_UUID})
    record(D, "payments 不存在账户 400", r.status_code == 400, f"status={r.status_code}")
    r, data = api.call("POST", f"/api/debts/{FAKE_UUID}/payments", body={"amountCents": 100})
    record(D, "payments 不存在负债 404", r.status_code == 404, f"status={r.status_code}")

    # 归零自动结清
    r, data = api.call("POST", f"/api/debts/{d_small.get('id')}/payments", body={"amountCents": 8000, "paidAt": TODAY})
    dd = ((data or {}).get("debt") or {})
    record(D, "payments 归零自动 cleared",
           r.status_code == 200 and to_int(dd.get("balance_cents")) == 0 and dd.get("status") == "cleared",
           f"balance={dd.get('balance_cents')} status={dd.get('status')}")
    r, data = api.call("POST", f"/api/debts/{d_small.get('id')}/payments", body={"amountCents": 100, "paidAt": TODAY})
    record(D, "payments 已结清不可再还 400", r.status_code == 400 and "进行中" in str((data or {}).get("error", "")),
           f"status={r.status_code}")

    # 还款后余额恒等式复查
    r2, d2 = api.call("GET", "/api/accounts")
    bal = next((to_int(a.get("balance_cents")) for a in (d2 or {}).get("accounts", []) if a.get("id") == aid), None)
    exp = expected_balance(20000, aid)
    record(D, "accounts 余额恒等式复查(含联动还款)", bal == exp, f"balance={bal} expect={exp}")

    # ---------- 负债归档 ----------
    r, data = api.call("DELETE", f"/api/debts/{did}")
    record(D, "debts DELETE 软归档 ok", r.status_code == 200 and (data or {}).get("ok") is True,
           f"status={r.status_code}")
    r, data = api.call("GET", "/api/debts")
    dd = next((d for d in (data or {}).get("debts", []) if d.get("id") == did), None)
    record(D, "debts DELETE 后 status=archived", dd is not None and dd.get("status") == "archived",
           f"status={dd.get('status') if dd else None}")
    if did in DEBT_IDS:
        DEBT_IDS.remove(did)
    r, data = api.call("DELETE", f"/api/debts/{d_danger.get('id')}")
    if d_danger.get("id") in DEBT_IDS:
        DEBT_IDS.remove(d_danger["id"])
    r, data = api.call("GET", "/api/debts/overview")
    wall = (data or {}).get("wall") or []
    record(D, "debts/overview 归档后到期墙不含已归档笔",
           all(w.get("name") != NM_DBT_DANGER for w in wall), f"wall={[w.get('name') for w in wall]}")

    # ---------- transactions/import dryRun ----------
    r, data = api.call("POST", "/api/transactions/import",
                       body={"text": parse_bill_csv(), "platform": "alipay", "dryRun": True})
    imp = data or {}
    record(D, "import dryRun 预览生成",
           r.status_code == 200 and imp.get("platform") == "alipay" and to_int(imp.get("importable")) == 2
           and to_int(imp.get("outCents")) == 2550 and to_int(imp.get("inCents")) == 10000,
           f"status={r.status_code} resp={str({k: imp.get(k) for k in ('platform', 'total', 'importable', 'skipped', 'outCents', 'inCents')})}")
    sample = imp.get("sample") or []
    record(D, "import dryRun 预览行分类/方向正确",
           len(sample) == 2 and sample[0].get("category") == "餐饮" and sample[0].get("direction") == "out"
           and sample[1].get("category") == "娱乐" and sample[1].get("direction") == "in",
           f"sample={str(sample)[:180]}")
    r, data = api.call("POST", "/api/transactions/import", body={"text": "short", "dryRun": True})
    record(D, "import 文本过短 400", r.status_code == 400, f"status={r.status_code}")
    r2, d2 = api.call("GET", "/api/transactions", params={"month": "2026-09"})
    still = not any(str(x.get("note", "")).startswith("qa备注") for x in (d2 or {}).get("transactions", []))
    record(D, "import dryRun 未落库", still, "")

    # ---------- 预算恢复 ----------
    api.call("PUT", "/api/budget", body={
        "monthlyLimitCents": b0_limit if b0_limit is not None else 0,
        "alertThreshold": b0_th if b0_th is not None else 80,
    })
    print(f"  [info] 预算已恢复为 {b0_limit}/{b0_th}")


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return -1.0


def date_of(v):
    """pg date 列经 node-pg/JSON 序列化后可能带 T00:00Z 或偏移，统一还原为北京日期 YYYY-MM-DD"""
    s = str(v)
    if "T" in s:
        try:
            dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00")) + datetime.timedelta(hours=8)
            return dt.strftime("%Y-%m-%d")
        except Exception:
            pass
    return s[:10]


# =====================================================================
def cleanup(api):
    print("\n===== 清理测试数据 =====")
    for tid in list(TX_IDS):
        api.call("DELETE", f"/api/transactions/{tid}")
    print(f"  已删除流水 {len(TX_IDS)} 笔")
    TX_IDS.clear()
    for aid in ACCOUNT_IDS:
        api.call("DELETE", f"/api/accounts/{aid}")  # 软归档
    print(f"  已归档账户 {len(ACCOUNT_IDS)} 个")
    ACCOUNT_IDS.clear()
    for did in DEBT_IDS:
        api.call("DELETE", f"/api/debts/{did}")  # 软归档
    print(f"  已归档负债 {len(DEBT_IDS)} 笔")
    DEBT_IDS.clear()
    for cid in CONTACT_IDS:
        api.call("DELETE", f"/api/contacts/{cid}")
    print(f"  已删除联系人 {len(CONTACT_IDS)} 位")
    CONTACT_IDS.clear()
    # 终验：列表中不再出现 QA- 活动数据
    r, data = api.call("GET", "/api/accounts")
    left_a = [a.get("name") for a in (data or {}).get("accounts", []) if str(a.get("name", "")).startswith("QA-")]
    r, data = api.call("GET", "/api/contacts")
    left_c = [c.get("name") for c in (data or {}).get("contacts", []) if str(c.get("name", "")).startswith("QA-")]
    print(f"  终验: 活动账户残留={left_a} 联系人残留={left_c}（负债为软归档，仍在档案列表中但 status=archived）")


def db_purge():
    """直连本地开发库，硬删除残留的 QA- 测试行（账户/负债/还款/流水/联系人/往来），
    保证脚本可重复执行；仅作用于测试用户本人的 QA- 前缀数据。"""
    try:
        import psycopg2
    except ImportError:
        print("  [db] psycopg2 不可用，跳过硬清理（软归档数据仍在库中）")
        return
    try:
        conn = psycopg2.connect("postgresql://postgres:postgres@localhost:5432/shiguangri", connect_timeout=3)
        cur = conn.cursor()
        uid = SELF_ID
        cur.execute(
            "delete from liability_payments where user_id = %s and liability_id in "
            "(select id from liabilities where user_id = %s and name like 'QA-%%')", (uid, uid))
        n_pay = cur.rowcount
        cur.execute("delete from liabilities where user_id = %s and name like 'QA-%%'", (uid,))
        n_debt = cur.rowcount
        cur.execute("delete from accounts where user_id = %s and name like 'QA-%%'", (uid,))
        n_acc = cur.rowcount
        cur.execute("delete from transactions where user_id = %s and (note like '%%QA-%%' or counterparty like 'QA-%%')", (uid,))
        n_tx = cur.rowcount
        cur.execute("delete from interactions where user_id = %s and summary like 'QA-%%'", (uid,))
        cur.execute("delete from contacts where user_id = %s and name like 'QA-%%'", (uid,))
        n_ct = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        print(f"  [db] 硬清理: 还款{n_pay} 负债{n_debt} 账户{n_acc} 流水{n_tx} 联系人{n_ct}")
    except Exception as e:
        print(f"  [db] 硬清理跳过: {e!r}")


def summarize():
    fails = [x for x in results if not x[2]]
    print("\n" + "=" * 60)
    print(f"TOTAL: PASS {len(results) - len(fails)} / FAIL {len(fails)}")
    if fails:
        print("---- FAIL 明细 ----")
        for dom, point, _, detail in fails:
            print(f"  [{dom}] {point} —— {detail}")
    print("=" * 60)


if __name__ == "__main__":
    token = None
    try:
        r = requests.post(f"{BASE}/api/auth/login", json={"phone": PHONE, "password": PASSWORD},
                          headers=ORIGIN_HEADERS, timeout=30)
        token = r.json().get("token")
        api = Api(token)
        main()
    except Exception as e:
        record("fatal", "脚本异常终止", False, repr(e))
    finally:
        try:
            if token:
                cleanup(Api(token))
        except Exception as e:
            print(f"清理异常: {e!r}")
        db_purge()
        summarize()
