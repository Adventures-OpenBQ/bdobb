#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Run-5 backend-only widget protocol: default + one non-default request per widget, HTTP level only.

usage: sweep5.py <LOGICAL> <base_url> <widgets.json> <out.jsonl> [workers<=4]
Base URL comes from the operator shell; output records the logical name only. Resumes (skips ids in out).
Reuses ../../backend-sweep/sweep_lib.py (defaults/alternative). Additions over run 4:
- a 405 on GET is retried as POST with the params as a JSON body (omni / multi_file_viewer contract);
- advanced_charting widgets also probe <endpoint>/config (TradingView UDF handshake);
- non-default fallback when no option/bool/optionsEndpoint alternative exists: symbol/ticker text swap,
  start_date/date -> fixed 2025-01-02, limit -> 5;
- stall guard: a request >45 s or a transport failure pauses all workers 30 s; 5 in a row aborts.
"""
import json, os, sys, time, threading, urllib.request, urllib.parse, concurrent.futures as cf
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../backend-sweep"))
import sweep_lib as S

name, base, wpath, out = sys.argv[1:5]
workers = min(int(sys.argv[5]) if len(sys.argv) > 5 else 3, 4)
S.base = base
W = json.load(open(wpath))
lock, pause_until, streak = threading.Lock(), [0.0], [0]

def call(path, params, method="GET", timeout=60):
    while time.time() < pause_until[0]: time.sleep(1)
    url = path if path.startswith("http") else base.rstrip("/") + "/" + path.lstrip("/")
    data, hdr = None, {"accept": "*/*"}
    if method == "GET":
        q = {k: (",".join(map(str, v)) if isinstance(v, list) else str(v).lower() if isinstance(v, bool) else v)
             for k, v in params.items() if v is not None and v != ""}
        if q: url += ("&" if "?" in url else "?") + urllib.parse.urlencode(q)
    else:
        data, hdr["content-type"] = json.dumps(params).encode(), "application/json"
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=hdr, method=method), timeout=timeout) as r:
            body, code, ctype = r.read(), r.status, r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        body, code, ctype = e.read(), e.code, e.headers.get("content-type", "")
    except Exception as e:
        body, code, ctype = None, None, ""
        err = type(e).__name__ + ": " + str(e)[:200]
    ms = int((time.time() - t) * 1000)
    with lock:  # stall guard (single uvicorn worker on OPENBQ_API)
        if code is None or ms > 45000:
            streak[0] += 1; pause_until[0] = time.time() + 30
        else: streak[0] = 0
    if code is None: return {"method": method, "code": None, "error": err, "ms": ms}
    rec = {"method": method, "code": code, "bytes": len(body), "ctype": ctype.split(";")[0], "ms": ms}
    try:
        j = json.loads(body); rec["shape"] = type(j).__name__
        if isinstance(j, list): rec["rows"] = len(j)
        elif isinstance(j, dict):
            for k in ("results", "data", "rows"):
                if isinstance(j.get(k), list): rec["rows"] = len(j[k]); break
            if code >= 400: rec["detail"] = str(j.get("detail", j))[:300]
    except Exception:
        if code >= 400: rec["detail"] = body[:300].decode("utf-8", "replace")
    return rec

def probe(ep, params):
    r = call(ep, params)
    return call(ep, params, "POST") | {"get_code": 405} if r.get("code") == 405 else r

def fallback(w, d):
    for p in w.get("params") or []:
        if not isinstance(p, dict) or p.get("show") is False: continue
        n, t, cur = p.get("paramName") or "", p.get("type"), d.get(p.get("paramName"))
        if t == "text" and n in ("symbol", "ticker", "symbols", "tickers"): return n, "AAPL" if str(cur).upper() == "MSFT" else "MSFT"
        if t == "date" and n in ("start_date", "date") and cur != "2025-01-02": return n, "2025-01-02"
        if t == "number" and n == "limit" and cur != 5: return n, 5
    return None

def run(item):
    wid, w = item
    ep = w.get("endpoint")
    rec = {"service": name, "widget_id": wid, "type": w.get("type"), "endpoint": ep}
    if not ep: rec["default"] = {"code": None, "error": "no endpoint"}; return rec
    d = S.defaults(w); rec["default_params"] = d; rec["default"] = probe(ep, d)
    if w.get("type") == "advanced_charting": rec["udf_config"] = call(ep.rstrip("/") + "/config", {})
    alt = S.alternative(w, d) or fallback(w, d)
    if alt:
        d2 = dict(d); d2[alt[0]] = alt[1]; rec["nondefault_params"] = {alt[0]: alt[1]}; rec["nondefault"] = probe(ep, d2)
    else: rec["nondefault"] = "not_applicable"
    return rec

if __name__ == "__main__":
    done = {json.loads(l)["widget_id"] for l in open(out)} if os.path.exists(out) else set()
    todo = [(k, v) for k, v in W.items() if k not in done]
    with open(out, "a") as f, cf.ThreadPoolExecutor(workers) as ex:
        for rec in ex.map(run, todo):
            f.write(json.dumps(rec) + "\n"); f.flush()
            if streak[0] >= 5: print("ABORT: 5 consecutive stalls at", rec["widget_id"]); os._exit(2)
    print("COMPLETE", len(todo))
