#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Compare a served apps.json app against the client's saved dashboard file.
usage: compare_import.py <apps.json> <app name> <dashboard.json> [--app-index N]
Checks tab names/order, per-tab card count, widget IDs and x/y/w/h layout, groups."""
import json, sys
apps, name, dash = sys.argv[1:4]
idx = int(sys.argv[5]) if len(sys.argv) > 5 else None
A = [a for a in json.load(open(apps)) if a["name"] == name]
a = A[idx or 0]; d = json.load(open(dash))
tabs = list(a["tabs"].values()) if isinstance(a["tabs"], dict) else a["tabs"]
out = {"app": name, "served_tabs": len(tabs), "saved_tabs": len(d["tabs"]), "tabs": [], "mismatches": 0}
for st, dt in zip(tabs, d["tabs"]):
    sl = st.get("layout", []); dc = dt["cards"]
    rows = []
    for i, s in enumerate(sl):
        c = dc[i] if i < len(dc) else None
        sw = s.get("i"); sx = (s.get("x"), s.get("y"), s.get("w"), s.get("h"))
        cx = tuple(c["layout"][k] for k in "xywh") if c else None
        ok = c is not None and c["widgetId"] == sw and cx == sx
        if not ok: out["mismatches"] += 1
        rows.append({"served": [sw, *sx], "saved": [c["widgetId"], *cx] if c else None, "ok": ok})
    out["tabs"].append({"served_name": st.get("name"), "saved_name": dt["name"], "served_cards": len(sl), "saved_cards": len(dc), "cards": rows})
    if st.get("name") != dt["name"] or len(sl) != len(dc): out["mismatches"] += 1
out["served_cards_total"] = sum(t["served_cards"] for t in out["tabs"]); out["saved_cards_total"] = sum(t["saved_cards"] for t in out["tabs"])
out["served_groups"] = len(a.get("groups", [])); out["saved_groups"] = len(d.get("groups", []))
json.dump(out, open(sys.stdout.fileno(), "w"), indent=1)
