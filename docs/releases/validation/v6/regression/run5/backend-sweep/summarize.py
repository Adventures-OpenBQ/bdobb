#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Classify run-5 sweep records and reconcile catalogs. Run from run5/. usage: summarize.py <articles_root>
Writes backend-sweep/summary.json, backend-sweep/failures.tsv and manifests/reconcile.json."""
import json, sys, collections
root = sys.argv[1]
INTENTIONAL = {"markdown_widget_with_error_handling"}

def cls(r, leg):
    x = r.get(leg)
    if x == "not_applicable" or x is None: return "not_applicable"
    c, det = x.get("code"), str(x.get("detail", ""))
    if r["widget_id"] in INTENTIONAL and leg == "default": return "intentional_error" if c == 500 else "intentional_error_missing"
    if r.get("type") == "advanced_charting" and c == 404 and (r.get("udf_config") or {}).get("code") == 200: return "ok_udf_config"
    if c is None: return "transport"
    if 200 <= c < 300: return "ok_empty" if x.get("rows") == 0 else "ok"
    if c == 403 and "OMNI_EXEC_ALLOWED" in det: return "exec_excluded"
    if c in (401, 403): return "auth"
    if c in (400, 422): return "param_rejected"
    if c == 404: return "not_found"
    if c == 405: return "method_not_allowed"
    return "server_error"

load = lambda f: [json.loads(l) for l in open(f)]
import re, os
def dispo(svc, wid, k, det, typ=None):
    if k == "intentional_error": return "INTENTIONAL_ERROR"
    if k == "exec_excluded": return "NO_EXEC_EXCLUSION"
    if k == "transport": return "BACKEND_SERVICE_STALL"
    if re.search(r"Field required|Provide a |Enter a symbol|Symbol is a required|valid `dataflow`|must be provided|'body', 'str'|'body', 'url'|urls\.str", det): return "DESCRIPTOR_INPUT_REQUIRED"
    if typ == "multi_file_viewer" and "NoneType" in det: return "DESCRIPTOR_INPUT_REQUIRED"
    if re.search(r"Please select|Please enter|is required|Could not resolve symbol|Invalid .* for|applies only|No items match", det): return "HARNESS_INPUT_INVALID"
    if "pagination ceiling" in det: return "BACKEND_DEFAULT_TOO_BROAD"
    if re.search(r"Yahoo Finance request failed|Expecting value|rate limit|BadZipFile|HTTP Error 404|not readable|returned no search data|No exchange rate data|TimeoutError|Empty response from OECD|Error with the request: 403|^<!DOCTYPE", det): return "UPSTREAM"
    return "BACKEND_DEFECT"
SEED = {}
for f in ("backend-sweep/openbq-seeded.jsonl", "backend-sweep/openbq-seeded-viewers.jsonl"):
    if os.path.exists(f):
        for l in open(f):
            x = json.loads(l); res = x.get("raw_body_result") if (x.get("result") or {}).get("code") != 200 and x.get("raw_body_result") else x.get("result")
            SEED[x["widget_id"]] = f"{x.get('seed') or ('viewer_first_option' if 'selected' in x else 'unseeded')}:{(res or {}).get('code')}"
S, fails, DISP = {}, ["service\twidget_id\ttype\tleg\tparams\tcode\tclass\tdisposition\tseeded_default\tdetail"], collections.Counter()
for svc, f in (("REFERENCE_BASELINE", "baseline"), ("REFERENCE_CURATED", "curated"), ("EXAMPLE_DATA", "example-data"), ("OPENBQ_API", "openbq")):
    try: L = load(f"backend-sweep/{f}.jsonl")
    except FileNotFoundError: continue
    W = json.load(open(f"services/{svc}-widgets.json"))
    d = collections.Counter(cls(r, "default") for r in L); n = collections.Counter(cls(r, "nondefault") for r in L)
    S[svc] = {"catalog": len(W), "swept": len(L), "missing": sorted(set(W) - {r["widget_id"] for r in L}), "default": dict(d), "nondefault": dict(n)}
    for r in L:
        for leg in ("default", "nondefault"):
            k = cls(r, leg)
            if k not in ("ok", "ok_empty", "ok_udf_config", "not_applicable"):
                x = r[leg]; p = r.get("default_params" if leg == "default" else "nondefault_params")
                det = str(x.get("detail") or x.get("error") or "").replace("\t", " ").replace("\n", " ")
                dp = dispo(svc, r["widget_id"], k, det, r.get("type")); DISP[(svc, leg, dp)] += 1
                fails.append("\t".join(map(str, [svc, r["widget_id"], r.get("type"), leg, json.dumps(p), x.get("code"), k, dp, SEED.get(r["widget_id"], "") if leg == "default" else "", det[:200]])))

# nine named smoke checks (historical openbq-smoke-results.json ids)
SMOKE = [("CBOE quote", "cboe_equity_quote_cboe_obb"), ("Yahoo historical", "yfinance_equity_historical_yfinance_obb"),
         ("Yahoo quote", "yfinance_equity_quote_yfinance_obb"), ("Yahoo profile", "yfinance_equity_profile_yfinance_obb"),
         ("Yahoo fast info", "yfinance_equity_fast_info_yfinance_obb"), ("Yahoo income", "yfinance_fundamental_income_yfinance_obb"),
         ("Yahoo balance", "yfinance_fundamental_balance_yfinance_obb"), ("SEC search", "sec_equity_search_sec_obb"),
         ("Historical chart (yfinance historical, chart view)", "yfinance_equity_historical_yfinance_obb")]
try: O = {r["widget_id"]: r for r in load("backend-sweep/openbq.jsonl")}
except FileNotFoundError: O = {}
OW = json.load(open("services/OPENBQ_API-widgets.json"))
smoke = []
for label, wid in SMOKE:
    r = O.get(wid)
    st = "NOT_RUN" if r is None else ("PASS" if cls(r, "default") == "ok" and cls(r, "nondefault") in ("ok", "not_applicable") else "FAIL")
    if "chart" in label and r is not None:  # chartable = date + close fields declared on the descriptor
        f = {c.get("field") for c in OW[wid].get("data", {}).get("table", {}).get("columnsDefs", [])}
        st = st if {"date", "close"} <= f else "FAIL"
    sd = SEED.get(wid, "")
    if st == "FAIL" and sd.endswith(":200"): st = "PASS_WITH_INPUT (descriptor default has no symbol; seeded " + sd + ")"
    smoke.append({"check": label, "seeded_default": sd, "widget_id": wid, "status": st, "default": r and r["default"], "nondefault_params": r and r.get("nondefault_params"), "nondefault": r and r.get("nondefault")})

# provider example fixtures vs served OPENBQ_API catalog
prov = {}
for f in ("openbq-relaunch/bdobb-clean-v5-reconciled/docs/examples/v3.1.0-demo-providers.apps.json",):
    A = json.load(open(f"{root}/{f}")); A = A if isinstance(A, list) else [A]
    for a in A:
        for t in a["tabs"].values():
            for c in t["layout"]:
                r = O.get(c["i"])
                prov[c["i"]] = {"fixture": f, "served": c["i"] in OW, "default": r and cls(r, "default"), "nondefault": r and cls(r, "nondefault")}
OA = json.load(open("services/OPENBQ_API-apps.json"))
app_ids = {c["i"] for a in OA for t in a["tabs"].values() for c in t["layout"]}

# reconciliation
B, C = json.load(open("services/REFERENCE_BASELINE-widgets.json")), json.load(open("services/REFERENCE_CURATED-widgets.json"))
arch = json.load(open(f"{root}/editorial/rehearsals/v332-reference/widgets.json"))
inv71 = [l.split("`")[1] for l in open(f"{root}/editorial/regression/releases/fixture-inventory.md").read().split("## Curated 71 widget historical roster")[1].split("Legacy donor")[0].splitlines() if l.startswith("| `")]
apps = lambda s: json.load(open(f"services/{s}-apps.json"))
shape = lambda A: [{"name": a["name"], "tabs": len(a["tabs"]), "cards": sum(len(t["layout"]) for t in a["tabs"].values())} for a in A]
rec = {
    "baseline": {"widgets": len(B), "apps": shape(apps("REFERENCE_BASELINE")), "expected": "70 widgets / 1 app / 14 tabs / 70 cards",
                 "vs_archived_69_snapshot": {"added": sorted(set(B) - set(arch)), "removed": sorted(set(arch) - set(B)), "archived_count": len(arch)},
                 "unplaced_widgets": sorted(set(B) - {c["i"] for a in apps("REFERENCE_BASELINE") for t in a["tabs"].values() for c in t["layout"]})},
    "curated": {"widgets": len(C), "apps": shape(apps("REFERENCE_CURATED")), "added_vs_baseline": sorted(set(C) - set(B)), "removed_vs_baseline": sorted(set(B) - set(C)),
                "descriptor_diffs_vs_baseline": {k: {f: [B[k].get(f), C[k].get(f)] for f in set(B[k]) | set(C[k]) if B[k].get(f) != C[k].get(f)} for k in B if k in C and B[k] != C[k]},
                "vs_inventory_71_roster": {"roster_count": len(inv71), "served_not_in_roster": sorted(set(C) - set(inv71)), "roster_not_served": sorted(set(inv71) - set(C))}},
    "openbq_api": {"widgets": len(OW), "apps": len(OA), "tabs": sum(len(a["tabs"]) for a in OA), "cards": sum(len(t["layout"]) for a in OA for t in a["tabs"].values()),
                   "distinct_app_widget_ids": len(app_ids), "app_ids_not_in_catalog": sorted(app_ids - set(OW))},
}
json.dump(rec, open("manifests/reconcile.json", "w"), indent=1)
json.dump({"dispositions": {" | ".join(k): v for k, v in sorted(DISP.items())}, "seeded": dict(collections.Counter(SEED.values())), "services": S, "smoke": smoke, "provider_examples": prov}, open("backend-sweep/summary.json", "w"), indent=1)
open("backend-sweep/failures.tsv", "w").write("\n".join(fails) + "\n")
for k, v in S.items(): print(k, v["catalog"], v["swept"], "missing", len(v["missing"]), "D", v["default"], "ND", v["nondefault"])
print("dispositions", {" | ".join(k): v for k, v in sorted(DISP.items())}); print("seeded", collections.Counter(v.split(":")[0]+":"+v.split(":")[1] for v in SEED.values()))
print("smoke", [(s["check"], s["status"]) for s in smoke]); print("providers", prov)
print(json.dumps(rec["baseline"]["vs_archived_69_snapshot"]), json.dumps(rec["curated"]["vs_inventory_71_roster"]), list(rec["curated"]["descriptor_diffs_vs_baseline"]))
