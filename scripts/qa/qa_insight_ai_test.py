# -*- coding: utf-8 -*-
"""
「拾光」个人经营系统 —— insight（复盘/工作台/提醒）+ ai（AI 内核管理）全量 API 验收测试
- Base: http://127.0.0.1:3100，admin 账号（AI 复盘不受配额限制）
- AI 生成类调用 ≤ 6 次：day(生成+refresh) / week / month / year 各一次真实生成，其余为缓存命中
- 结束状态保证：ai-mode=shadow、trade_review_week prompt 恢复默认、无遗留覆盖（try/finally 兜底）
"""
import datetime
import json
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:3100"
ORIGIN = "http://127.0.0.1:3100"
PHONE, PASSWORD = "13800003366", "test3f-pass"

results = []  # (编号, 名称, ok, evidence)
ai_generations = 0  # 真实触发 LLM 生成的次数（审计用）


def record(tid, name, ok, evidence):
    results.append((tid, name, bool(ok), evidence))
    print(f"[{'PASS' if ok else 'FAIL'}] {tid} {name}")
    print(f"       证据: {evidence}")


def req(method, path, body=None, token=None, timeout=90):
    """返回 (status, json_dict_or_None, raw_text)"""
    headers = {
        "Content-Type": "application/json",
        "Origin": ORIGIN,
        "Sec-Fetch-Site": "same-origin",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(raw), raw
            except Exception:
                return resp.status, None, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw), raw
        except Exception:
            return e.code, None, raw


def clip(s, n=120):
    s = str(s).replace("\n", "\\n")
    return s if len(s) <= n else s[:n] + "…"


def bj_now():
    return datetime.datetime.utcnow() + datetime.timedelta(hours=8)


def monday_of(d):
    return d - datetime.timedelta(days=d.weekday())


# ============================== 准备 ==============================
now_bj = bj_now()
TODAY = now_bj.strftime("%Y-%m-%d")
WEEK_MONDAY = monday_of(now_bj.date()).strftime("%Y-%m-%d")
MONTH = now_bj.strftime("%Y-%m")
YEAR = now_bj.strftime("%Y")
print(f"== 北京时间锚点：today={TODAY} weekMonday={WEEK_MONDAY} month={MONTH} year={YEAR} ==")

st, login, _ = req("POST", "/api/auth/login", {"phone": PHONE, "password": PASSWORD})
if st != 200 or not login or not login.get("token"):
    print(f"FATAL: 登录失败 status={st} resp={login}")
    sys.exit(1)
TOKEN = login["token"]
record("S0", "登录获取 token", True, f"status=200, user={login.get('user')}")

try:
    # ============================== insight 域 ==============================
    print("\n===== insight 域 =====")

    # ---- I1 GET /api/today ----
    st, d, _ = req("GET", "/api/today", token=TOKEN)
    keys_ok = st == 200 and d and all(k in d for k in ("todos", "doneToday", "blocks", "activities", "todayKcal"))
    lists_ok = keys_ok and all(isinstance(d[k], list) for k in ("todos", "doneToday", "blocks", "activities"))
    kcal_ok = keys_ok and isinstance(d["todayKcal"], int) and d["todayKcal"] >= 0
    child_ok = all(isinstance(t.get("children"), list) for t in d.get("todos", []))
    record("I1", "GET /api/today 今日工作台聚合（结构完整）", keys_ok and lists_ok and kcal_ok and child_ok,
           f"status={st}, keys={'ok' if keys_ok else list(d.keys()) if d else None}, "
           f"todos={len(d.get('todos', []))}, doneToday={len(d.get('doneToday', []))}, "
           f"blocks={len(d.get('blocks', []))}, activities={len(d.get('activities', []))}, "
           f"todayKcal={d.get('todayKcal')}, children字段={'ok' if child_ok else '缺'}")

    # ---- I2 GET /api/reminders ----
    st, d, _ = req("GET", "/api/reminders", token=TOKEN)
    ok = st == 200 and d and isinstance(d.get("contacts"), list) and isinstance(d.get("todos"), list)
    contact_shape = ok and all(("id" in c and "name" in c) for c in d["contacts"])
    todo_shape = ok and all(("id" in t and "title" in t and "remind_at" in t) for t in d["todos"])
    due_ok = True
    if ok:
        now_dt = datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc)
        for t in d["todos"]:
            ra = t.get("remind_at")
            if not ra:
                due_ok = False
                break
            try:
                if datetime.datetime.fromisoformat(ra.replace("Z", "+00:00")) > now_dt:
                    due_ok = False
                    break
            except Exception:
                pass
    record("I2", "GET /api/reminders 提醒聚合（生日/待办到期，空数据不炸）", ok and contact_shape and todo_shape and due_ok,
           f"status={st}, contacts={len(d.get('contacts', []))} 条(首条样例={clip(d['contacts'][0] if d and d['contacts'] else '空', 80)}), "
           f"todos={len(d.get('todos', []))} 条, remind_at均<=now={'是' if due_ok else '否'}")

    # ---- I3/I4 review/day 边界 ----
    st, d, _ = req("POST", "/api/review/day", {}, token=TOKEN)
    ok3 = st == 400 and d and "date" in (d.get("error") or "")
    record("I3", "POST /api/review/day 缺 date → 400", ok3, f"status={st}, body={clip(d)}")

    st, d, _ = req("POST", "/api/review/day", {"date": "2026/09/22"}, token=TOKEN)
    ok4 = st == 400 and d and "date" in (d.get("error") or "")
    record("I4", "POST /api/review/day 非法 date → 400", ok4, f"status={st}, body={clip(d)}")

    # ---- I5 review/day 生成（真实 GLM）----
    time.sleep(2)
    st, d, _ = req("POST", "/api/review/day", {"date": TODAY}, token=TOKEN, timeout=90)
    gen_ok = st == 200 and d and isinstance(d.get("review"), dict)
    shape_ok = gen_ok and isinstance(d["review"].get("summary"), str) and d["review"]["summary"].strip() \
        and isinstance(d["review"].get("highlights"), list) and isinstance(d["review"].get("suggestions"), list)
    first_summary = d["review"]["summary"] if gen_ok else None
    if gen_ok and not d.get("cached"):
        ai_generations += 1
    record("I5", f"POST /api/review/day {TODAY} AI 日小结生成", gen_ok and shape_ok,
           f"status={st}, cached={d.get('cached') if d else None}, summary={clip(first_summary, 80)}, "
           f"highlights={len(d['review'].get('highlights', [])) if gen_ok else '-'}, "
           f"suggestions={len(d['review'].get('suggestions', [])) if gen_ok else '-'}, "
           f"facts={{timeParts:{len(d.get('facts', {}).get('timeParts', [])) if d else '-'}, todoDone:{d.get('facts', {}).get('todoDone', '-') if d else '-'}}}")

    # ---- I6 review/day 缓存命中 ----
    st, d, _ = req("POST", "/api/review/day", {"date": TODAY}, token=TOKEN, timeout=90)
    hit_ok = st == 200 and d and d.get("cached") is True and d["review"].get("summary") == first_summary
    record("I6", "POST /api/review/day 同参数复验 → cached=true 且 summary 一致", hit_ok,
           f"status={st}, cached={d.get('cached') if d else None}, "
           f"summary一致={d.get('review', {}).get('summary') == first_summary if d else False}")

    # ---- I7 review/day refresh=true 强制重新生成 ----
    time.sleep(2)
    st, d, _ = req("POST", "/api/review/day", {"date": TODAY, "refresh": True}, token=TOKEN, timeout=90)
    ref_ok = st == 200 and d and d.get("cached") is False and isinstance(d.get("review"), dict)
    if ref_ok:
        ai_generations += 1
    refresh_summary = d["review"]["summary"] if ref_ok else None
    record("I7", "POST /api/review/day refresh=true 强制重新生成", ref_ok,
           f"status={st}, cached={d.get('cached') if d else None}, summary={clip(refresh_summary, 80)}")

    # ---- I8 review/week 边界 ----
    st, d, _ = req("POST", "/api/review/week", {}, token=TOKEN)
    ok8 = st == 400 and d and "date" in (d.get("error") or "")
    record("I8", "POST /api/review/week 缺 date → 400", ok8, f"status={st}, body={clip(d)}")

    # ---- I9 review/week 生成 ----
    time.sleep(2)
    st, d, _ = req("POST", "/api/review/week", {"date": TODAY}, token=TOKEN, timeout=120)
    wk_gen = st == 200 and d and isinstance(d.get("review"), dict)
    rng_ok = wk_gen and d.get("range", {}).get("from") == WEEK_MONDAY
    week_summary = d["review"]["summary"] if wk_gen else None
    if wk_gen and not d.get("cached"):
        ai_generations += 1
    record("I9", f"POST /api/review/week {TODAY} AI 周报生成", wk_gen and rng_ok,
           f"status={st}, cached={d.get('cached') if d else None}, range={d.get('range') if d else None}, "
           f"from==周一({WEEK_MONDAY})={'是' if rng_ok else '否'}, summary={clip(week_summary, 80)}")

    # ---- I10 review/week 缓存命中 ----
    st, d, _ = req("POST", "/api/review/week", {"date": TODAY}, token=TOKEN, timeout=120)
    hit_ok = st == 200 and d and d.get("cached") is True and d["review"].get("summary") == week_summary
    record("I10", "POST /api/review/week 同参数复验 → cached=true 且 summary 一致", hit_ok,
           f"status={st}, cached={d.get('cached') if d else None}, "
           f"summary一致={d.get('review', {}).get('summary') == week_summary if d else False}")

    # ---- I11 review/month 边界 ----
    st, d, _ = req("POST", "/api/review/month", {}, token=TOKEN)
    b1 = st == 400 and d and "month" in (d.get("error") or "")
    st2, d2, _ = req("POST", "/api/review/month", {"month": "2026-9"}, token=TOKEN)
    b2 = st2 == 400 and d2 and "month" in (d2.get("error") or "")
    record("I11", "POST /api/review/month 缺/非法 month → 400", b1 and b2,
           f"缺month: status={st}, body={clip(d)}；非法month(2026-9): status={st2}, body={clip(d2)}")

    # ---- I12 review/month 生成 ----
    time.sleep(2)
    st, d, _ = req("POST", "/api/review/month", {"month": MONTH}, token=TOKEN, timeout=150)
    mo_gen = st == 200 and d and isinstance(d.get("review"), dict)
    month_summary = d["review"]["summary"] if mo_gen else None
    if mo_gen and not d.get("cached"):
        ai_generations += 1
    record("I12", f"POST /api/review/month {MONTH} AI 月报生成", mo_gen,
           f"status={st}, cached={d.get('cached') if d else None}, range={d.get('range') if d else None}, "
           f"summary={clip(month_summary, 80)}, sections={len(d['review'].get('sections', [])) if mo_gen else '-'}")

    # ---- I13 review/month 缓存命中 ----
    st, d, _ = req("POST", "/api/review/month", {"month": MONTH}, token=TOKEN, timeout=150)
    hit_ok = st == 200 and d and d.get("cached") is True and d["review"].get("summary") == month_summary
    record("I13", "POST /api/review/month 同参数复验 → cached=true 且 summary 一致", hit_ok,
           f"status={st}, cached={d.get('cached') if d else None}, "
           f"summary一致={d.get('review', {}).get('summary') == month_summary if d else False}")

    # ---- I14 review/year 边界 ----
    st, d, _ = req("POST", "/api/review/year", {}, token=TOKEN)
    b1 = st == 400 and d and "year" in (d.get("error") or "")
    st2, d2, _ = req("POST", "/api/review/year", {"year": "26"}, token=TOKEN)
    b2 = st2 == 400 and d2 and "year" in (d2.get("error") or "")
    record("I14", "POST /api/review/year 缺/非法 year → 400", b1 and b2,
           f"缺year: status={st}, body={clip(d)}；非法year(26): status={st2}, body={clip(d2)}")

    # ---- I15 review/year 生成 ----
    time.sleep(2)
    st, d, _ = req("POST", "/api/review/year", {"year": YEAR}, token=TOKEN, timeout=200)
    yr_gen = st == 200 and d and isinstance(d.get("review"), dict)
    year_summary = d["review"]["summary"] if yr_gen else None
    if yr_gen and not d.get("cached"):
        ai_generations += 1
    record("I15", f"POST /api/review/year {YEAR} AI 年报生成", yr_gen,
           f"status={st}, cached={d.get('cached') if d else None}, range={d.get('range') if d else None}, "
           f"summary={clip(year_summary, 80)}")

    # ---- I16 review/year 缓存命中 ----
    st, d, _ = req("POST", "/api/review/year", {"year": YEAR}, token=TOKEN, timeout=200)
    hit_ok = st == 200 and d and d.get("cached") is True and d["review"].get("summary") == year_summary
    record("I16", "POST /api/review/year 同参数复验 → cached=true 且 summary 一致", hit_ok,
           f"status={st}, cached={d.get('cached') if d else None}, "
           f"summary一致={d.get('review', {}).get('summary') == year_summary if d else False}")

    # ---- I17 GET /api/review 聚合入口（只读缓存）----
    st, d, _ = req("GET", f"/api/review?kind=day&period={TODAY}", token=TOKEN)
    ok17 = st == 200 and d and isinstance(d.get("review"), dict) and d["review"].get("summary") == refresh_summary
    record("I17", f"GET /api/review?kind=day&period={TODAY} 聚合入口返回已持久化小结", ok17,
           f"status={st}, review非空={isinstance(d.get('review'), dict) if d else False}, "
           f"generatedAt={clip(d.get('generatedAt'), 40) if d else None}, "
           f"与refresh结果一致={d.get('review', {}).get('summary') == refresh_summary if d else False}")

    st2, d2, _ = req("GET", "/api/review?kind=bad&period=x", token=TOKEN)
    st3, d3, _ = req("GET", "/api/review", token=TOKEN)
    ok18 = st2 == 400 and st3 == 400
    record("I18", "GET /api/review 非法 kind/period、缺参数 → 400", ok18,
           f"kind=bad&period=x: status={st2}, body={clip(d2)}；无参数: status={st3}, body={clip(d3)}")

    # ============================== ai 域（管理）==============================
    print("\n===== ai 域（管理）=====")

    # ---- A1 GET /api/admin/prompts 清单 ----
    st, d, _ = req("GET", "/api/admin/prompts", token=TOKEN)
    items = (d or {}).get("items") or []
    keys = [i.get("key") for i in items]
    field_ok = all(
        all(k in i for k in ("key", "title", "category", "enabled", "overridden", "dbContent", "defaultContent",
                             "userTemplate", "userTemplateDefault", "contextConfig", "effectiveConfig", "registry"))
        for i in items
    )
    trw = next((i for i in items if i.get("key") == "trade_review_week"), None)
    reg_ok = trw and trw["registry"].get("placeholders") == ["facts", "txDetail"] \
        and any(c.get("key") == "txCap" for c in trw["registry"].get("caps", []))
    record("A1", "GET /api/admin/prompts 清单（18 个 key + userTemplate/contextConfig/registry）",
           st == 200 and len(items) == 18 and field_ok and reg_ok,
           f"status={st}, items={len(items)}, 字段完整={'是' if field_ok else '否'}, "
           f"trade_review_week: placeholders={trw['registry'].get('placeholders') if trw else None}, "
           f"txCap默认={[c.get('default') for c in trw['registry'].get('caps', []) if c.get('key') == 'txCap'] if trw else None}, "
           f"初始overridden={trw.get('overridden') if trw else None}, "
           f"初始userTemplate={(trw.get('userTemplate') or '')[:30] if trw else None}")
    DEFAULT_CONTENT = (trw or {}).get("defaultContent") or ""

    # ---- A2 GET /api/admin/prompts/trade_review_week 版本历史 ----
    st, d, _ = req("GET", "/api/admin/prompts/trade_review_week", token=TOKEN)
    versions = (d or {}).get("versions") or []
    ver_shape = all(("id" in v and "content" in v and "created_at" in v) for v in versions)
    baseline_version_id = versions[0]["id"] if versions else None
    record("A2", "GET /api/admin/prompts/trade_review_week 版本历史", st == 200 and ver_shape,
           f"status={st}, versions={len(versions)} 条, 最新版本id={baseline_version_id}, "
           f"字段id/content/payload/created_at={'完整' if ver_shape else '缺失'}")

    # ---- A3 PUT 删除必需占位符 {txDetail} → 400 ----
    st, d, _ = req("PUT", "/api/admin/prompts/trade_review_week",
                   {"content": DEFAULT_CONTENT, "userTemplate": "{facts}"}, token=TOKEN)
    missing_list = (d or {}).get("missing") or []
    ok3 = st == 400 and "txDetail" in missing_list and "txDetail" in (d.get("error") or "")
    record("A3", "PUT trade_review_week 删必需占位符 {txDetail} → 400 且列明缺失", ok3,
           f"status={st}, error={clip(d.get('error'), 90) if d else None}, missing={missing_list}, unknown={(d or {}).get('unknown')}")

    # ---- A4 PUT 未知占位符 → 400 ----
    st, d, _ = req("PUT", "/api/admin/prompts/trade_review_week",
                   {"content": DEFAULT_CONTENT, "userTemplate": "{facts}\n\n{txDetail}\n{evilVar}"}, token=TOKEN)
    unknown_list = (d or {}).get("unknown") or []
    ok4 = st == 400 and "evilVar" in unknown_list and "evilVar" in (d.get("error") or "")
    record("A4", "PUT trade_review_week 加未知占位符 {evilVar} → 400 且列明未知", ok4,
           f"status={st}, error={clip(d.get('error'), 90) if d else None}, missing={(d or {}).get('missing')}, unknown={unknown_list}")

    # ---- A5 PUT 合法模板 + contextConfig（txDetail=false, txCap=50）→ 200 ----
    good_tpl = "{facts}\n\n{txDetail}"
    good_cfg = {"inject": {"txDetail": False}, "caps": {"txCap": 50}}
    st, d, _ = req("PUT", "/api/admin/prompts/trade_review_week",
                   {"content": DEFAULT_CONTENT, "userTemplate": good_tpl, "contextConfig": good_cfg,
                    "remark": "QA 验收测试覆盖"}, token=TOKEN)
    p = (d or {}).get("prompt") or {}
    ok5 = st == 200 and (d or {}).get("ok") is True and p.get("user_template") == good_tpl \
        and (p.get("context_config") or {}).get("inject", {}).get("txDetail") is False \
        and (p.get("context_config") or {}).get("caps", {}).get("txCap") == 50
    record("A5", "PUT trade_review_week 合法模板+contextConfig → 200 保存", ok5,
           f"status={st}, ok={(d or {}).get('ok')}, user_template={clip(p.get('user_template'), 40)}, "
           f"context_config={p.get('context_config')}, remark={p.get('remark')}")

    # ---- A6 GET 清单确认覆盖生效 ----
    st, d, _ = req("GET", "/api/admin/prompts", token=TOKEN)
    trw = next((i for i in (d or {}).get("items", []) if i.get("key") == "trade_review_week"), {})
    eff = trw.get("effectiveConfig") or {}
    ok6 = trw.get("overridden") is True and trw.get("userTemplate") == good_tpl \
        and eff.get("inject", {}).get("txDetail") is False and eff.get("caps", {}).get("txCap") == 50
    record("A6", "GET /api/admin/prompts 确认 trade_review_week 覆盖已生效", ok6,
           f"status={st}, overridden={trw.get('overridden')}, userTemplate={clip(trw.get('userTemplate'), 40)}, "
           f"contextConfig={trw.get('contextConfig')}, effectiveConfig={eff}")

    # ---- A7 preview（POST，源码契约）装配验证 ----
    sample = "周三午饭在楼下吃了碗牛肉面，花了 28 块。晚上加班到九点。"
    st, d, _ = req("POST", "/api/admin/prompts/trade_review_week/preview", {"sample": sample}, token=TOKEN)
    cfg7 = (d or {}).get("config") or {}
    up7 = (d or {}).get("userPrompt") or ""
    basic_ok = st == 200 and (d or {}).get("ok") is True \
        and cfg7.get("inject", {}).get("txDetail") is False and cfg7.get("caps", {}).get("txCap") == 50
    record("A7a", "POST /api/admin/prompts/trade_review_week/preview 可用且返回生效配置(txDetail=false,txCap=50)", basic_ok,
           f"status={st}, ok={(d or {}).get('ok')}, config={cfg7}, userPrompt长度={len(up7)}")
    # 装配语义：期望 userPrompt 为 trade_review_week 三件套装配（facts 聚合行 + txDetail 关闭后块消失/开启时流水明细+截断注记）
    is_trade_assembly = ("【当前 prompt】" not in up7) and ("【用途】" not in up7)
    tx_gone = "本周流水" not in up7 and "txDetail" not in up7 and "{" not in up7
    sample_in = sample[:8] in up7
    record("A7b", "preview 按线上同源装配 trade_review_week 模板（txDetail 块关闭/截断注记）",
           basic_ok and is_trade_assembly and tx_gone,
           f"userPrompt全文={clip(up7, 200)}；样例文本出现={sample_in}；"
           f"是否为trade模板正确装配={'否' if not (is_trade_assembly and tx_gone) else '是'}"
           f"（疑似原因：preview/route.ts 对 trade_review_week 无专属分支——key 不匹配 review_/extract_ 前缀落入 prompt_optimizer 兜底，"
           f"且 assembleUserPrompt 以 prompt_optimizer 占位符集合配 trade_review_week 的 bundle.userTemplate，模板/占位符错配）")

    # ---- A8 版本历史含本次保存 payload ----
    st, d, _ = req("GET", "/api/admin/prompts/trade_review_week", token=TOKEN)
    versions = (d or {}).get("versions") or []
    newest = versions[0] if versions else {}
    payload = newest.get("payload") or {}
    ok8 = st == 200 and payload.get("userTemplate") == good_tpl \
        and (payload.get("contextConfig") or {}).get("inject", {}).get("txDetail") is False
    record("A8", "GET trade_review_week 版本历史含本次保存的三件套 payload", ok8,
           f"status={st}, versions={len(versions)} 条, 最新payload.userTemplate={clip(payload.get('userTemplate'), 40)}, "
           f"最新payload.contextConfig={payload.get('contextConfig')}")

    # ---- A9 restore 回滚到基线版本 ----
    restore_target = versions[1] if len(versions) >= 2 else None  # 本次保存之前的最近版本（基线）
    if restore_target:
        st, d, _ = req("POST", "/api/admin/prompts/trade_review_week/restore",
                       {"versionId": restore_target["id"]}, token=TOKEN)
        p = (d or {}).get("prompt") or {}
        base_payload = restore_target.get("payload") or {}
        if base_payload:
            # 新版本（含三件套 payload）：user 模板/配置应整体回滚到基线值
            expected_tpl = base_payload.get("userTemplate")
        else:
            # 老版本（无 payload）：仅回滚 system，user 模板/配置保留当前覆盖（即 good_tpl）
            expected_tpl = good_tpl
        ok9 = st == 200 and (d or {}).get("ok") is True and p.get("user_template") == expected_tpl
        record("A9", f"POST restore 回滚到基线版本 id={restore_target['id']}", ok9,
               f"status={st}, ok={(d or {}).get('ok')}, 回滚后user_template={clip(p.get('user_template'), 40)}, "
               f"期望user_template={clip(expected_tpl, 40)}, 基线含payload={'是' if base_payload else '否（老版本仅回滚system）'}")
    else:
        record("A9", "POST restore 回滚到基线版本", True,
               "跳过回滚（无基线版本可回滚，仅本次测试产生的版本），直接走 DELETE 恢复默认")

    # ---- A10 DELETE 删覆盖，恢复代码默认 ----
    st, d, _ = req("DELETE", "/api/admin/prompts/trade_review_week", token=TOKEN)
    ok10 = st == 200 and (d or {}).get("ok") is True
    record("A10", "DELETE /api/admin/prompts/trade_review_week 删覆盖恢复默认", ok10,
           f"status={st}, body={clip(d)}")

    # ---- A11 GET 确认还原（无遗留覆盖）----
    st, d, _ = req("GET", "/api/admin/prompts", token=TOKEN)
    trw = next((i for i in (d or {}).get("items", []) if i.get("key") == "trade_review_week"), {})
    ok11 = st == 200 and trw.get("overridden") is False and trw.get("dbContent") is None \
        and trw.get("userTemplate") is None and trw.get("contextConfig") is None \
        and trw.get("effectiveConfig", {}).get("inject", {}).get("txDetail") is True \
        and trw.get("effectiveConfig", {}).get("caps", {}).get("txCap") == 150
    record("A11", "GET 确认 trade_review_week 已还原默认（overridden=false / 覆盖字段=null / 配置回归注册表默认）", ok11,
           f"status={st}, overridden={trw.get('overridden')}, dbContent={'null' if trw.get('dbContent') is None else '有'}, "
           f"userTemplate={trw.get('userTemplate')}, contextConfig={trw.get('contextConfig')}, "
           f"effectiveConfig={trw.get('effectiveConfig')}")

    # ---- M1 GET /api/admin/ai-mode ----
    st, d, _ = req("GET", "/api/admin/ai-mode", token=TOKEN)
    ok1 = st == 200 and d and d.get("mode") == "shadow"
    record("M1", "GET /api/admin/ai-mode 当前模式 = shadow", ok1,
           f"status={st}, mode={d.get('mode') if d else None}, envDefault={d.get('envDefault') if d else None}, "
           f"takeoverAvailable={d.get('takeoverAvailable') if d else None}")

    # ---- M2 PUT off → GET 确认 ----
    st, d, _ = req("PUT", "/api/admin/ai-mode", {"mode": "off"}, token=TOKEN)
    put_ok = st == 200 and (d or {}).get("ok") is True and (d or {}).get("mode") == "off"
    st2, d2, _ = req("GET", "/api/admin/ai-mode", token=TOKEN)
    ok2 = put_ok and st2 == 200 and d2.get("mode") == "off"
    record("M2", "PUT /api/admin/ai-mode mode=off → 保存生效，GET 确认 off", ok2,
           f"PUT: status={st}, body={clip(d)}；GET: status={st2}, mode={d2.get('mode') if d2 else None}")

    # ---- M3 PUT 非法 mode → 400 ----
    st, d, _ = req("PUT", "/api/admin/ai-mode", {"mode": "bogus"}, token=TOKEN)
    ok3 = st == 400 and d and "off/shadow/on" in (d.get("error") or "")
    record("M3", "PUT /api/admin/ai-mode 非法 mode=bogus → 400", ok3, f"status={st}, body={clip(d)}")

    # ---- M4 切回 shadow（生产语义，结束状态）----
    st, d, _ = req("PUT", "/api/admin/ai-mode", {"mode": "shadow"}, token=TOKEN)
    put_ok = st == 200 and (d or {}).get("ok") is True and (d or {}).get("mode") == "shadow"
    st2, d2, _ = req("GET", "/api/admin/ai-mode", token=TOKEN)
    ok4 = put_ok and st2 == 200 and d2.get("mode") == "shadow"
    record("M4", "PUT mode=shadow 切回（生产语义）→ GET 确认 shadow", ok4,
           f"PUT: status={st}, body={clip(d)}；GET: status={st2}, mode={d2.get('mode') if d2 else None}")

    # ---- T1 GET /api/tokens/usage ----
    st, d, _ = req("GET", "/api/tokens/usage", token=TOKEN)
    self_u = (d or {}).get("self") or {}
    by_model = (d or {}).get("byModel") or []
    invitees = (d or {}).get("invitees") or []
    struct_ok = st == 200 and all(k in self_u for k in ("all", "d30")) \
        and all(k in self_u.get("all", {}) for k in ("calls", "promptTokens", "completionTokens")) \
        and all(k in self_u.get("d30", {}) for k in ("calls", "promptTokens", "completionTokens")) \
        and isinstance(by_model, list) and isinstance(invitees, list)
    d30_le = struct_ok and all(self_u["d30"][k] <= self_u["all"][k]
                               for k in ("calls", "promptTokens", "completionTokens"))
    record("T1", "GET /api/tokens/usage 消耗统计（30 天口径 total/分模型）", struct_ok and d30_le,
           f"status={st}, self.all={self_u.get('all')}, self.d30={self_u.get('d30')}, "
           f"invitees={len(invitees)} 人, byModel={[(m.get('model'), m.get('all', {}).get('calls')) for m in by_model]}, "
           f"d30<=all={'是' if d30_le else '否'}")

    # ---- T2 audit 口径：jev* 行不计入消耗 ----
    jev_rows = [m.get("model") for m in by_model if str(m.get("model", "")).startswith("jev")]
    sum_ok = True
    if not invitees:
        s = sum(m.get("all", {}).get("calls", 0) for m in by_model)
        sum_ok = s == self_u.get("all", {}).get("calls")
    record("T2", "tokens/usage 审计口径：model 以 jev 开头的行被排除（jev_shadow 不计入消耗）",
           st == 200 and not jev_rows and sum_ok,
           f"byModel中jev*行={jev_rows or '无'}；"
           f"{'self.all.calls=' + str(self_u.get('all', {}).get('calls')) + ' == byModel.calls合计=' + str(sum(m.get('all', {}).get('calls', 0) for m in by_model)) if not invitees else '存在被邀请人，跳过合计交叉核对'}"
           f"（接口不支持按 stage 过滤，以 SQL not like 'jev%' 口径 + byModel 无 jev 行验证）")

except Exception as e:
    import traceback
    record("X0", "测试脚本执行异常", False, f"{e}\n{traceback.format_exc()[:400]}")

finally:
    # ============================== 结束状态兜底 ==============================
    print("\n===== 结束状态兜底（try/finally）=====")
    try:
        st, d, _ = req("PUT", "/api/admin/ai-mode", {"mode": "shadow"}, token=TOKEN)
        st2, d2, _ = req("GET", "/api/admin/ai-mode", token=TOKEN)
        final_mode = d2.get("mode") if st2 == 200 and d2 else None
        record("E1", "结束状态：ai-mode=shadow", st == 200 and final_mode == "shadow",
               f"PUT status={st}; GET status={st2}, mode={final_mode}")
    except Exception as e:
        record("E1", "结束状态：ai-mode=shadow", False, f"兜底失败: {e}")
    try:
        st, d, _ = req("DELETE", "/api/admin/prompts/trade_review_week", token=TOKEN)
        st2, d2, _ = req("GET", "/api/admin/prompts", token=TOKEN)
        trw = next((i for i in (d2 or {}).get("items", []) if i.get("key") == "trade_review_week"), {})
        clean = st2 == 200 and trw.get("overridden") is False and trw.get("dbContent") is None \
            and trw.get("userTemplate") is None and trw.get("contextConfig") is None
        record("E2", "结束状态：trade_review_week 恢复默认、无遗留覆盖", clean,
               f"DELETE status={st}; GET overridden={trw.get('overridden')}, dbContent={'null' if trw.get('dbContent') is None else '有'}, "
               f"userTemplate={trw.get('userTemplate')}, contextConfig={trw.get('contextConfig')}")
    except Exception as e:
        record("E2", "结束状态：trade_review_week 恢复默认、无遗留覆盖", False, f"兜底失败: {e}")

# ============================== 汇总 ==============================
print("\n" + "=" * 60)
passed = sum(1 for _, _, ok, _ in results if ok)
failed = len(results) - passed
print(f"真实 LLM 生成调用次数（审计）: {ai_generations}（上限 6）")
for tid, name, ok, ev in results:
    if not ok:
        print(f"  FAIL {tid} {name}\n       {clip(ev, 300)}")
print(f"\nPASS {passed} / FAIL {failed}")
