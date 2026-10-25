#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Supplemental OPENBQ_API pass for widgets whose descriptor default failed for a missing required input.
usage (from run5/): seeded.py <base_url>  -> backend-sweep/openbq-seeded.jsonl
Seed = the widget's first apps.json card state params (if placed), else symbol=AAPL when the error names `symbol`.
Serial, 0.5 s spacing, reuses sweep5.call (stall guard). Not a substitute for the descriptor-default result."""
import json, re, sys, time, os
sys.argv = [sys.argv[0], "OPENBQ_API", sys.argv[1], "services/OPENBQ_API-widgets.json", "/dev/null", "1"]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sweep5 as ns
W = json.load(open("services/OPENBQ_API-widgets.json"))
card = {}
for a in json.load(open("services/OPENBQ_API-apps.json")):
    for t in a["tabs"].values():
        for c in t["layout"]:
            p = (c.get("state") or {}).get("params")
            if p: card.setdefault(c["i"], p)
if not os.environ.get("VIEWERS_ONLY"):
    out = open("backend-sweep/openbq-seeded.jsonl", "w")
    for l in open("backend-sweep/openbq.jsonl"):
        r = json.loads(l); d = r["default"]
        if d.get("code") not in (400, 422, 500) or not re.search(r"Field required|symbol", str(d.get("detail"))): continue
        params = dict(r["default_params"])
        if r["widget_id"] in card: params.update(card[r["widget_id"]]); seed = "app_card_state"
        elif "symbol" in str(d.get("detail")): params["symbol"] = "AAPL"; seed = "symbol=AAPL"
        else:
            out.write(json.dumps({"widget_id": r["widget_id"], "seed": None, "note": "missing field is not symbol and widget is unplaced"}) + "\n"); continue
        params = {k: (",".join(map(str, v)) if isinstance(v, list) and k != "urls" else v) for k, v in params.items()}
        res = ns.probe(W[r["widget_id"]]["endpoint"], params)
        out.write(json.dumps({"widget_id": r["widget_id"], "seed": seed, "params": params, "result": res}) + "\n"); out.flush()
        if ns.streak[0] >= 5: print("ABORT stalls"); sys.exit(2)
        time.sleep(0.5)

# multi_file_viewer: urls/url is a hidden optionsEndpoint selection with no default. Resolve optionsParams ($ref -> default),
# take the first offered option and POST it, as a viewer selection would.
out = open("backend-sweep/openbq-seeded-viewers.jsonl", "w")
for l in open("backend-sweep/openbq.jsonl"):
    r = json.loads(l); w = W[r["widget_id"]]
    if w.get("type") != "multi_file_viewer" or r["default"].get("code") == 200: continue
    d = dict(r["default_params"]); p = next((p for p in w["params"] if p.get("paramName") in ("urls", "url") and p.get("optionsEndpoint")), None)
    if not p: continue
    q = {k: (d.get(v[1:]) if isinstance(v, str) and v.startswith("$") else v) for k, v in (p.get("optionsParams") or {}).items()}
    rec = {"widget_id": r["widget_id"], "options_params": q}
    try:
        url = ns.urllib.request.urlopen(ns.base.rstrip("/") + p["optionsEndpoint"] + "?" + ns.urllib.parse.urlencode({k: str(v).lower() if isinstance(v, bool) else v for k, v in q.items() if v is not None}), timeout=60)
        opts = json.loads(url.read()); rec["options_count"] = len(opts) if isinstance(opts, list) else None; first = next((x.get("value") if isinstance(x, dict) else x for x in opts), None)
    except Exception as e: first = None; rec["options_error"] = str(e)[:200]
    if first is not None:
        d[p["paramName"]] = [first]; rec["selected"] = first; rec["result"] = ns.call(w["endpoint"], d, "POST")
        if rec["result"].get("code") == 422 and "'body', 'str'" in str(rec["result"].get("detail")):
            # route takes the URL list as the whole JSON body, other params in the query string
            qs = {k: str(v).lower() if isinstance(v, bool) else v for k, v in d.items() if v is not None and k != p["paramName"]}
            rq = ns.urllib.request.Request(ns.base.rstrip("/") + w["endpoint"] + "?" + ns.urllib.parse.urlencode(qs), data=json.dumps([first]).encode(), headers={"content-type": "application/json"}, method="POST")
            try:
                with ns.urllib.request.urlopen(rq, timeout=60) as x: b = x.read(); rec["raw_body_result"] = {"code": x.status, "bytes": len(b)}
            except ns.urllib.error.HTTPError as e: rec["raw_body_result"] = {"code": e.code, "detail": e.read()[:200].decode("utf-8", "replace")}
            except Exception as e: rec["raw_body_result"] = {"code": None, "error": str(e)[:200]}
    out.write(json.dumps(rec) + "\n"); out.flush(); time.sleep(0.5)
print("COMPLETE")
