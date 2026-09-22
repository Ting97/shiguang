# -*- coding: utf-8 -*-
"""3-D 端到端：mode=on 混合引擎 + 空间 Jev 归属"""
import json, urllib.request, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:3100"

def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    with urllib.request.urlopen(req, data=data) as r:
        return json.loads(r.read().decode())

print(call("PUT", "/api/admin/ai-mode", {"mode": "on"}))
space = call("POST", "/api/spaces", {"name": "E2E考研", "description": "备考复习与资料"})
sid = space.get("space", {}).get("id") or space.get("id")
print("space:", sid)
entry = call("POST", "/api/parse", {"text": "下午做了两套考研英语真题，买资料花了45块"})
print("entry:", entry["entry"]["id"])
open("/tmp/e2e_ids.json", "w").write(json.dumps({"space": sid, "entry": entry["entry"]["id"]}))
