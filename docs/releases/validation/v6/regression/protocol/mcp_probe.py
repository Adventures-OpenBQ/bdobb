#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""V6-002 MCP probe: initialize, session reuse, stale session, tools/list, categories, calendar, bad calls.
usage: mcp_probe.py <mcp_url> <out.json>  (url from operator shell; output carries no hostname)"""
import json, sys, urllib.request, uuid
url, out = sys.argv[1:3]
H = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
def rpc(method, params=None, sid=None, id_=1, raw=None):
    h = dict(H)
    if sid: h["mcp-session-id"] = sid; h["mcp-protocol-version"] = "2025-06-18"
    body = raw if raw is not None else json.dumps({"jsonrpc": "2.0", **({"id": id_} if id_ is not None else {}), "method": method, **({"params": params} if params is not None else {})}).encode()
    req = urllib.request.Request(url, data=body, headers=h, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r: code, hdr, txt = r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e: code, hdr, txt = e.code, dict(e.headers), e.read().decode()
    msgs = []
    for line in txt.splitlines():
        if line.startswith("data:"):
            try: msgs.append(json.loads(line[5:]))
            except Exception: msgs.append(line[5:])
    if not msgs and txt.strip():
        try: msgs.append(json.loads(txt))
        except Exception: msgs.append(txt[:500])
    return {"status": code, "session": hdr.get("mcp-session-id") or hdr.get("Mcp-Session-Id"), "ctype": hdr.get("content-type") or hdr.get("Content-Type"), "messages": msgs}
R = {}
init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "v6-regression", "version": "1"}})
R["initialize"] = init; sid = init["session"]
R["initialized_notification"] = rpc("notifications/initialized", sid=sid, id_=None)
tl = rpc("tools/list", {}, sid=sid, id_=2)
tools = (tl["messages"][0].get("result", {}) if tl["messages"] and isinstance(tl["messages"][0], dict) else {}).get("tools", [])
R["tools_list"] = {"status": tl["status"], "count": len(tools), "names": [t["name"] for t in tools],
                   "schemas_ok": all(isinstance(t.get("inputSchema"), dict) and t["inputSchema"].get("type") == "object" for t in tools)}
R["tools_full"] = tools
R["session_reuse_second_list"] = {k: v for k, v in rpc("tools/list", {}, sid=sid, id_=3).items() if k != "messages"}
R["stale_session"] = rpc("tools/list", {}, sid=uuid.uuid4().hex, id_=4)
R["no_session"] = rpc("tools/list", {}, id_=5)
names = [t["name"] for t in tools]
def call(name, args, i): return rpc("tools/call", {"name": name, "arguments": args}, sid=sid, id_=i)
cat = next((n for n in names if "categor" in n), None)
R["category_tool"] = cat
if cat: R["categories_call"] = call(cat, {}, 10)
R["calendar_tools"] = [n for n in names if "calendar" in n.lower()]
R["unknown_tool"] = call("no_such_tool_xyz", {}, 11)
# bad arguments: first tool that declares a required property, called with a wrong-typed junk argument set
req_tool = next((t for t in tools if t.get("inputSchema", {}).get("required")), None)
if req_tool: R["bad_arguments"] = {"tool": req_tool["name"], "result": call(req_tool["name"], {"__bogus__": 1}, 12)}
R["malformed_jsonrpc"] = rpc(None, raw=b"{not json", sid=sid)
json.dump(R, open(out, "w"), indent=1)
print(json.dumps({k: (v if k not in ("tools_full", "categories_call") else "...") for k, v in R.items()}, indent=1)[:6000])
