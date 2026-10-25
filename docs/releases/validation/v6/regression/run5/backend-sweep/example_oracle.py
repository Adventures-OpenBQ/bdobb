#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Independent data oracles for EXAMPLE_DATA (served Market Kit) and the frozen practice/prices fixture (not served).
usage: example_oracle.py <example_base_url> <demos_dir> <out.json>
Recomputes from raw rows with the stdlib and compares to the contract numbers in v6.md (V6-007/008/010)
and to the service's own metrics.json. Data-level only; no client or model behaviour is asserted."""
import json, sys, statistics, urllib.request
base, demos, out = sys.argv[1:4]
get = lambda p: json.loads(urllib.request.urlopen(base.rstrip("/") + p, timeout=30).read())
R = []
def chk(case, label, actual, expected, tol=None):
    ok = abs(actual - expected) <= tol if tol is not None else actual == expected
    R.append({"case_id": case, "label": label, "expected": expected, "actual": actual, "pass": ok})

def metrics(rows):
    c = [r["close"] for r in rows]
    rets = [c[i] / c[i - 1] - 1 for i in range(1, len(c))]
    peak, dd = c[0], 0.0
    for x in c: peak = max(peak, x); dd = min(dd, x / peak - 1)
    return {"rows": len(c), "ret": round((c[-1] / c[0] - 1) * 100, 4), "std": round(statistics.stdev(rets) * 100, 4), "dd": round(dd * 100, 4)}

aapl, msft = get("/market-kit/aapl.json"), get("/market-kit/msft.json")
served = {m["symbol"]: m for m in get("/market-kit/metrics.json")}
for sym, rows, ret, std, dd in (("AAPL", aapl, -8.9071, 1.8092, -15.1437), ("MSFT", msft, -10.3182, 1.6276, -16.0577)):
    m = metrics(rows)
    chk("V6-010", f"{sym} rows", m["rows"], 60)
    chk("V6-010", f"{sym} window Jan2-Mar31", (rows[0]["date"], rows[-1]["date"]), ("2025-01-02", "2025-03-31"))
    chk("V6-010", f"{sym} close-to-close return % vs contract", m["ret"], ret, 1e-4)
    chk("V6-010", f"{sym} sample daily vol % vs contract", m["std"], std, 1e-4)
    chk("V6-010", f"{sym} closing-peak drawdown % vs contract", m["dd"], dd, 1e-4)
    chk("V6-010", f"{sym} served metrics.json return agrees", served[sym]["close_to_close_return_pct"], m["ret"], 1e-4)
chk("V6-010", "AAPL/MSFT dates aligned", [r["date"] for r in aapl], [r["date"] for r in msft])
ev = get("/market-kit/event-data.json")
chk("V6-010", "event tab rows", len(ev), 18)
chk("V6-010", "event tab last date", ev[-1]["date"], "2025-01-29")
pf = {r["asset"]: r for r in get("/market-kit/portfolio.json")}
chk("V6-010", "fictional equities 5000/3000 + cash 2000", (pf["AAPL"]["fictional_value_usd"], pf["MSFT"]["fictional_value_usd"], pf["Cash"]["fictional_value_usd"]), (5000, 3000, 2000))
chk("V6-010", "loss at -20% on existing equities", sum(r["loss_at_minus_20_pct_usd"] for r in pf.values()), 1600)

# V6-008 monthly OHLCV oracle, recomputed from the served 60-row AAPL file and checked against demos/expected.json
exp = json.load(open(demos + "/expected.json"))
months = {}
for r in aapl: months.setdefault(r["date"][:7], []).append(r)
for k, rows in months.items():
    e = exp["prices"]["monthly"][k]
    got = {"rows": len(rows), "open": rows[0]["open"], "high": max(r["high"] for r in rows), "low": min(r["low"] for r in rows),
           "close": rows[-1]["close"], "volume": sum(r["volume"] for r in rows)}
    for f in got: chk("V6-008", f"{k} {f}", got[f], e[f], 1e-9 if isinstance(e[f], float) else None)
chk("V6-008", "served aapl.json == frozen demos/prices.json", aapl, json.load(open(demos + "/prices.json")))

# V6-007 practice oracle (frozen fixture; EXAMPLE_DATA does not serve /practice.json)
pr = json.load(open(demos + "/practice.json"))
amt = lambda r: r["Amount"] or 0.0
chk("V6-007", "practice rows", len(pr), 12)
chk("V6-007", "practice date span", (min(r["Date"] for r in pr), max(r["Date"] for r in pr)), ("2025-01-02", "2025-03-06"))
chk("V6-007", "null amounts", sum(r["Amount"] is None for r in pr), 1)
chk("V6-007", "zero amounts", sum(r["Amount"] == 0 for r in pr), 1)
chk("V6-007", "total", sum(map(amt, pr)), 3300.0)
for co, v in (("AAPL", 1400.0), ("MSFT", 1900.0)): chk("V6-007", f"company {co}", sum(amt(r) for r in pr if r["Company"] == co), v)
for co, d, v in (("AAPL", "Research", 900.0), ("AAPL", "Trading", 500.0), ("MSFT", "Research", 1200.0), ("MSFT", "Trading", 700.0)):
    chk("V6-007", f"{co}/{d} sum", sum(amt(r) for r in pr if r["Company"] == co and r["Desk"] == d), v)

json.dump(R, open(out, "w"), indent=1, default=list)
bad = [r for r in R if not r["pass"]]
print(len(R) - len(bad), "/", len(R), "pass"); [print("FAIL", r) for r in bad]
