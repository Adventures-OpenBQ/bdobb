#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Serial resume of sweep.py per the user's rule: one request at a time, 30 s timeout,
>=0.5 s between requests; stop if any request exceeds 30 s or 3 consecutive requests fail.
usage: sweep_serial.py <LOGICAL> <base_url> <widgets.json> <out.jsonl>  (skips widget ids already in out)."""
import json, sys, time, os
import sweep_lib as S
name, base, wpath, out = sys.argv[1:5]
S.base = base
W = json.load(open(wpath))
done = {json.loads(l)["widget_id"] for l in open(out)} if os.path.exists(out) else set()
fails = 0
def guard(rec):
    global fails
    time.sleep(0.5)
    if rec.get("code") is None and "timed out" in str(rec.get("error", "")).lower(): return "timeout>30s"
    fails = fails + 1 if (rec.get("code") is None or rec["code"] >= 500) else 0
    return "3 consecutive failures" if fails >= 3 else None
with open(out, "a") as f:
    for wid, w in W.items():
        if wid in done: continue
        ep = w.get("endpoint"); rec = {"service": name, "widget_id": wid, "type": w.get("type"), "endpoint": ep, "mode": "serial-after-restart"}
        if not ep: rec["default"] = {"code": None, "error": "no endpoint"}; f.write(json.dumps(rec) + "\n"); continue
        d = S.defaults(w); rec["default_params"] = d; rec["default"] = S.get(ep, d, 30); stop = guard(rec["default"])
        if not stop:
            alt = S.alternative(w, d)
            if alt:
                d2 = dict(d); d2[alt[0]] = alt[1]; rec["nondefault_params"] = {alt[0]: alt[1]}; rec["nondefault"] = S.get(ep, d2, 30); stop = guard(rec["nondefault"])
            else: rec["nondefault"] = "not_applicable"
        f.write(json.dumps(rec) + "\n"); f.flush()
        if stop: print("STOPPED:", stop, "at", wid); sys.exit(2)
print("COMPLETE")
