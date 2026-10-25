#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Per-card coverage ledger: one row per served card placement, joined with backend-sweep results.
usage: build_coverage.py <service> <apps.json> <app name> <sweep.jsonl> <outcomes.json> <out.tsv>
outcomes.json maps widgetId -> [renderer_status, interaction_status, note, screenshot]."""
import json, sys
svc, apps, name, sweep, outc, out = sys.argv[1:7]
app = next(a for a in json.load(open(apps)) if a["name"] == name)
B = {json.loads(l)["widget_id"]: json.loads(l) for l in open(sweep)}
O = json.load(open(outc))
rows = ["service\tapp\ttab\twidget_id\tbackend_default\tbackend_nondefault\trenderer\tinteraction\tnote\tscreenshot"]
for t in app["tabs"].values():
    for c in t["layout"]:
        w = c["i"]; b = B.get(w, {}); d = (b.get("default") or {}).get("code"); nd = b.get("nondefault")
        nd = nd.get("code") if isinstance(nd, dict) else nd
        r = O.get(w, ["NOT_RUN", "NOT_RUN", "", ""])
        rows.append("\t".join(map(str, [svc, name, t["name"], w, d, nd, *r])))
open(out, "w").write("\n".join(rows) + "\n")
import collections; print(len(rows) - 1, collections.Counter(r.split("\t")[6] for r in rows[1:]), collections.Counter(r.split("\t")[7] for r in rows[1:]))
