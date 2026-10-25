#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""V6-002 calendar availability: available_tools(category=calendar) then call_tool on each for XNYS 2026 (first attempt with wrong arg names preserved in git history of this run log)."""
import json, sys, urllib.request
url, out = sys.argv[1:3]
H = {"content-type": "application/json", "accept": "application/json, text/event-stream"}
def rpc(m, p, sid=None, i=1):
    h = dict(H, **({"mcp-session-id": sid} if sid else {}))
    r = urllib.request.urlopen(urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": i, "method": m, "params": p}).encode(), h), timeout=180)
    sid2 = r.headers.get("mcp-session-id"); t = r.read().decode()
    d = [json.loads(l[5:]) for l in t.splitlines() if l.startswith("data:")]
    return sid2, d[0] if d else json.loads(t)
sid, _ = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "v6-regression", "version": "1"}})
urllib.request.urlopen(urllib.request.Request(url, b'{"jsonrpc":"2.0","method":"notifications/initialized"}', dict(H, **{"mcp-session-id": sid})), timeout=30)
R = {}
_, R["available_tools_calendar"] = rpc("tools/call", {"name": "available_tools", "arguments": {"category": "calendar"}}, sid, 2)
txt = R["available_tools_calendar"]["result"]["content"][0]["text"]
tools = json.loads(txt); R["calendar_tool_names"] = [t.get("name") for t in (tools if isinstance(tools, list) else tools.get("tools", []))]
for i, n in enumerate(R["calendar_tool_names"]):
    _, res = rpc("tools/call", {"name": "call_tool", "arguments": {"name": n, "arguments": {"exchange": "XNYS", "year": 2026}}}, sid, 10 + i)
    c = res.get("result", {}); R["call_" + n] = {"isError": c.get("isError"), "text_head": (c.get("content") or [{}])[0].get("text", "")[:400]}
json.dump(R, open(out, "w"), indent=1); print(json.dumps({k: v for k, v in R.items() if k != "available_tools_calendar"}, indent=1)); print(txt[:800])
