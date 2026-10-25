#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Upsert one case record into ledger/results.json (result-template.json shape) and re-render ledger.md.
usage: rec.py CASE_ID STATUS 'expected' 'actual' 'artifact1,artifact2' [--issue X] [--limitation X] [--rerun-of X] [--class BACKEND|CLIENT|UPSTREAM|ENV] [--mandatory 0|1]
       rec.py --render"""
import json, sys, os, argparse
D = os.path.dirname(os.path.abspath(__file__)); F = os.path.join(D, "results.json")
HEAD = {"schema_version": 1, "release": "v6", "client_commit": "54356502828abcc80bc93a9b25b89b2522d00e1e",
        "overlay_hash": "none (no overlay; clean tree at HEAD)",
        "binary_sha256": "7b752cfa01790859f7c580a3314c64d1d3d46a2c28a5c29846693818939e1b67",
        "bundle_tree_sha256": "08add536f987b1689141da00089106bbf859d5c64022c1ea9ed51fc3ed37671f",
        "platform": "macOS 27.0.1 (26A434) arm64, native Tauri bundle com.artcashin.bdobb.clean.v6 6.0.0",
        "services": "see ../manifests/services.md", "fixture_manifest": "fixture-inventory.json (26/26 hashes match, ../manifests/fixtures.tsv)",
        "results": [], "summary": {}}
d = {**HEAD, **json.load(open(F))} if os.path.exists(F) else HEAD
if sys.argv[1] != "--render":
    p = argparse.ArgumentParser(); [p.add_argument(a) for a in ("case_id", "status", "expected", "actual", "artifacts")]
    for o in ("--issue", "--limitation", "--rerun-of", "--class", "--input", "--widget", "--app", "--tab", "--card"): p.add_argument(o)
    p.add_argument("--mandatory", default="1")
    a = p.parse_args()
    assert a.status in ("PASS", "FAIL", "BLOCKED", "PARTIAL", "NOT_APPLICABLE", "NOT_RUN"), a.status
    r = {"case_id": a.case_id, "widget_id": a.widget, "app": a.app, "tab": a.tab, "card_id": a.card,
         "input": json.loads(a.input) if a.input else {}, "expected": a.expected, "actual": a.actual, "status": a.status,
         "artifacts": [x for x in a.artifacts.split(",") if x], "issue": a.issue, "limitation": a.limitation,
         "rerun_of": a.rerun_of, "failure_class": a.__dict__["class"], "mandatory": a.mandatory == "1"}
    d["results"] = [x for x in d["results"] if x["case_id"] != a.case_id] + [r]
order = lambda c: (c["case_id"].split("-")[0], c["case_id"])
d["results"].sort(key=order)
m = [r for r in d["results"] if r["mandatory"]]
cnt = lambda s: sum(1 for r in m if r["status"] == s)
d["summary"] = {"mandatory_not_run": cnt("NOT_RUN"), "mandatory_blocked": cnt("BLOCKED"), "mandatory_fail": cnt("FAIL"),
                "mandatory_partial": cnt("PARTIAL"), "mandatory_pass": cnt("PASS"), "not_applicable": cnt("NOT_APPLICABLE"),
                "certified": all(r["status"] in ("PASS", "NOT_APPLICABLE") for r in m) and len(m) > 0}
json.dump(d, open(F, "w"), indent=1)
with open(os.path.join(D, "ledger.md"), "w") as f:
    f.write("# v6 regression case ledger\n\nGenerated from results.json by rec.py. Summary: " + json.dumps(d["summary"]) + "\n\n")
    f.write("| Case | Status | Class | Evidence | Receipts |\n|---|---|---|---|---|\n")
    for r in d["results"]:
        f.write(f"| {r['case_id']} | {r['status']} | {r.get('failure_class') or ''} | {r['actual'].replace('|','/')} | {', '.join(r['artifacts'])} |\n")
print(d["summary"])
