#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""V6-002 Rita /v1/query probe: SSE order + keepalive, two-turn history, cancel + next turn,
malformed body, unknown model, unreachable model. usage: rita_probe.py <rita_url> <out.json>"""
import json, sys, time, http.client, urllib.parse
base, out = sys.argv[1:3]
u = urllib.parse.urlparse(base)
def body(messages, **ws):
    return {"messages": messages, "widgets": {"primary": [], "secondary": [], "extra": []}, "context": None, "urls": [],
            "timezone": "America/New_York", "workspace_options": ws, "tools": [], "skills_catalog": [], "selected_skills": []}
def query(payload, cancel_after=None, raw=None, timeout=300):
    c = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout)
    data = raw if raw is not None else json.dumps(payload).encode()
    t0 = time.time(); c.request("POST", "/v1/query", data, {"content-type": "application/json", "accept": "text/event-stream"})
    r = c.getresponse(); rec = {"status": r.status, "ctype": r.getheader("content-type"), "events": [], "keepalives": 0, "text": ""}
    if r.status != 200: rec["body"] = r.read().decode()[:800]; return rec
    ev = None; buf = []
    while True:
        line = r.readline()
        if not line: break
        line = line.decode().rstrip("\r\n")
        if line.startswith(":"): rec["keepalives"] += 1; continue
        if line.startswith("event:"): ev = line[6:].strip(); continue
        if line.startswith("data:"): buf.append(line[5:].lstrip()); continue
        if line == "" and (ev or buf):
            d = "\n".join(buf); rec["events"].append({"event": ev or "message", "t": round(time.time()-t0, 2), "data": d[:300]})
            if ev == "copilotMessageChunk":
                try: rec["text"] += json.loads(d).get("delta", "")
                except Exception: pass
            ev = None; buf = []
            if cancel_after and len(rec["events"]) >= cancel_after: rec["cancelled_after_events"] = len(rec["events"]); c.close(); return rec
    rec["elapsed"] = round(time.time()-t0, 2); return rec
def order(rec): 
    seq = []
    for e in rec.get("events", []):
        if not seq or seq[-1] != e["event"]: seq.append(e["event"])
    return seq
R = {}
h1 = [{"role": "human", "content": "Remember this code word: ZEBRA-41. Reply with exactly: STORED"}]
R["turn1"] = query(body(h1)); R["turn1"]["order"] = order(R["turn1"])
h2 = h1 + [{"role": "ai", "content": R["turn1"]["text"] or "STORED"}, {"role": "human", "content": "What code word did I give you? Reply with only the code word."}]
R["turn2"] = query(body(h2)); R["turn2"]["order"] = order(R["turn2"])
R["cancel"] = query(body([{"role": "human", "content": "Write a 600-word essay about index funds."}]), cancel_after=3)
R["after_cancel"] = query(body([{"role": "human", "content": "Reply with exactly: RECOVERED"}])); R["after_cancel"]["order"] = order(R["after_cancel"])
R["malformed_json"] = query(None, raw=b"{not json")
R["malformed_shape"] = query(None, raw=json.dumps({"messages": None, "tools": None}).encode())
R["unknown_model"] = query(body([{"role": "human", "content": "Reply OK"}], model="openai:no-such-model-xyz")); R["unknown_model"]["order"] = order(R["unknown_model"])
R["unreachable_model"] = query(body([{"role": "human", "content": "Reply OK"}], model="ollama:qwen3.5:9b"), timeout=200); R["unreachable_model"]["order"] = order(R["unreachable_model"])
json.dump(R, open(out, "w"), indent=1)
for k, v in R.items(): print(k, v["status"], v.get("order"), "keepalives", v.get("keepalives"), "text:", (v.get("text") or "")[:120], "body:", v.get("body", "")[:200], [e for e in v.get("events", []) if e["event"] not in ("copilotMessageChunk",)][-2:] if k in ("unknown_model","unreachable_model") else "")
