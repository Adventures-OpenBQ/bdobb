#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Backend half of the HTTP-expressible legacy E05 cases against REFERENCE_BASELINE.
usage: e05_http.py <base_url> <out.json>. Each probe asserts the legacy oracle text in the raw response.
Only the request/response contract is tested; the native control gesture and renderer stay NOT_RUN."""
import json, sys, urllib.request, urllib.parse
base, out = sys.argv[1:3]

def get(path, **q):
    url = base.rstrip("/") + "/" + path.lstrip("/") + ("?" + urllib.parse.urlencode(q) if q else "")
    try:
        with urllib.request.urlopen(url, timeout=60) as r: return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")

P = []  # (case, label, path, params, check(code, body) -> bool)
def p(case, label, path, params, check): P.append((case, label, path, params, check))
rows = lambda b: len(json.loads(b)) if b.lstrip().startswith("[") else -1
p("E05-012", "filter_text=Bravo -> no rows", "table_widget_with_str_filter_param", {"filter_text": "Bravo"}, lambda c, b: c == 200 and rows(b) == 0)
p("E05-012", "filter_text=A -> matching rows", "table_widget_with_str_filter_param", {"filter_text": "A"}, lambda c, b: c == 200 and rows(b) > 0)
p("E05-017", "boolean false", "markdown_widget_with_boolean", {"condition": "false"}, lambda c, b: c == 200 and "disabled" in b.lower())
p("E05-017", "number 250", "markdown_widget_with_number_input", {"value": 250}, lambda c, b: c == 200 and "250" in b)
p("E05-017", "text Rehearsal", "markdown_widget_with_text_input", {"name": "Rehearsal"}, lambda c, b: c == 200 and "Rehearsal" in b)
p("E05-018", "date literal 2026-10-02", "markdown_widget_with_date_picker", {"date": "2026-10-02"}, lambda c, b: c == 200 and "2026-10-02" in b)
p("E05-019", "static dropdown 7", "markdown_widget_with_dropdown", {"days_picker": "7"}, lambda c, b: c == 200 and "Selection of Days: 7" in b.replace("**", ""))
p("E05-020", "static multi AAPL,MSFT,AMZN", "markdown_widget_with_multi_select_dropdown", {"stock_picker": "AAPL,MSFT,AMZN"}, lambda c, b: c == 200 and "AAPL,MSFT,AMZN" in b.replace(", ", ","))
p("E05-021", "endpoint options offer GOOGL", "advanced_dropdown_options", {}, lambda c, b: c == 200 and "GOOGL" in b)
p("E05-021", "endpoint multi AAPL,MSFT,GOOGL", "markdown_widget_with_multi_select_advanced_dropdown", {"stock_picker": "AAPL,MSFT,GOOGL"}, lambda c, b: c == 200 and "AAPL,MSFT,GOOGL" in b.replace(", ", ","))
p("E05-022", "multi text alpha,beta", "markdown_widget_with_multi_text_input", {"text_box": "alpha,beta"}, lambda c, b: c == 200 and "alpha" in b and "beta" in b)
p("E05-022", "combined test + 7", "markdown_widget_with_str_and_int", {"text_param": "test", "number_param": 7}, lambda c, b: c == 200 and "test" in b and "7" in b)
p("E05-023", "reports options are Q1/Q2 Report", "document_options", {"category": "reports"}, lambda c, b: c == 200 and "Q1 Report" in b and "Q2 Report" in b)
p("E05-023", "echo Q1 Report", "dropdown_dependent_widget", {"category": "reports", "document_type": "Q1 Report"}, lambda c, b: c == 200 and "Q1 Report" in b)
p("E05-067", "intentional HTTP 500 with message", "markdown_widget_with_error_handling", {}, lambda c, b: c == 500 and "Error that just occurred" in b)
p("E05-067", "neighbour markdown still 200", "markdown_widget", {}, lambda c, b: c == 200)

res = []
for case, label, path, params, check in P:
    c, b = get(path, **params)
    res.append({"case_id": case, "label": label, "path": path, "params": params, "code": c, "body_excerpt": b[:400], "pass": bool(check(c, b))})
json.dump(res, open(out, "w"), indent=1)
for r in res: print(r["case_id"], "PASS" if r["pass"] else "FAIL", r["label"], r["code"], r["body_excerpt"][:120].replace("\n", " "))
