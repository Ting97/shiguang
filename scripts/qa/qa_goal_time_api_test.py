# -*- coding: utf-8 -*-
"""QA 全量 API 验收测试：goal(todos/spaces/reflections) + time(blocks/activities/stats)"""
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://127.0.0.1:3100"
PHONE = "13800003366"
PASSWORD = "test3f-pass"
H = {"Origin": BASE, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"}

RESULTS = []  # (domain, name, ok, expect, actual, request_desc)
CREATED = {"todos": [], "spaces": [], "blocks": [], "activities": [], "reflections": [],
           "space_for_reflections": None}


def api(method, path, body=None, with_headers=True, token=None):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    if with_headers:
        headers.update(H)
    r = requests.request(method, BASE + path, json=body, headers=headers, timeout=30)
    try:
        data = r.json()
    except Exception:
        data = {"_raw": r.text[:300]}
    return r.status_code, data


def check(domain, name, ok, expect, actual, req=""):
    RESULTS.append((domain, name, bool(ok), expect, actual, req))
    print(f"[{'PASS' if ok else 'FAIL'}] {domain} > {name}")
    if not ok:
        print(f"    请求: {req or '-'}")
        print(f"    期望: {expect}")
        print(f"    实际: {actual}")
    return ok


def expect_eq(domain, name, actual, expected, req=""):
    return check(domain, name, actual == expected, expected, actual, req)


def bj_date(iso_str):
    """服务端把 date 列按本地时区(Asia/Shanghai)解析后序列化为 UTC ISO；+8h 还原北京日历日"""
    dt = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
    return (dt + timedelta(hours=8)).strftime("%Y-%m-%d")


def preclean(token):
    """清理历史运行残留的 QA- 数据"""
    for view in ["all", "done", "today", "today-actions"]:
        s, d = api("GET", f"/api/todos?view={view}", token=token)
        rows = d.get("todos") or d.get("actions") or []
        for t in rows:
            if str(t.get("title", "")).startswith("QA-"):
                api("DELETE", f"/api/todos/{t['id']}", token=token)
    s, d = api("GET", "/api/spaces", token=token)
    for sp in d.get("spaces", []):
        if str(sp.get("name", "")).startswith("QA-"):
            api("DELETE", f"/api/spaces/{sp['id']}", token=token)
    s, d = api("GET", "/api/blocks/range?from=2025-01-01&to=2025-12-31", token=token)
    for b in d.get("blocks", []):
        if str(b.get("title", "")).startswith("QA-"):
            api("DELETE", f"/api/blocks/{b['id']}", token=token)
    s, d = api("GET", "/api/activities", token=token)
    for a in d.get("activities", []):
        if str(a.get("name", "")).startswith("QA-"):
            api("DELETE", f"/api/activities/{a['id']}", token=token)


def postclean_verify():
    """清理后从服务端反查 QA- 残留"""
    left = []
    for view in ["all", "done", "today", "today-actions"]:
        s, d = api("GET", f"/api/todos?view={view}", token=TOKEN)
        for t in (d.get("todos") or d.get("actions") or []):
            if str(t.get("title", "")).startswith("QA-") and t["id"] not in left:
                left.append(f"todo:{t['title']}")
    s, d = api("GET", "/api/spaces", token=TOKEN)
    for sp in d.get("spaces", []):
        if str(sp.get("name", "")).startswith("QA-"):
            left.append(f"space:{sp['name']}")
    s, d = api("GET", "/api/blocks/range?from=2025-01-01&to=2025-12-31", token=TOKEN)
    for b in d.get("blocks", []):
        if str(b.get("title", "")).startswith("QA-"):
            left.append(f"block:{b['title']}")
    return left


# ---------------------------------------------------------------- login
print("=" * 72)
print("登录")
s, d = api("POST", "/api/auth/login", {"phone": PHONE, "password": PASSWORD}, token=None)
TOKEN = d.get("token") if isinstance(d, dict) else None
check("auth", "登录返回 token", s == 200 and bool(TOKEN), "200 + token", f"{s} {str(d)[:200]}",
      f"POST /api/auth/login phone={PHONE}")
preclean(TOKEN)

# ================================================================ GOAL: todos
print("=" * 72)
print("域: goal / todos")

s, d = api("POST", "/api/todos", {"title": "QA-待办-基础"}, token=TOKEN)
todo = d.get("todo", {})
TODOS_CREATED = bool(s == 200 and todo.get("id"))
if TODOS_CREATED:
    CREATED["todos"].append(todo["id"])
expect_eq("goal/todos", "创建待办(仅标题) 返回 200 且 kind=todo status=pending",
          (s, todo.get("kind"), todo.get("status")), (200, "todo", "pending"),
          "POST /api/todos {title:'QA-待办-基础'}")
check("goal/todos", "创建待办 自动回退分类 activity_id 非空",
      bool(todo.get("activity_id")), "activity_id 非空(回退「其他」)", todo.get("activity_id"),
      "POST /api/todos {title}")

# activity 指定
s, d = api("POST", "/api/todos", {"title": "QA-待办-带分类", "activityId": "work"}, token=TOKEN)
t_work = d.get("todo", {})
if t_work.get("id"):
    CREATED["todos"].append(t_work["id"])
expect_eq("goal/todos", "创建待办 指定 activityId=work 生效", (s, t_work.get("activity_id")), (200, "work"),
          "POST /api/todos {title, activityId:'work'}")

# 截止时间 + 提醒提前 15 分钟
due = "2026-09-30T10:00:00+08:00"
s, d = api("POST", "/api/todos", {"title": "QA-待办-带截止", "dueAt": due}, token=TOKEN)
t_due = d.get("todo", {})
if t_due.get("id"):
    CREATED["todos"].append(t_due["id"])
ok = s == 200 and t_due.get("due_at") and t_due.get("remind_at")
delta_ok = False
if ok:
    dd = datetime.fromisoformat(t_due["due_at"].replace("Z", "+00:00"))
    rr = datetime.fromisoformat(t_due["remind_at"].replace("Z", "+00:00"))
    delta_ok = abs((dd - rr).total_seconds() - 900) < 1
    due_ok = dd == datetime.fromisoformat(due)
else:
    due_ok = False
check("goal/todos", "创建待办 dueAt 写入且 remind_at=dueAt-15min",
      ok and delta_ok and due_ok, "due_at=2026-09-30T10:00+08:00, remind 提前15分钟",
      f"{s} due_at={t_due.get('due_at')} remind_at={t_due.get('remind_at')}",
      f"POST /api/todos {{title, dueAt:'{due}'}}")

# 空标题 / 超长标题
s, d = api("POST", "/api/todos", {"title": "   "}, token=TOKEN)
expect_eq("goal/todos", "空标题 → 400", (s, d.get("error")), (400, "标题不能为空"),
          "POST /api/todos {title:'   '}")
s, d = api("POST", "/api/todos", {"title": "Q" * 201}, token=TOKEN)
expect_eq("goal/todos", "201字超长标题 → 400", s, 400, "POST /api/todos {title:'Q'*201}")

# 子行动
s, d = api("POST", "/api/todos", {"title": "QA-待办-父任务"}, token=TOKEN)
parent = d.get("todo", {})
if parent.get("id"):
    CREATED["todos"].append(parent["id"])
s, d = api("POST", "/api/todos", {"title": "QA-行动-子项", "parentId": parent.get("id")}, token=TOKEN)
child = d.get("todo", {})
if child.get("id"):
    CREATED["todos"].append(child["id"])
expect_eq("goal/todos", "POST 带 parentId 创建子行动 kind=action 且挂父",
          (s, child.get("kind"), child.get("parent_todo_id")), (200, "action", parent.get("id")),
          f"POST /api/todos {{title, parentId:'{parent.get('id')}'}}")

s, d = api("POST", "/api/todos", {"title": "QA-行动-坏父", "parentId": str(uuid.uuid4())}, token=TOKEN)
check("goal/todos", "不存在的 parentId → 400", s == 400, "400", f"{s} {str(d)[:150]}",
      "POST /api/todos {title, parentId:<random-uuid>}")

# GET 列表与视图过滤
s, d = api("GET", "/api/todos?view=all", token=TOKEN)
todos_all = d.get("todos", [])
ids_all = [t["id"] for t in todos_all]
parent_item = next((t for t in todos_all if t["id"] == parent.get("id")), None)
check("goal/todos", "GET view=all 含新建待办且 children 嵌套子行动",
      parent_item is not None and any(c["id"] == child.get("id") for c in (parent_item or {}).get("children", [])),
      f"含 {parent.get('id')} 且 children 含 {child.get('id')}",
      f"列表 {len(todos_all)} 条; parent children={len((parent_item or {}).get('children', []))}",
      "GET /api/todos?view=all")
check("goal/todos", "GET 返回 counts 徽标(4 个整数键)",
      isinstance(d.get("counts"), dict) and set(d["counts"]) >= {"today", "important", "all", "done"}
      and all(isinstance(v, int) for v in d["counts"].values()),
      "counts{today,important,all,done} 均为 int", str(d.get("counts"))[:150], "GET /api/todos?view=all")

# done 视图
s, d = api("PATCH", f"/api/todos/{t_work.get('id')}", {"done": True}, token=TOKEN)
done_res = d.get("todo", {})
check("goal/todos", "PATCH {done:true} 完成 → status=done done_at 非空",
      s == 200 and done_res.get("status") == "done" and bool(done_res.get("done_at")),
      "200 status=done done_at 非空", f"{s} {str(d)[:150]}",
      f"PATCH /api/todos/{t_work.get('id')} {{done:true}}")
s, d = api("PATCH", f"/api/todos/{t_work.get('id')}", {"done": True}, token=TOKEN)
check("goal/todos", "重复完成 → 404", s == 404, "404", f"{s} {str(d)[:150]}",
      "PATCH done:true (已完成的)")
s, d = api("GET", "/api/todos?view=done", token=TOKEN)
check("goal/todos", "GET view=done 含刚完成项", any(t["id"] == t_work.get("id") for t in d.get("todos", [])),
      f"含 {t_work.get('id')}", f"done 视图 {len(d.get('todos', []))} 条", "GET /api/todos?view=done")
s, d = api("GET", "/api/todos?view=all", token=TOKEN)
check("goal/todos", "完成项不再出现在 view=all 顶层", all(t["id"] != t_work.get("id") for t in d.get("todos", [])),
      "不含已完成项", f"all 视图 {len(d.get('todos', []))} 条", "GET /api/todos?view=all")

# 恢复
s, d = api("PATCH", f"/api/todos/{t_work.get('id')}", {"undone": True}, token=TOKEN)
restored = d.get("todo", {})
check("goal/todos", "PATCH {undone:true} 恢复 → status=pending done_at=null",
      s == 200 and restored.get("status") == "pending" and restored.get("done_at") is None,
      "200 status=pending done_at=null", f"{s} {str(d)[:150]}", "PATCH {undone:true}")
s, d = api("PATCH", f"/api/todos/{t_work.get('id')}", {"undone": True}, token=TOKEN)
check("goal/todos", "对未完成项 undone → 404", s == 404, "404", f"{s} {str(d)[:150]}", "PATCH {undone:true}(未完成)")

# important 视图
s, d = api("PATCH", f"/api/todos/{t_due.get('id')}", {"important": True}, token=TOKEN)
expect_eq("goal/todos", "PATCH important=true", (s, d.get("todo", {}).get("is_important")), (200, True),
          f"PATCH /api/todos/{t_due.get('id')} {{important:true}}")
s, d = api("GET", "/api/todos?view=important", token=TOKEN)
check("goal/todos", "GET view=important 含标记项", any(t["id"] == t_due.get("id") for t in d.get("todos", [])),
      f"含 {t_due.get('id')}", f"important 视图 {len(d.get('todos', []))} 条", "GET /api/todos?view=important")

# today 视图
s, d = api("POST", "/api/todos", {"title": "QA-待办-今日标记", "today": True}, token=TOKEN)
t_today = d.get("todo", {})
if t_today.get("id"):
    CREATED["todos"].append(t_today["id"])
s, d = api("GET", "/api/todos?view=today", token=TOKEN)
check("goal/todos", "POST today:true 后出现在 view=today",
      s == 200 and any(t["id"] == t_today.get("id") for t in d.get("todos", [])),
      f"含 {t_today.get('id')}", f"{s} today 视图 {len(d.get('todos', []))} 条", "GET /api/todos?view=today")

# 改名 / 改截止 / 不存在 id
s, d = api("PATCH", f"/api/todos/{parent.get('id')}", {"title": "QA-待办-父任务-改名"}, token=TOKEN)
expect_eq("goal/todos", "PATCH 改名", (s, d.get("todo", {}).get("title")), (200, "QA-待办-父任务-改名"),
          "PATCH {title}")
s, d = api("PATCH", f"/api/todos/{parent.get('id')}", {"dueAt": "2026-10-08T09:00:00+08:00"}, token=TOKEN)
check("goal/todos", "PATCH 改截止时间 due_at 更新",
      s == 200 and str(d.get("todo", {}).get("due_at", "")).startswith("2026-10-08T01:00"),
      "due_at=2026-10-08T01:00:00Z(UTC)", f"{s} due_at={d.get('todo', {}).get('due_at')}", "PATCH {dueAt}")
rnd = str(uuid.uuid4())
s, d = api("PATCH", f"/api/todos/{rnd}", {"title": "QA-越权"}, token=TOKEN)
check("goal/todos", "PATCH 不存在/越权 uuid → 404", s == 404, "404", f"{s} {str(d)[:150]}",
      f"PATCH /api/todos/{rnd}")
s, d = api("DELETE", f"/api/todos/{rnd}", token=TOKEN)
check("goal/todos", "DELETE 不存在/越权 uuid → 404", s == 404, "404", f"{s} {str(d)[:150]}",
      f"DELETE /api/todos/{rnd}")

# 行动级限制
s, d = api("PATCH", f"/api/todos/{child.get('id')}", {"important": True}, token=TOKEN)
check("goal/todos", "行动设 important → 400", s == 400, "400", f"{s} {str(d)[:150]}", "PATCH child {important:true}")
s, d = api("PATCH", f"/api/todos/{child.get('id')}", {"repeatDaily": True}, token=TOKEN)
expect_eq("goal/todos", "行动设 repeatDaily=true", (s, d.get("todo", {}).get("repeat_daily")), (200, True),
          "PATCH child {repeatDaily:true}")
s, d = api("PATCH", f"/api/todos/{parent.get('id')}", {"repeatDaily": True}, token=TOKEN)
check("goal/todos", "顶层 todo 设 repeatDaily → 400(仅行动支持)", s == 400, "400", f"{s} {str(d)[:150]}",
      "PATCH parent {repeatDaily:true}")

# 删除
s, d = api("DELETE", f"/api/todos/{child.get('id')}", token=TOKEN)
if s == 200 and child.get("id") in CREATED["todos"]:
    CREATED["todos"].remove(child["id"])
s2, d2 = api("DELETE", f"/api/todos/{parent.get('id')}", token=TOKEN)
if s2 == 200 and parent.get("id") in CREATED["todos"]:
    CREATED["todos"].remove(parent["id"])
check("goal/todos", "DELETE 待办/行动 → ok 且再删 404",
      s == 200 and d.get("ok") is True and s2 == 200 and d2.get("ok") is True, "200 {ok:true} 两次",
      f"{s} {str(d)[:80]} / {s2} {str(d2)[:80]}", "DELETE /api/todos/:id")

# 独立行动(kind=action 无 parent)
s, d = api("POST", "/api/todos", {"title": "QA-独立行动", "kind": "action", "repeatDaily": True}, token=TOKEN)
solo = d.get("todo", {})
if solo.get("id"):
    CREATED["todos"].append(solo["id"])
expect_eq("goal/todos", "独立行动 kind=action 无父且可每日重复",
          (s, solo.get("kind"), solo.get("parent_todo_id"), solo.get("repeat_daily")),
          (200, "action", None, True), "POST {kind:'action', repeatDaily:true}")
s, d = api("GET", "/api/todos?view=today-actions", token=TOKEN)
check("goal/todos", "today-actions 视图含每日重复独立行动",
      s == 200 and any(a["id"] == solo.get("id") for a in d.get("actions", [])),
      f"含 {solo.get('id')}", f"{s} actions={len(d.get('actions', []))}", "GET /api/todos?view=today-actions")
if solo.get("id"):
    api("DELETE", f"/api/todos/{solo['id']}", token=TOKEN)
    if solo["id"] in CREATED["todos"]:
        CREATED["todos"].remove(solo["id"])

# ================================================================ GOAL: spaces
print("=" * 72)
print("域: goal / spaces")

s, d = api("POST", "/api/spaces", {"name": "QA-空间-验收", "description": "QA 临时空间", "icon": "🧪",
                                   "color": "#ff6600", "startedAt": "2026-09-01", "targetDate": "2026-12-31"},
           token=TOKEN)
space = d.get("space", {})
if space.get("id"):
    CREATED["spaces"].append(space["id"])
check("goal/spaces", "创建空间(name/desc/icon/color/startedAt/targetDate) 字段落库",
      s == 200 and space.get("name") == "QA-空间-验收" and space.get("description") == "QA 临时空间"
      and bj_date(space.get("started_at")) == "2026-09-01"
      and bj_date(space.get("target_date")) == "2026-12-31"
      and space.get("icon") == "🧪" and space.get("color") == "#ff6600",
      "200 全字段一致(started_at=2026-09-01, target_date=2026-12-31 北京日历日)",
      f"{s} started_at={space.get('started_at')} target_date={space.get('target_date')}",
      "POST /api/spaces {name,description,icon,color,startedAt,targetDate}")

s, d = api("POST", "/api/spaces", {"name": "  "}, token=TOKEN)
expect_eq("goal/spaces", "空名称 → 400", s, 400, "POST /api/spaces {name:'  '}")
s, d = api("POST", "/api/spaces", {"name": "N" * 41}, token=TOKEN)
check("goal/spaces", "41字超长名称 → 400", s == 400, "400", f"{s} {str(d)[:150]}", "POST {name:'N'*41}")

s, d = api("GET", "/api/spaces", token=TOKEN)
sp_item = next((x for x in d.get("spaces", []) if x["id"] == space.get("id")), {})
agg_keys = {"todo_total", "todo_done", "action_total", "action_done", "entry_count", "reflection_count"}
check("goal/spaces", "GET 列表含新空间且聚合字段齐备",
      s == 200 and agg_keys <= set(sp_item.keys())
      and all(isinstance(sp_item.get(k), int) for k in agg_keys)
      and sp_item.get("reflection_count") == 0,
      "列表含该空间, 聚合 int 字段齐备, reflection_count=0",
      f"{s} 空间数={len(d.get('spaces', []))} 字段={sorted(set(sp_item) & agg_keys)}", "GET /api/spaces")

s, d = api("PATCH", f"/api/spaces/{space.get('id')}", {"name": "QA-空间-改名", "description": "QA 改后描述"},
           token=TOKEN)
sp2 = d.get("space", {})
check("goal/spaces", "PATCH 改名+描述", s == 200 and sp2.get("name") == "QA-空间-改名"
      and sp2.get("description") == "QA 改后描述", "200 新名称/描述", f"{s} {str(d)[:150]}",
      "PATCH /api/spaces/:id {name,description}")
s, d = api("PATCH", f"/api/spaces/{space.get('id')}", {"targetDate": "2027-03-15"}, token=TOKEN)
check("goal/spaces", "PATCH 改目标日期", s == 200 and bj_date(d.get("space", {}).get("target_date")) == "2027-03-15",
      "target_date=2027-03-15(北京日历日)", f"{s} target_date={d.get('space', {}).get('target_date')}", "PATCH {targetDate}")

# 归档空间（后面验证待办不可新挂归档空间）
s, d = api("POST", "/api/spaces", {"name": "QA-空间-归档用"}, token=TOKEN)
space_arch = d.get("space", {})
if space_arch.get("id"):
    CREATED["spaces"].append(space_arch["id"])
s, d = api("PATCH", f"/api/spaces/{space_arch.get('id')}", {"status": "archived"}, token=TOKEN)
expect_eq("goal/spaces", "PATCH status=archived 归档", (s, d.get("space", {}).get("status")), (200, "archived"),
          "PATCH {status:'archived'}")
s, d = api("PATCH", f"/api/spaces/{space_arch.get('id')}", {"status": "bogus"}, token=TOKEN)
check("goal/spaces", "非法 status → 400", s == 400, "400", f"{s} {str(d)[:150]}", "PATCH {status:'bogus'}")

s, d = api("PATCH", f"/api/spaces/{str(uuid.uuid4())}", {"name": "QA-越权空间"}, token=TOKEN)
check("goal/spaces", "PATCH 不存在/越权空间 → 404", s == 404, "404", f"{s} {str(d)[:150]}",
      "PATCH /api/spaces/<random-uuid>")

# 待办关联空间
s, d = api("POST", "/api/todos", {"title": "QA-待办-挂空间", "spaceId": space.get("id")}, token=TOKEN)
t_space = d.get("todo", {})
if t_space.get("id"):
    CREATED["todos"].append(t_space["id"])
expect_eq("goal/spaces", "待办 POST 带 spaceId 关联", (s, t_space.get("space_id")), (200, space.get("id")),
          "POST /api/todos {title, spaceId}")
s, d = api("PATCH", f"/api/todos/{t_space.get('id')}", {"spaceId": space_arch.get("id")}, token=TOKEN)
check("goal/spaces", "待办改挂归档空间 → 400", s == 400, "400(空间已归档，不可新关联)", f"{s} {str(d)[:150]}",
      "PATCH todo {spaceId:<archived>}")
s, d = api("PATCH", f"/api/todos/{t_space.get('id')}", {"spaceId": str(uuid.uuid4())}, token=TOKEN)
check("goal/spaces", "待办挂不存在空间 → 400", s == 400, "400(空间不存在)", f"{s} {str(d)[:150]}",
      "PATCH todo {spaceId:<random-uuid>}")

# 空间数量上限 20
s, d = api("GET", "/api/spaces", token=TOKEN)
active_now = [x for x in d.get("spaces", []) if x.get("status") == "active"]
need = max(0, 20 - len(active_now)) + 1  # 补到 20 再多建 1 个应被拒
created_limit, last_code, last_err = [], None, None
for i in range(need):
    s, d = api("POST", "/api/spaces", {"name": f"QA-空间-上限{i + 1:02d}"}, token=TOKEN)
    last_code, last_err = s, str(d)[:150]
    if s == 200 and d.get("space", {}).get("id"):
        created_limit.append(d["space"]["id"])
        CREATED["spaces"].append(d["space"]["id"])
s, d = api("GET", "/api/spaces", token=TOKEN)
active_after = [x for x in d.get("spaces", []) if x.get("status") == "active"]
check("goal/spaces", "第 21 个进行中空间 → 400(上限 20)",
      last_code == 400 and "20" in (last_err or "") and len(active_after) == 20,
      "400 含『20』且 active 总数=20", f"last={last_code} {last_err}; active_after={len(active_after)}",
      f"已有 {len(active_now)} 个 active, 追加创建 {need} 个, 最后一个应 400")
for sid in created_limit:
    api("DELETE", f"/api/spaces/{sid}", token=TOKEN)
    if sid in CREATED["spaces"]:
        CREATED["spaces"].remove(sid)

# ================================================================ GOAL: reflections
print("=" * 72)
print("域: goal / spaces.reflections")

s, d = api("POST", f"/api/spaces/{space.get('id')}/reflections", {"content": "QA-感悟-第一条"}, token=TOKEN)
refl = d.get("reflection", {})
refl_ok = s == 201 and bool(refl.get("id"))
if refl_ok:
    CREATED["reflections"].append(refl["id"])
    CREATED["space_for_reflections"] = space["id"]
expect_eq("goal/reflections", "POST 创建感悟 → 201", (s, refl.get("content") if refl else None),
          (201, "QA-感悟-第一条"), "POST /api/spaces/:id/reflections {content}")

long_content = "长" * 350
s, d = api("POST", f"/api/spaces/{space.get('id')}/reflections", {"content": long_content}, token=TOKEN)
refl_long = d.get("reflection", {})
if refl_long.get("id"):
    CREATED["reflections"].append(refl_long["id"])
expect_eq("goal/reflections", "POST 长感悟(350字) 成功", s, 201, "POST {content:'长'*350}")

s, d = api("POST", f"/api/spaces/{space.get('id')}/reflections", {"content": "   "}, token=TOKEN)
check("goal/reflections", "空内容 → 400", s == 400, "400(感悟不能为空)", f"{s} {str(d)[:150]}", "POST {content:'   '}")
s, d = api("POST", f"/api/spaces/{str(uuid.uuid4())}/reflections", {"content": "QA"}, token=TOKEN)
check("goal/reflections", "不存在的空间 → 404", s == 404, "404(空间不存在)", f"{s} {str(d)[:150]}",
      "POST /api/spaces/<random>/reflections")

s, d = api("GET", f"/api/spaces/{space.get('id')}/reflections", token=TOKEN)
items = d.get("items", [])
long_item = next((x for x in items if x.get("chars") == 350), None)
check("goal/reflections", "GET 列表 total/preview≤300/chars 正确",
      s == 200 and d.get("total") == 2 and len(items) == 2
      and long_item is not None and len(long_item.get("preview", "")) == 300
      and items[0]["created_at"] >= items[1]["created_at"],
      "total=2, 长条目 preview=300 字, 按 created_at 倒序",
      f"{s} total={d.get('total')} items={len(items)} preview_len={len(long_item.get('preview', '')) if long_item else 'N/A'}",
      "GET /api/spaces/:id/reflections")

rid = refl.get("id")
s, d = api("GET", f"/api/spaces/{space.get('id')}/reflections/{rid}", token=TOKEN)
expect_eq("goal/reflections", "GET 单条全文", (s, d.get("reflection", {}).get("content")), (200, "QA-感悟-第一条"),
          f"GET /api/spaces/:id/reflections/{rid}")
s, d = api("PATCH", f"/api/spaces/{space.get('id')}/reflections/{rid}", {"content": "QA-感悟-改后"}, token=TOKEN)
check("goal/reflections", "PATCH 编辑感悟", s == 200 and d.get("reflection", {}).get("content") == "QA-感悟-改后",
      "200 内容更新", f"{s} {str(d)[:150]}", "PATCH reflections/:rid {content}")
s, d = api("GET", f"/api/spaces/{space.get('id')}/reflections", token=TOKEN)
edited_flag = next((x.get("edited") for x in d.get("items", []) if x["id"] == rid), None)
expect_eq("goal/reflections", "编辑后列表 edited=true", edited_flag, True, "GET 列表 checkedited 标记")
s, d = api("GET", f"/api/spaces/{space.get('id')}/reflections/{str(uuid.uuid4())}", token=TOKEN)
check("goal/reflections", "GET 不存在感悟 → 404", s == 404, "404", f"{s} {str(d)[:150]}", "GET <random rid>")

s, d = api("DELETE", f"/api/spaces/{space.get('id')}/reflections/{rid}", token=TOKEN)
if s == 200 and rid in CREATED["reflections"]:
    CREATED["reflections"].remove(rid)
s2, d2 = api("GET", f"/api/spaces/{space.get('id')}/reflections/{rid}", token=TOKEN)
check("goal/reflections", "DELETE 感悟 → ok 且再取 404", s == 200 and d.get("ok") is True and s2 == 404,
      "DELETE 200 {ok:true}, 再 GET 404", f"del={s} reget={s2}", "DELETE reflections/:rid")

# ================================================================ TIME: activities
print("=" * 72)
print("域: time / activities")

s, d = api("GET", "/api/activities", token=TOKEN)
acts = d.get("activities", [])
act_ids = {a["id"] for a in acts}
preset_ids = {"sleep", "work", "study", "fitness", "social", "fun", "chores", "commute", "other"}
check("time/activities", "GET 列表含九大预设且 is_preset=true",
      s == 200 and preset_ids <= act_ids
      and all(a.get("is_preset") for a in acts if a["id"] in preset_ids),
      f"包含 {sorted(preset_ids)} 且 is_preset=true",
      f"{s} n={len(acts)} 缺失={sorted(preset_ids - act_ids)}", "GET /api/activities")

s, d = api("POST", "/api/activities", {"name": "QA-分类-阅读", "icon": "📖", "color": "#aa22cc", "defaultMin": 45},
           token=TOKEN)
act = d.get("activity", {})
if act.get("id"):
    CREATED["activities"].append(act["id"])
check("time/activities", "POST 新建自定义分类",
      s == 200 and act.get("name") == "QA-分类-阅读" and act.get("is_preset") is False
      and act.get("color") == "#aa22cc" and act.get("default_min") == 45,
      "200 name/is_preset=false/color/default_min=45", f"{s} {str(d)[:200]}",
      "POST /api/activities {name,icon,color,defaultMin}")
s, d = api("POST", "/api/activities", {"name": "QA-分类-阅读"}, token=TOKEN)
check("time/activities", "重复同名 → 400", s == 400 and "同名" in str(d.get("error", "")), "400 已存在同名分类",
      f"{s} {str(d)[:150]}", "POST 同名分类")
s, d = api("POST", "/api/activities", {"name": " "}, token=TOKEN)
expect_eq("time/activities", "空名称 → 400", s, 400, "POST {name:' '}")

s, d = api("PATCH", f"/api/activities/{act.get('id')}", {"name": "QA-分类-精读", "defaultMin": 9999}, token=TOKEN)
a2 = d.get("activity", {})
check("time/activities", "PATCH 改名 + defaultMin 钳制到 720",
      s == 200 and a2.get("name") == "QA-分类-精读" and a2.get("default_min") == 720,
      "200 name 更新, default_min=720", f"{s} {str(d)[:150]}", "PATCH {name, defaultMin:9999}")
s, d = api("PATCH", f"/api/activities/{str(uuid.uuid4())}", {"name": "QA-越权分类"}, token=TOKEN)
check("time/activities", "PATCH 不存在分类 → 404", s == 404, "404", f"{s} {str(d)[:150]}",
      "PATCH /api/activities/<random>")

s, d = api("DELETE", f"/api/activities/work", token=TOKEN)
check("time/activities", "DELETE 预设分类 → 400 拒绝", s == 400 and "预设" in str(d.get("error", "")),
      "400 预设分类不可删除", f"{s} {str(d)[:150]}", "DELETE /api/activities/work")
s, d = api("DELETE", f"/api/activities/{str(uuid.uuid4())}", token=TOKEN)
check("time/activities", "DELETE 不存在分类 → 404", s == 404, "404", f"{s} {str(d)[:150]}",
      "DELETE /api/activities/<random>")
s, d = api("DELETE", f"/api/activities/{act.get('id')}", token=TOKEN)
if s == 200 and act.get("id") in CREATED["activities"]:
    CREATED["activities"].remove(act["id"])
s2, d2 = api("DELETE", f"/api/activities/{act.get('id')}", token=TOKEN)
check("time/activities", "DELETE 自定义分类 → ok 且再删 404",
      s == 200 and d.get("reassigned") is True and s2 == 404, "200 {ok,reassigned:true}, 再删 404",
      f"del={s} reget={s2}", "DELETE 自定义分类")

# ================================================================ TIME: blocks
print("=" * 72)
print("域: time / blocks")

# 选一个当前无时间块的日期，避免与存量数据冲突
D0 = None
for cand in ["2025-06-17", "2025-04-09", "2025-05-21", "2025-07-02", "2025-08-13"]:
    s, d = api("GET", f"/api/blocks/range?from={cand}&to={cand}", token=TOKEN)
    if s == 200 and not d.get("blocks"):
        D0 = cand
        break
check("time/blocks", "找到无存量块的测试日期", D0 is not None, "存在空日期", str(D0),
      "GET /api/blocks/range 探测")

def iso(day, hm):
    return f"{day}T{hm}:00+08:00"

s, d = api("POST", "/api/blocks", {"title": "QA-时间块-A", "activityId": "work",
                                   "startAt": iso(D0, "10:00"), "endAt": iso(D0, "11:00")}, token=TOKEN)
bA = d.get("block", {})
if bA.get("id"):
    CREATED["blocks"].append(bA["id"])
check("time/blocks", "手动创建时间块 source=manual time_mode=manual",
      s == 200 and bA.get("source") == "manual" and bA.get("time_mode") == "manual"
      and bA.get("activity_id") == "work",
      "200 block(source=manual,time_mode=manual)", f"{s} {str(d)[:200]}", "POST /api/blocks 全字段")

s, d = api("POST", "/api/blocks", {"title": "QA-时间块-缺字段", "startAt": iso(D0, "16:00"),
                                   "endAt": iso(D0, "17:00")}, token=TOKEN)
check("time/blocks", "缺 activityId → 400", s == 400, "400(标题、起止时间、类别均必填)", f"{s} {str(d)[:150]}",
      "POST 缺 activityId")
s, d = api("POST", "/api/blocks", {"title": " ", "activityId": "work", "startAt": iso(D0, "16:00"),
                                   "endAt": iso(D0, "17:00")}, token=TOKEN)
expect_eq("time/blocks", "空标题 → 400", s, 400, "POST 空标题")

# 重叠
s, d = api("POST", "/api/blocks", {"title": "QA-时间块-重叠", "activityId": "work",
                                   "startAt": iso(D0, "10:30"), "endAt": iso(D0, "11:30")}, token=TOKEN)
conflict = d.get("conflict", {})
check("time/blocks", "与已有块重叠 → 409 且 conflict 指向块A",
      s == 409 and conflict.get("id") == bA.get("id") and bA.get("title") in str(d.get("error", "")),
      "409 conflict.id=块A, 错误文案含块A标题", f"{s} error={str(d.get('error', ''))[:120]} conflict={str(conflict)[:120]}",
      "POST 10:30-11:30(与A 10:00-11:00 重叠)")
s, d = api("POST", "/api/blocks", {"title": "QA-时间块-包裹", "activityId": "work",
                                   "startAt": iso(D0, "09:00"), "endAt": iso(D0, "12:00")}, token=TOKEN)
check("time/blocks", "包裹已有块 → 409", s == 409, "409", f"{s} {str(d)[:150]}", "POST 09:00-12:00 包裹A")

# 相邻（[) 区间，端点相接允许）
s, d = api("POST", "/api/blocks", {"title": "QA-时间块-相邻后", "activityId": "study",
                                   "startAt": iso(D0, "11:00"), "endAt": iso(D0, "12:00")}, token=TOKEN)
bB = d.get("block", {})
if bB.get("id"):
    CREATED["blocks"].append(bB["id"])
s2, d2 = api("POST", "/api/blocks", {"title": "QA-时间块-相邻前", "activityId": "study",
                                     "startAt": iso(D0, "09:00"), "endAt": iso(D0, "10:00")}, token=TOKEN)
bC = d2.get("block", {})
if bC.get("id"):
    CREATED["blocks"].append(bC["id"])
check("time/blocks", "端点相接(09-10, 11-12) 允许创建", s == 200 and s2 == 200, "两次均 200",
      f"后邻={s} 前邻={s2}", "POST 相邻时段")

# end<=start / 非法日期
s, d = api("POST", "/api/blocks", {"title": "QA-时间块-零长", "activityId": "work",
                                   "startAt": iso(D0, "15:00"), "endAt": iso(D0, "15:00")}, token=TOKEN)
check("time/blocks", "end==start → 400", s == 400, "400(结束时间必须晚于开始时间)", f"{s} {str(d)[:150]}",
      "POST start=end=15:00")
s, d = api("POST", "/api/blocks", {"title": "QA-时间块-倒挂", "activityId": "work",
                                   "startAt": iso(D0, "15:00"), "endAt": iso(D0, "14:00")}, token=TOKEN)
check("time/blocks", "end<start → 400", s == 400, "400", f"{s} {str(d)[:200]}",
      "POST start=15:00 end=14:00")
s, d = api("POST", "/api/blocks", {"title": "QA-时间块-坏日期", "activityId": "work",
                                   "startAt": f"{D0}T25:99:00+08:00", "endAt": iso(D0, "18:00")}, token=TOKEN)
check("time/blocks", "非法日期串 → 400", s == 400, "400", f"{s} {str(d)[:200]}",
      "POST startAt=…T25:99:00+08:00")

# 区间查询
s, d = api("GET", f"/api/blocks/range?from={D0}&to={D0}", token=TOKEN)
rb = d.get("blocks", [])
have = {b["id"] for b in rb}
check("time/blocks", "GET range 当日返回全部 3 个新块",
      s == 200 and {bA.get("id"), bB.get("id"), bC.get("id")} <= have, "3 个块均在",
      f"{s} n={len(rb)}", f"GET /api/blocks/range?from={D0}&to={D0}")
s, d = api("GET", "/api/blocks/range?from=2025-13-01&to=2025-13-01", token=TOKEN)
check("time/blocks", "range 非法月份格式 → 400", s == 400, "400(from/to 需为合法日期)", f"{s} {str(d)[:150]}",
      "GET range from=2025-13-01")
s, d = api("GET", f"/api/blocks/range?from={D0}&to=2020-01-01", token=TOKEN)
check("time/blocks", "range from>to → 400", s == 400, "400(from ≤ to)", f"{s} {str(d)[:150]}", "GET range from>to")

# PATCH
s, d = api("PATCH", f"/api/blocks/{bA.get('id')}", {"title": "QA-时间块-A改"}, token=TOKEN)
check("time/blocks", "PATCH 改标题", s == 200 and d.get("block", {}).get("title") == "QA-时间块-A改",
      "200 新标题", f"{s} {str(d)[:150]}", f"PATCH /api/blocks/{bA.get('id')} {{title}}")
s, d = api("PATCH", f"/api/blocks/{bA.get('id')}", {"startAt": iso(D0, "10:30"), "endAt": iso(D0, "11:30")},
           token=TOKEN)
check("time/blocks", "PATCH 移入他块时段 → 409", s == 409, "409(与 11:00-12:00 块重叠)", f"{s} {str(d)[:150]}",
      "PATCH A → 10:30-11:30")
s, d = api("PATCH", f"/api/blocks/{bA.get('id')}", {"startAt": iso(D0, "14:00"), "endAt": iso(D0, "15:00")},
           token=TOKEN)
bA2 = d.get("block", {})
check("time/blocks", "PATCH 移到空闲时段 → 200", s == 200 and str(bA2.get("start_at", "")).startswith(f"{D0}T06:00"),
      "200 start=14:00+08(06:00Z)", f"{s} start_at={bA2.get('start_at')}", "PATCH A → 14:00-15:00")
s, d = api("PATCH", f"/api/blocks/{bA.get('id')}", {"endAt": iso(D0, "14:00")}, token=TOKEN)
check("time/blocks", "PATCH end==start → 400", s == 400, "400(结束晚于开始)", f"{s} {str(d)[:150]}",
      "PATCH endAt=startAt")
s, d = api("PATCH", f"/api/blocks/{bA.get('id')}", {"activityId": str(uuid.uuid4())}, token=TOKEN)
check("time/blocks", "PATCH 不存在类别 → 400(类别不存在)", s == 400, "400 类别不存在", f"{s} {str(d)[:150]}",
      "PATCH {activityId:<random>}")
s, d = api("PATCH", f"/api/blocks/{str(uuid.uuid4())}", {"title": "QA-越权块"}, token=TOKEN)
check("time/blocks", "PATCH 不存在块 → 404", s == 404, "404", f"{s} {str(d)[:150]}", "PATCH <random>")

# DELETE
s, d = api("DELETE", f"/api/blocks/{bC.get('id')}", token=TOKEN)
if s == 200 and bC.get("id") in CREATED["blocks"]:
    CREATED["blocks"].remove(bC["id"])
s2, d2 = api("DELETE", f"/api/blocks/{bC.get('id')}", token=TOKEN)
check("time/blocks", "DELETE 块 → ok 且再删 404", s == 200 and d.get("ok") is True and s2 == 404,
      "200 {ok:true}, 再删 404", f"del={s} re={s2}", "DELETE /api/blocks/:id")

# ================================================================ TIME: stats
print("=" * 72)
print("域: time / stats.range")

SD1, SD2 = None, None
for cand in ["2025-03-11", "2025-01-15", "2025-02-19", "2025-04-23"]:
    s, d1 = api("GET", f"/api/blocks/range?from={cand}&to={cand}", token=TOKEN)
    nxt = (datetime.strptime(cand, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    s2, d2 = api("GET", f"/api/blocks/range?from={nxt}&to={nxt}", token=TOKEN)
    if s == 200 and s2 == 200 and not d1.get("blocks") and not d2.get("blocks"):
        SD1, SD2 = cand, nxt
        break
check("time/stats", "找到连续两天无存量块的日期", SD1 is not None, "两个连续空日期", f"{SD1}..{SD2}", "range 探测")

sb = []
for payload in [
    {"title": "QA-统计-工作", "activityId": "work", "startAt": iso(SD1, "10:00"), "endAt": iso(SD1, "11:00")},   # 60
    {"title": "QA-统计-学习", "activityId": "study", "startAt": iso(SD1, "13:00"), "endAt": iso(SD1, "14:30")},  # 90
    {"title": "QA-统计-跨天", "activityId": "sleep", "startAt": iso(SD1, "23:00"), "endAt": iso(SD2, "01:00")},  # 60+60
]:
    s, d = api("POST", "/api/blocks", payload, token=TOKEN)
    if d.get("block", {}).get("id"):
        CREATED["blocks"].append(d["block"]["id"])
        sb.append(d["block"]["id"])
check("time/stats", "准备 3 个统计用块(60/90/跨天120)", len(sb) == 3, "3 块创建成功", f"created={len(sb)}",
      "POST /api/blocks x3")

s, d = api("GET", f"/api/stats/range?from={SD1}&to={SD2}", token=TOKEN)
days = {x["date"]: x for x in d.get("days", [])}
totals = d.get("totals", {})
d1x, d2x = days.get(SD1, {}), days.get(SD2, {})
check("time/stats", "按日按类聚合: D1 work60+study90+sleep60=210, D2 sleep60",
      s == 200 and len(days) == 2
      and d1x.get("byActivity", {}).get("work") == 60 and d1x.get("byActivity", {}).get("study") == 90
      and d1x.get("byActivity", {}).get("sleep") == 60 and d1x.get("totalMin") == 210
      and d2x.get("byActivity", {}).get("sleep") == 60 and d2x.get("totalMin") == 60,
      f"D1{{work:60,study:90,sleep:60,totalMin:210}}, D2{{sleep:60,totalMin:60}}",
      f"{s} days={json.dumps(days, ensure_ascii=False)[:300]}", f"GET /api/stats/range?from={SD1}&to={SD2}")
check("time/stats", "跨天块总时长对账 totals work=60 study=90 sleep=120",
      totals.get("work") == 60 and totals.get("study") == 90 and totals.get("sleep") == 120,
      "totals{work:60,study:90,sleep:120}", f"totals={totals}", "GET stats 对账(与创建块时长一致)")

s, d = api("GET", f"/api/stats/range?from={SD2}&to={SD1}", token=TOKEN)
check("time/stats", "stats from>to → 400", s == 400, "400", f"{s} {str(d)[:150]}", "GET stats from>to")
s, d = api("GET", "/api/stats/range?from=bad&to=2025-01-01", token=TOKEN)
check("time/stats", "stats 非法日期 → 400", s == 400, "400", f"{s} {str(d)[:150]}", "GET stats from=bad")
s, d = api("GET", "/api/stats/range?from=2025-13-01&to=2025-13-01", token=TOKEN)
check("time/stats", "stats 合法格式但不存在的日期(2025-13-01) → 400", s == 400, "400",
      f"{s} body={str(d)[:120]}", "GET stats from=2025-13-01(格式合规但月份非法)")

# ================================================================ 清理 + 汇总
print("=" * 72)
print("清理测试数据...")
for tid in list(CREATED["todos"]):
    if api("DELETE", f"/api/todos/{tid}", token=TOKEN)[0] == 200:
        CREATED["todos"].remove(tid)
for rid in list(CREATED["reflections"]):
    if api("DELETE", f"/api/spaces/{CREATED['space_for_reflections']}/reflections/{rid}", token=TOKEN)[0] == 200:        CREATED["reflections"].remove(rid)
for sid in list(CREATED["spaces"]):
    if api("DELETE", f"/api/spaces/{sid}", token=TOKEN)[0] == 200:
        CREATED["spaces"].remove(sid)
for bid in list(CREATED["blocks"]):
    if api("DELETE", f"/api/blocks/{bid}", token=TOKEN)[0] == 200:
        CREATED["blocks"].remove(bid)
for aid in list(CREATED["activities"]):
    if api("DELETE", f"/api/activities/{aid}", token=TOKEN)[0] == 200:
        CREATED["activities"].remove(aid)
leftover = postclean_verify()
print(f"清理完成, 服务端反查 QA- 残留: {leftover if leftover else '无'}")

fails = [r for r in RESULTS if not r[2]]
print("\n" + "=" * 72)
for dom in ["auth", "goal/todos", "goal/spaces", "goal/reflections", "time/activities", "time/blocks", "time/stats"]:
    rows = [r for r in RESULTS if r[0] == dom]
    print(f"### {dom}: PASS {sum(1 for r in rows if r[2])} / FAIL {sum(1 for r in rows if not r[2])}")
print("=" * 72)
print(f"总计: PASS {len(RESULTS) - len(fails)} / FAIL {len(fails)}")
if fails:
    print("\nFAIL 明细:")
    for dom, name, _, exp, act, req in fails:
        print(f"- [{dom}] {name}\n  请求: {req}\n  期望: {exp}\n  实际: {act}")
