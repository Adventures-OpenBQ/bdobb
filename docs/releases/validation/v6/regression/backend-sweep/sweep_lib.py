#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

"""Backend-only widget sweep: one default and one non-default request per widget.

usage: sweep.py <LOGICAL_NAME> <base_url> <widgets.json> <out.jsonl>
The base URL comes from the operator shell; output records the logical name only.
Non-default = first param with an alternative option value (static options,
boolean flip, or optionsEndpoint second value). None available -> not_applicable.
"""
import json, sys, time, urllib.request, urllib.parse, concurrent.futures as cf

base = None

def get(path, params, timeout=90):
    base_ = base
    url = path if path.startswith("http") else base.rstrip("/") + "/" + path.lstrip("/")
    q = {k: (",".join(map(str, v)) if isinstance(v, list) else str(v).lower() if isinstance(v, bool) else v)
         for k, v in params.items() if v is not None and v != ""}
    if q: url += ("&" if "?" in url else "?") + urllib.parse.urlencode(q)
    t = time.time()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"accept": "*/*"}), timeout=timeout) as r:
            body = r.read(); code = r.status; ctype = r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        body = e.read(); code = e.code; ctype = e.headers.get("content-type", "")
    except Exception as e:
        return {"code": None, "error": type(e).__name__ + ": " + str(e)[:200], "ms": int((time.time()-t)*1000)}
    rec = {"code": code, "bytes": len(body), "ctype": ctype.split(";")[0], "ms": int((time.time()-t)*1000)}
    if ctype.startswith("application/json"):
        try:
            j = json.loads(body); rec["shape"] = type(j).__name__
            if isinstance(j, list): rec["rows"] = len(j)
            elif isinstance(j, dict):
                for k in ("results", "data", "rows"):
                    if isinstance(j.get(k), list): rec["rows"] = len(j[k]); break
                if code >= 400: rec["detail"] = str(j.get("detail", j))[:300]
        except Exception: rec["shape"] = "unparseable"
    elif code >= 400: rec["detail"] = body[:300].decode("utf-8", "replace")
    return rec

def defaults(w):
    out = {}
    for p in w.get("params") or []:
        if isinstance(p, dict) and p.get("paramName") and p.get("type") != "form":
            out[p["paramName"]] = p.get("value")
    return out

def alternative(w, d):
    for p in w.get("params") or []:
        if not isinstance(p, dict) or not p.get("paramName") or p.get("show") is False: continue
        cur = d.get(p["paramName"])
        if p.get("type") == "boolean": return p["paramName"], (not bool(cur))
        opts = p.get("options")
        if isinstance(opts, list):
            for o in opts:
                v = o.get("value") if isinstance(o, dict) else o
                if v is not None and v != cur: return p["paramName"], v
        if p.get("optionsEndpoint"):
            r = None
            try:
                url = base.rstrip("/") + "/" + p["optionsEndpoint"].lstrip("/")
                time.sleep(0.5)
                with urllib.request.urlopen(url, timeout=30) as resp: r = json.loads(resp.read())
            except Exception: continue
            for o in (r if isinstance(r, list) else []):
                v = o.get("value") if isinstance(o, dict) else o
                if v is not None and v != cur: return p["paramName"], v
    return None

def run(item):
    wid, w = item
    ep = w.get("endpoint")
    rec = {"service": name, "widget_id": wid, "type": w.get("type"), "endpoint": ep}
    if not ep: rec["default"] = {"code": None, "error": "no endpoint"}; return rec
    d = defaults(w); rec["default_params"] = d; rec["default"] = get(ep, d)
    alt = alternative(w, d)
    if alt:
        d2 = dict(d); d2[alt[0]] = alt[1]; rec["nondefault_params"] = {alt[0]: alt[1]}; rec["nondefault"] = get(ep, d2)
    else: rec["nondefault"] = "not_applicable"
    return rec

