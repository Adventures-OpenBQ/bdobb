<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The OpenBQ API's largest datasets as server-paged tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the ~23 OpenBQ API table widgets whose default response exceeds ~10 MB as standard OpenBB SSRM (server-side row model) tables, so a card fetches one bounded page at a time instead of the whole 10–160 MB GET, and sorts/filters on the server.

**Architecture:** All new server code lives in the existing `lanes` hook (`lanes/openbq_lanes.py`). A committed data file names the 23 widgets. The hook rewrites each widget's cached `/widgets.json` entry to `type: "ssrm_table"` pointing at a new `POST <route>/ssrm` endpoint, which it also serves: the endpoint acquires the full result ONCE through the app itself (so heavy routes keep their lane), caches it as a pandas DataFrame under a 3 GiB / 15-minute LRU, and answers each request with a filtered, sorted, 1,000-row page. The Funnel gateway and the BDOBB client already carry the standard SSRM contract (`ssrmRoutes`, `SSRM_ROUTES_JSON`, the "LIVE · paged" provider and `SsrmTableRenderer`); this plan only populates their route lists and proves them against the rewritten catalogue.

**Tech Stack:** Python 3.12 + Starlette/FastAPI middleware, `httpx` ASGITransport for in-process acquisition, `pandas` 3.0.6 (in the image). Gateway and web tests are Node 22 `node --test`. BDOBB client tests are Playwright e2e and Node unit tests.

**Spec:** `docs/superpowers/specs/2026-10-15-large-widgets-provider-ssrm-design.md` (in the BDOBB v4 worktree). The plan argues from the spec; executors read both.

## Global Constraints

- Two-line copyright header on every new/edited source file: `# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.` then `# SPDX-License-Identifier: Apache-2.0` (Python `#`, JS/TS `//`, Markdown `<!-- ... -->`).
- No upstream OpenBB file changes. Everything in openbq-docker lives in `lanes/openbq_lanes.py`, its data file, `lanes/tests/`, `funnel-gateway/`, `README.md`, and `Dockerfile.v3`.
- Cache: **3 GiB** total by `DataFrame.memory_usage(deep=True).sum()`, **15-minute** TTL, one acquisition shared by concurrent first requests for one key.
- Page cap: **at most 1,000 rows** per request; `endRow - startRow` over 1,000 or negative → 400.
- Capabilities: **filter + sort only.** `rowGroupCols`, `groupKeys`, `valueCols`, `pivotCols`, `pivotMode` present → 400. Filters: text `contains` (case-insensitive), number `inRange` / `greaterThanOrEqual` / `lessThanOrEqual`. Any other filter type/shape → 400.
- The widget list is **23 entries**, committed as one data file (`lanes/ssrm_widgets.json`), ids and routes copied verbatim from the spec's table. A listed widget id absent from the live `/widgets.json` is **skipped, not an error**.
- Gateway door-path form for `ssrmRoutes`: `/api/api/v1/<rest>/ssrm` (the client route `/api/v1/<rest>` prefixed with the door's `/api`, suffixed `/ssrm`). Must satisfy `OPENBB_ROUTE_RE = /^\/api\/api\/v1\/[a-z0-9_/-]{1,200}$/`.
- `pandas==3.0.6`, `numpy==2.5.3`, `pyarrow==25.0.1` are in `requirements.lock` — confirmed present; do not add dependencies.
- `web/policy.mjs` is vendored from openbq-docker — never hand-edit. `policy.mjs`'s `ssrmRoutes`/`validSsrmRoutes`/`tableRoute` support already exists at v4.0.0; **do not change `policy.mjs`**, so no re-vendor of it is required.
- Never write a tailnet hostname, IP, token, or `/Users/...`/`/home/...` home path into any committed file. `bash scripts/scrub-check.sh` (BDOBB) and `python3 scripts/check-public.py` (openbq-docker) must print clean / PASS.
- A long gate run is executing in the BDOBB v4 worktree: for THIS session only add and commit the plan file; touch nothing else there.

## Review Focus

- **Upstream response not shaped `{"results": [list of dict]}`.** `smoke.py` reads `result.get('results')`, but a route could answer a bare list, a `dataKey`-nested body, `{"results": null}`, or `{"results": {...}}` (keyed records). The DataFrame builder must coerce all of these to a list of row dicts (empty when it cannot), or every widget on that shape renders broken. Pinned in Task 2 (`test_results_shapes_all_become_row_lists`).
- **Concurrent first requests for the same (route, params).** Without single-flight, the first scroll of a card issues several pages at once, each triggering a full 10–160 MB GET through the lane — a stampede that blows the 16 GB cap. One acquisition must be shared. Pinned in Task 2 (`test_concurrent_first_requests_acquire_once`).
- **NaN / Inf / NaT / Timestamp cells.** The client's wire codec rejects a non-finite or non-scalar JSON value; the reply must be JSON-safe (NaN/NaT → null, timestamps → ISO). Pinned in Task 2 (`test_reply_is_json_safe`).
- **A page requested past the end of the (filtered) result.** `startRow` beyond `rowCount` must return `{"rowData": [], "rowCount": <total>}`, not an error or a negative slice. Pinned in Task 2 (`test_page_past_the_end_is_empty_with_the_true_count`).
- **A sort/filter naming a column the result does not have.** The server is the trust boundary at the door; an unknown `colId`/filter key on a non-empty result → 400, never a silent pass or a 500. Pinned in Task 2 (`test_unknown_column_is_rejected`).

---

## File Structure

**openbq-docker** (`od-v4` worktree, branch `claude/v4-regression-20261015`):
- Create `lanes/ssrm_widgets.json` — the 23 `{ "id", "route" }` entries (source of truth).
- Modify `lanes/openbq_lanes.py` — load the list; rewrite `/widgets.json`; serve `POST <route>/ssrm`; `SsrmCache` (single-flight + LRU + TTL); acquisition through the app.
- Modify `lanes/tests/test_lanes.py` — unit tests for the rewrite and the rows endpoint.
- Create `funnel-gateway/ssrm-routes.test.mjs` — the 23 door paths admit; an unlisted `/ssrm` POST is refused.
- Modify `Dockerfile.v3` — `COPY lanes/ssrm_widgets.json /workspace/ssrm_widgets.json`.
- Modify `README.md` — widget list + rows-endpoint behaviour under "Heavy routes".

**BDOBB v4** (the worktree this plan is committed to — for THIS session, do NOT build/run here; a gate is running):
- Modify `scripts/gateway-vendor.mjs` — also emit `web/ssrm-routes.vendored.json` (the 23 door paths) from openbq-docker's `lanes/ssrm_widgets.json`.
- Create `web/ssrm-routes.vendored.json` — the vendored 23 door paths (generated, committed).
- Create `web/ssrm-routes.test.mjs` — parity: `readConfig` accepts the vendored list and `tableRoute` admits exactly those routes.
- Create `e2e/ssrm-large-widget.spec.ts` — a card for a rewritten-catalogue widget pages and never issues the full GET.
- Modify `src/help/topics/tables.md` — name the largest datasets as LIVE · paged.

**Controller** (operator, after both repos' tests pass): rebuild + deploy + live checks.

---

### Task 1: SSRM widget list + catalogue rewrite (openbq-docker)

**Files:**
- Create: `od-v4/lanes/ssrm_widgets.json`
- Modify: `od-v4/lanes/openbq_lanes.py` (add loader + `_rewrite_widgets`; call it in `_catalog`)
- Modify: `od-v4/Dockerfile.v3` (COPY the data file)
- Test: `od-v4/lanes/tests/test_lanes.py` (new `SsrmCatalogTest`)

**Interfaces:**
- Produces: `SSRM_ROUTES: dict[str, str]` mapping `route -> widget_id`; `SSRM_CAPS: dict` the ssrm capability block; `_rewrite_widgets(body: bytes) -> bytes`. Task 2 consumes `SSRM_ROUTES` and `SSRM_FILE`/`_load_ssrm_widgets`.

- [ ] **Step 1: Write the data file.** Create `od-v4/lanes/ssrm_widgets.json` with exactly these 23 entries (ids and routes verbatim from the spec table), e.g.:

```json
[
  { "id": "bls_jolts_revisions_bls_obb", "route": "/api/v1/bls/jolts/revisions" },
  { "id": "eia_petroleum_imports_exports_and_movements_movements_of_crude_oil_and_selected_products_by_rail_eia_obb", "route": "/api/v1/eia/petroleum/imports_exports_and_movements/movements_of_crude_oil_and_selected_products_by_rail" },
  { "id": "tmx_fixedincome_prices_tmx_obb", "route": "/api/v1/tmx/fixedincome/prices" },
  { "id": "eia_petroleum_refining_and_processing_refinery_net_input_eia_obb", "route": "/api/v1/eia/petroleum/refining_and_processing/refinery_net_input" },
  { "id": "eia_natural_gas_consumption_end_use_natural_gas_consumption_by_end_use_eia_obb", "route": "/api/v1/eia/natural_gas/consumption_end_use/natural_gas_consumption_by_end_use" },
  { "id": "eia_coal_by_mine_by_plant_eia_obb", "route": "/api/v1/eia/coal/by_mine_by_plant" },
  { "id": "ecb_eligible_assets_ecb_obb", "route": "/api/v1/ecb/eligible_assets" },
  { "id": "eia_petroleum_refining_and_processing_refinery_blender_net_input_eia_obb", "route": "/api/v1/eia/petroleum/refining_and_processing/refinery_blender_net_input" },
  { "id": "eia_petroleum_refining_and_processing_refinery_net_production_eia_obb", "route": "/api/v1/eia/petroleum/refining_and_processing/refinery_net_production" },
  { "id": "eia_petroleum_refining_and_processing_natural_gas_plant_field_production_eia_obb", "route": "/api/v1/eia/petroleum/refining_and_processing/natural_gas_plant_field_production" },
  { "id": "imf_chokepoint_volume_imf_obb", "route": "/api/v1/imf/chokepoint_volume" },
  { "id": "eia_petroleum_imports_exports_and_movements_movements_by_tanker_and_barge_between_pad_districts_eia_obb", "route": "/api/v1/eia/petroleum/imports_exports_and_movements/movements_by_tanker_and_barge_between_pad_districts" },
  { "id": "eia_natural_gas_prices_natural_gas_prices_eia_obb", "route": "/api/v1/eia/natural_gas/prices/natural_gas_prices" },
  { "id": "eia_petroleum_prices_weekly_retail_gasoline_and_diesel_prices_eia_obb", "route": "/api/v1/eia/petroleum/prices/weekly_retail_gasoline_and_diesel_prices" },
  { "id": "eia_petroleum_status_report_eia_obb", "route": "/api/v1/eia/petroleum_status_report" },
  { "id": "cftc_fx_forward_trades_cftc_obb", "route": "/api/v1/cftc/fx_forward_trades" },
  { "id": "eia_natural_gas_summary_natural_gas_summary_eia_obb", "route": "/api/v1/eia/natural_gas/summary/natural_gas_summary" },
  { "id": "cftc_swap_trades_cftc_obb", "route": "/api/v1/cftc/swap_trades" },
  { "id": "ny_market_expectations_federal_reserve_obb", "route": "/api/v1/federal_reserve/ny/market_expectations" },
  { "id": "ffiec_institutions_federal_reserve_obb", "route": "/api/v1/federal_reserve/ffiec/institutions" },
  { "id": "finra_fixedincome_bonds_finra_obb", "route": "/api/v1/finra/fixedincome/bonds" },
  { "id": "finra_fixedincome_bond_prices_finra_obb", "route": "/api/v1/finra/fixedincome/bond_prices" },
  { "id": "ffiec_institution_structure_federal_reserve_obb", "route": "/api/v1/federal_reserve/ffiec/institution_structure" }
]
```

- [ ] **Step 2: Write the failing test** in `lanes/tests/test_lanes.py`. Add after `ServableAppsTest`. It serves a `/widgets.json` with one listed id, one listed-but-absent id (skipped), and one unlisted id (untouched), then asserts the rewrite:

```python
class SsrmCatalogTest(unittest.IsolatedAsyncioTestCase):
    """Listed widgets become ssrm_table pointing at <route>/ssrm; everything else is byte-identical."""

    async def asyncSetUp(self):
        openbq_lanes._CATALOG_CACHE.clear()
        self.addCleanup(openbq_lanes._CATALOG_CACHE.clear)
        self.addCleanup(setattr, openbq_lanes, "SSRM_ROUTES", openbq_lanes.SSRM_ROUTES)
        openbq_lanes.SSRM_ROUTES = {
            "/api/v1/cftc/swap_trades": "cftc_swap_trades_cftc_obb",
            "/api/v1/absent/route": "absent_widget_obb",  # listed but not in widgets.json: skipped
        }

    async def serve(self):
        app = FastAPI()

        @app.get("/widgets.json")
        async def widgets_json():
            return {
                "cftc_swap_trades_cftc_obb": {
                    "name": "Swap trades", "type": "table",
                    "endpoint": "/api/v1/cftc/swap_trades",
                    "params": [{"paramName": "start_date"}], "category": "CFTC",
                },
                "other_obb": {"name": "Other", "type": "table", "endpoint": "/api/v1/other"},
            }

        app.middleware("http")(openbq_lanes.middleware)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://api") as client:
            return (await client.get("/widgets.json")).json()

    async def test_listed_widget_is_rewritten_and_others_are_untouched(self):
        body = await self.serve()
        listed = body["cftc_swap_trades_cftc_obb"]
        self.assertEqual(listed["type"], "ssrm_table")
        self.assertEqual(listed["endpoint"], "/api/v1/cftc/swap_trades/ssrm")
        self.assertEqual(listed["ssrm"], {"sorting": True, "filtering": ["text", "number"]})
        self.assertEqual(listed["name"], "Swap trades")          # other fields kept
        self.assertEqual(listed["params"], [{"paramName": "start_date"}])
        self.assertEqual(listed["category"], "CFTC")
        self.assertEqual(body["other_obb"], {"name": "Other", "type": "table", "endpoint": "/api/v1/other"})
        self.assertNotIn("absent_widget_obb", body)              # listed-but-absent skipped, no error
```

- [ ] **Step 3: Run it to verify it fails.**

Run: `cd od-v4 && python3 -m unittest lanes.tests.test_lanes.SsrmCatalogTest -v`
Expected: FAIL — `AttributeError: module 'openbq_lanes' has no attribute 'SSRM_ROUTES'` (or the rewrite assertions fail).

- [ ] **Step 4: Implement the loader and rewrite** in `openbq_lanes.py`. Add near the other module constants (after `BUILTIN_CARDS`):

```python
# The OpenBQ API's largest table widgets (default response > ~10 MB) served as
# server-paged SSRM tables (approach B): the API itself answers the standard
# OpenBB SSRM contract so BDOBB's "LIVE · paged" provider pages them, and the
# full GET never crosses the caches, the door or the client. The id->route list
# is committed data (lanes/ssrm_widgets.json); a listed id absent from
# /widgets.json is skipped.
SSRM_FILE = os.environ.get("OPENBQ_SSRM_WIDGETS", "/workspace/ssrm_widgets.json")
SSRM_SUFFIX = "/ssrm"
SSRM_CAPS = {"sorting": True, "filtering": ["text", "number"]}


def _load_ssrm_widgets(path=SSRM_FILE) -> dict:
    """{route: widget_id} from the committed list; {} if it is missing or malformed."""
    try:
        with open(path, encoding="utf-8") as f:
            entries = json.load(f)
    except (OSError, ValueError):
        return {}
    routes = {}
    if isinstance(entries, list):
        for e in entries:
            if isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("route"), str):
                routes[e["route"]] = e["id"]
    return routes


SSRM_ROUTES = _load_ssrm_widgets()
_SSRM_IDS = {wid: route for route, wid in SSRM_ROUTES.items()}


def _rewrite_widgets(body: bytes) -> bytes:
    """Point each listed widget at <route>/ssrm as an ssrm_table; keep every other field.

    A listed id absent from the catalogue is skipped. Only the three SSRM fields
    are touched, so params, columnsDefs, name and category resolve exactly as before.
    """
    try:
        widgets = json.loads(body)
    except ValueError:
        return body
    if not isinstance(widgets, dict):
        return body
    changed = False
    for wid, route in _SSRM_IDS.items():
        entry = widgets.get(wid)
        if isinstance(entry, dict):
            entry["type"] = "ssrm_table"
            entry["endpoint"] = route + SSRM_SUFFIX
            entry["ssrm"] = dict(SSRM_CAPS)
            changed = True
    return json.dumps(widgets).encode() if changed else body
```

In `_catalog`, apply the rewrite to the widgets.json branch before caching. Change the `if path == "/apps.json":` block so the widgets branch is handled too:

```python
        body = b"".join([chunk async for chunk in response.body_iterator])
        if path == "/widgets.json":
            body = _rewrite_widgets(body)
        elif path == "/apps.json":
            body = _with_extra_apps(body)
            ...
```

- [ ] **Step 5: Run it to verify it passes.**

Run: `cd od-v4 && python3 -m unittest lanes.tests.test_lanes.SsrmCatalogTest -v`
Expected: PASS.

- [ ] **Step 6: Wire the data file into the image.** In `od-v4/Dockerfile.v3`, next to `COPY lanes/openbq_lanes.py ...` (line ~45), add:

```dockerfile
COPY lanes/ssrm_widgets.json /workspace/ssrm_widgets.json
```

- [ ] **Step 7: Run the whole lane suite + the public scan.**

Run: `cd od-v4 && python3 -m unittest discover lanes/tests && python3 scripts/check-public.py`
Expected: PASS (the one macOS-only `test_the_lane_is_recycled_when_its_memory_passes_the_cap` false failure is known and ignorable); `check-public.py` prints `PASS`.

- [ ] **Step 8: Commit.**

```bash
cd od-v4 && git add lanes/ssrm_widgets.json lanes/openbq_lanes.py lanes/tests/test_lanes.py Dockerfile.v3
git commit -m "feat(v4): rewrite the largest widgets as ssrm_table in the catalogue"
```

---

### Task 2: The rows endpoint + DataFrame cache (openbq-docker)

**Files:**
- Modify: `od-v4/lanes/openbq_lanes.py` (add `SsrmCache`, `_rows_from`, `_apply_query`, `_ssrm`, wire into `middleware`)
- Test: `od-v4/lanes/tests/test_lanes.py` (new `SsrmRowsTest`)

**Interfaces:**
- Consumes: `SSRM_ROUTES`, `SSRM_SUFFIX`, `_cors`, `httpx.ASGITransport` (as in `_widget_ids`).
- Produces: `POST /api/v1/<route>/ssrm` answering `{"rowData": [...], "rowCount": <int>}`; module-level `SSRM_CACHE` (an `SsrmCache`) that tests may replace; `SsrmCache(max_bytes, ttl, clock=time.monotonic)`.

- [ ] **Step 1: Write the failing tests** in `lanes/tests/test_lanes.py`. Add `import pandas as pd` at the top of the module (alongside the stdlib imports). Then add:

```python
class SsrmRowsTest(unittest.IsolatedAsyncioTestCase):
    """POST <route>/ssrm pages, filters and sorts the cached result; refuses the rest."""

    def app(self):
        self.gets = 0
        self.rows = [
            {"name": "Alpha", "value": 3, "when": "2026-01-03"},
            {"name": "beta", "value": 1, "when": "2026-01-01"},
            {"name": "Gamma", "value": 2, "when": "2026-01-02"},
        ]
        app = FastAPI()

        @app.get("/api/v1/listed/data")
        async def data(request: Request):
            self.gets += 1
            if request.query_params.get("boom") == "1":
                return JSONResponse({"detail": "sanitised upstream error"}, 503)
            return {"results": list(self.rows)}

        app.middleware("http")(openbq_lanes.middleware)
        return app

    async def asyncSetUp(self):
        from starlette.requests import Request  # noqa: F401  (imported for the route signature)
        self.addCleanup(setattr, openbq_lanes, "SSRM_ROUTES", openbq_lanes.SSRM_ROUTES)
        self.addCleanup(setattr, openbq_lanes, "SSRM_CACHE", openbq_lanes.SSRM_CACHE)
        openbq_lanes.SSRM_ROUTES = {"/api/v1/listed/data": "listed_obb"}
        openbq_lanes.SSRM_CACHE = openbq_lanes.SsrmCache(max_bytes=3 << 30, ttl=900)

    def client(self, app):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api")

    def req(self, **over):
        body = {"startRow": 0, "endRow": 100, "sortModel": [], "filterModel": {},
                "rowGroupCols": [], "groupKeys": [], "valueCols": [], "pivotCols": [], "pivotMode": False}
        body.update(over)
        return body

    async def test_first_page_sorted_and_counted(self):
        app = self.app()
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm", json=self.req(sortModel=[{"colId": "value", "sort": "asc"}]))
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual([row["value"] for row in body["rowData"]], [1, 2, 3])
        self.assertEqual(body["rowCount"], 3)

    async def test_text_contains_is_case_insensitive(self):
        app = self.app()
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm", json=self.req(
                filterModel={"name": {"filterType": "text", "type": "contains", "filter": "a"}}))
        self.assertEqual({row["name"] for row in r.json()["rowData"]}, {"Alpha", "beta", "Gamma"})
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm", json=self.req(
                filterModel={"name": {"filterType": "text", "type": "contains", "filter": "GAMM"}}))
        self.assertEqual([row["name"] for row in r.json()["rowData"]], ["Gamma"])

    async def test_number_filters(self):
        app = self.app()
        for model, expected in [
            ({"value": {"filterType": "number", "type": "inRange", "filter": 2, "filterTo": 3}}, {2, 3}),
            ({"value": {"filterType": "number", "type": "greaterThanOrEqual", "filter": 2}}, {2, 3}),
            ({"value": {"filterType": "number", "type": "lessThanOrEqual", "filter": 2}}, {1, 2}),
        ]:
            async with self.client(app) as c:
                r = await c.post("/api/v1/listed/data/ssrm", json=self.req(filterModel=model))
            self.assertEqual({row["value"] for row in r.json()["rowData"]}, expected)

    async def test_slice_and_cap(self):
        app = self.app()
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm",
                             json=self.req(startRow=1, endRow=2, sortModel=[{"colId": "value", "sort": "asc"}]))
        self.assertEqual([row["value"] for row in r.json()["rowData"]], [2])
        self.assertEqual(r.json()["rowCount"], 3)
        async with self.client(app) as c:
            over = await c.post("/api/v1/listed/data/ssrm", json=self.req(endRow=1001))
            neg = await c.post("/api/v1/listed/data/ssrm", json=self.req(startRow=5, endRow=2))
        self.assertEqual((over.status_code, neg.status_code), (400, 400))

    async def test_page_past_the_end_is_empty_with_the_true_count(self):
        app = self.app()
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm", json=self.req(startRow=100, endRow=200))
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["rowData"], r.json()["rowCount"]), ([], 3))

    async def test_unknown_column_is_rejected(self):
        app = self.app()
        async with self.client(app) as c:
            s = await c.post("/api/v1/listed/data/ssrm", json=self.req(sortModel=[{"colId": "nope", "sort": "asc"}]))
            f = await c.post("/api/v1/listed/data/ssrm", json=self.req(
                filterModel={"nope": {"filterType": "text", "type": "contains", "filter": "x"}}))
        self.assertEqual((s.status_code, f.status_code), (400, 400))

    async def test_grouping_values_pivot_and_bad_filters_are_refused(self):
        app = self.app()
        for over in [
            {"rowGroupCols": [{"id": "name", "field": "name"}]},
            {"groupKeys": ["Alpha"]},
            {"valueCols": [{"id": "value", "field": "value"}]},
            {"pivotCols": [{"id": "name", "field": "name"}]},
            {"pivotMode": True},
            {"filterModel": {"name": {"filterType": "set", "values": ["Alpha"]}}},
            {"filterModel": {"value": {"filterType": "number", "type": "equals", "filter": 1}}},
        ]:
            async with self.client(app) as c:
                r = await c.post("/api/v1/listed/data/ssrm", json=self.req(**over))
            self.assertEqual(r.status_code, 400, over)

    async def test_unlisted_route_is_404(self):
        app = self.app()
        async with self.client(app) as c:
            r = await c.post("/api/v1/other/data/ssrm", json=self.req())
        self.assertEqual(r.status_code, 404)

    async def test_results_shapes_all_become_row_lists(self):
        openbq_lanes.SSRM_CACHE = openbq_lanes.SsrmCache(max_bytes=3 << 30, ttl=900)
        self.assertEqual(openbq_lanes._rows_from({"results": [{"a": 1}]}), [{"a": 1}])
        self.assertEqual(openbq_lanes._rows_from([{"a": 1}]), [{"a": 1}])
        self.assertEqual(openbq_lanes._rows_from({"results": {"x": {"a": 1}}}), [{"a": 1}])
        self.assertEqual(openbq_lanes._rows_from({"results": None}), [])
        self.assertEqual(openbq_lanes._rows_from({"results": [1, "x"]}), [])

    async def test_reply_is_json_safe(self):
        app = self.app()
        self.rows = [{"name": "A", "value": float("nan"), "when": "2026-01-01"},
                     {"name": "B", "value": 2, "when": "2026-01-02"}]
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm", json=self.req())
        self.assertIsNone(r.json()["rowData"][0]["value"])  # NaN -> null, parseable JSON

    async def test_acquired_once_then_served_from_cache(self):
        app = self.app()
        async with self.client(app) as c:
            await c.post("/api/v1/listed/data/ssrm", json=self.req())
            await c.post("/api/v1/listed/data/ssrm", json=self.req(startRow=1, endRow=2))
        self.assertEqual(self.gets, 1)  # second page reuses the cached frame

    async def test_concurrent_first_requests_acquire_once(self):
        app = self.app()

        @app.get("/api/v1/listed/slow")
        async def slow():
            self.gets += 1
            await asyncio.sleep(0.3)
            return {"results": list(self.rows)}

        openbq_lanes.SSRM_ROUTES = {"/api/v1/listed/slow": "slow_obb"}
        openbq_lanes.SSRM_CACHE = openbq_lanes.SsrmCache(max_bytes=3 << 30, ttl=900)
        async with self.client(app) as c:
            a, b = await asyncio.gather(
                c.post("/api/v1/listed/slow/ssrm", json=self.req()),
                c.post("/api/v1/listed/slow/ssrm", json=self.req(startRow=1, endRow=2)),
            )
        self.assertEqual((a.status_code, b.status_code), (200, 200))
        self.assertEqual(self.gets, 1)

    async def test_upstream_error_is_kept(self):
        app = self.app()
        async with self.client(app) as c:
            r = await c.post("/api/v1/listed/data/ssrm?boom=1", json=self.req())
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json(), {"detail": "sanitised upstream error"})

    async def test_lru_evicts_at_the_byte_bound(self):
        cache = openbq_lanes.SsrmCache(max_bytes=1, ttl=900)
        async def df(n):
            return pd.DataFrame([{"a": i} for i in range(n)])
        await cache.get(("r", (("p", "1"),)), lambda: df(10))
        await cache.get(("r", (("p", "2"),)), lambda: df(10))
        self.assertEqual(len(cache.entries), 1)  # only the newest survives a 1-byte cap

    async def test_ttl_expiry_reacquires(self):
        clock = [0.0]
        cache = openbq_lanes.SsrmCache(max_bytes=3 << 30, ttl=10, clock=lambda: clock[0])
        calls = []
        async def acquire():
            calls.append(1)
            return pd.DataFrame([{"a": 1}])
        await cache.get(("r", ()), acquire)
        clock[0] = 11.0
        await cache.get(("r", ()), acquire)
        self.assertEqual(len(calls), 2)  # expired entry reacquired
```

Add `from fastapi import Request` and `from starlette.responses import JSONResponse` imports to the test module if not present (JSONResponse is already imported in the hook, not the test — add it to the test).

- [ ] **Step 2: Run them to verify they fail.**

Run: `cd od-v4 && python3 -m unittest lanes.tests.test_lanes.SsrmRowsTest -v`
Expected: FAIL — `AttributeError: module 'openbq_lanes' has no attribute 'SsrmCache'`.

- [ ] **Step 3: Implement the cache, query and endpoint** in `openbq_lanes.py`. Add `import math` and `from collections import OrderedDict` to the imports, and `import pandas as pd` (deferred: see note — put the import inside the acquisition path so importing the module as a worker stays cheap; `pd` is needed only when a rows request runs). Add after the `_rewrite_widgets` block:

```python
SSRM_PAGE_MAX = 1000
SSRM_CACHE_BYTES = int(os.environ.get("OPENBQ_SSRM_CACHE_BYTES", 3 << 30))  # 3 GiB
SSRM_TTL = float(os.environ.get("OPENBQ_SSRM_TTL", 900))                     # 15 minutes


class SsrmUpstream(Exception):
    """A non-2xx from the acquisition GET; its status and sanitised body are kept."""
    def __init__(self, status, body, media_type):
        self.status, self.body, self.media_type = status, body, media_type


class SsrmBadRequest(Exception):
    """A request this endpoint refuses: grouping/values/pivot, a bad filter, or a bad slice."""


class SsrmCache:
    """(route, params) -> DataFrame, LRU by deep bytes with a TTL and single-flight.

    ponytail: one asyncio.Lock guards the whole map. The map is tiny (a handful
    of big frames) and acquisitions are slow I/O, so lock contention is a
    non-issue; per-key locks would only add code. Upgrade to per-key striping
    if the map ever holds thousands of entries.
    """

    def __init__(self, max_bytes=SSRM_CACHE_BYTES, ttl=SSRM_TTL, clock=time.monotonic):
        self.max_bytes, self.ttl, self.clock = max_bytes, ttl, clock
        self.entries = OrderedDict()   # key -> [df, nbytes, expiry]
        self.inflight = {}             # key -> asyncio.Future
        self.total = 0
        self.lock = asyncio.Lock()

    async def get(self, key, acquire):
        async with self.lock:
            entry = self.entries.get(key)
            now = self.clock()
            if entry is not None and entry[2] > now:
                self.entries.move_to_end(key)
                return entry[0]
            if entry is not None:                      # expired
                self.total -= entry[1]
                del self.entries[key]
            fut = self.inflight.get(key)
            leader = fut is None
            if leader:
                fut = asyncio.get_running_loop().create_future()
                self.inflight[key] = fut
        if not leader:
            return await fut                            # share the leader's acquisition (or its error)
        try:
            df = await acquire()
        except BaseException as exc:                    # noqa: BLE001  re-raised to the caller and followers
            async with self.lock:
                self.inflight.pop(key, None)
            if not fut.done():
                fut.set_exception(exc)
            raise
        async with self.lock:
            self.inflight.pop(key, None)
            nbytes = int(df.memory_usage(deep=True).sum())
            self.entries[key] = [df, nbytes, self.clock() + self.ttl]
            self.total += nbytes
            while self.total > self.max_bytes and len(self.entries) > 1:
                _, evicted = self.entries.popitem(last=False)
                self.total -= evicted[1]
        if not fut.done():
            fut.set_result(df)
        return df


SSRM_CACHE = SsrmCache()


def _rows_from(payload):
    """A list of row dicts from an OpenBB response, whatever its envelope."""
    data = payload.get("results") if isinstance(payload, dict) else payload
    if isinstance(data, dict):
        data = list(data.values())
    if not isinstance(data, list):
        return []
    rows = [row for row in data if isinstance(row, dict)]
    return rows if len(rows) == len(data) else []      # mixed/non-dict rows: not a table


async def _acquire(app, route, params, authorization):
    """GET the full result ONCE through the app itself, so a lane route keeps its lane."""
    import pandas as pd
    headers = {"accept-encoding": "identity"}
    if authorization:
        headers["authorization"] = authorization
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://openbq", timeout=None) as client:
        response = await client.get(route, params=params, headers=headers)
    if response.status_code // 100 != 2:
        raise SsrmUpstream(response.status_code, response.content,
                           response.headers.get("content-type", "application/json"))
    return pd.DataFrame(_rows_from(response.json()))


_SSRM_GROUP_KEYS = ("rowGroupCols", "groupKeys", "valueCols", "pivotCols")


def _apply_query(df, body):
    """Refuse grouping/values/pivot; apply filterModel then sortModel; return (page, total)."""
    import pandas as pd
    if not isinstance(body, dict):
        raise SsrmBadRequest()
    if body.get("pivotMode") or any(body.get(k) for k in _SSRM_GROUP_KEYS):
        raise SsrmBadRequest()
    start, end = body.get("startRow"), body.get("endRow")
    if (not isinstance(start, int) or isinstance(start, bool) or not isinstance(end, int)
            or isinstance(end, bool) or start < 0 or end < start or end - start > SSRM_PAGE_MAX):
        raise SsrmBadRequest()
    out = df
    for col, spec in (body.get("filterModel") or {}).items():
        if col not in out.columns:
            raise SsrmBadRequest()
        if not isinstance(spec, dict):
            raise SsrmBadRequest()
        ftype, ttype = spec.get("filterType"), spec.get("type")
        if ftype == "text" and ttype == "contains":
            needle = spec.get("filter")
            if not isinstance(needle, str):
                raise SsrmBadRequest()
            out = out[out[col].astype("string").str.contains(needle, case=False, na=False, regex=False)]
        elif ftype == "number" and ttype in ("inRange", "greaterThanOrEqual", "lessThanOrEqual"):
            lo, hi = spec.get("filter"), spec.get("filterTo")
            series = pd.to_numeric(out[col], errors="coerce")
            if ttype == "greaterThanOrEqual":
                if not isinstance(lo, (int, float)):
                    raise SsrmBadRequest()
                out = out[series >= lo]
            elif ttype == "lessThanOrEqual":
                if not isinstance(lo, (int, float)):
                    raise SsrmBadRequest()
                out = out[series <= lo]
            else:
                if not isinstance(lo, (int, float)) or not isinstance(hi, (int, float)):
                    raise SsrmBadRequest()
                out = out[(series >= lo) & (series <= hi)]
        else:
            raise SsrmBadRequest()
    sort_cols, ascending = [], []
    for item in body.get("sortModel") or []:
        if not isinstance(item, dict) or item.get("sort") not in ("asc", "desc") or item.get("colId") not in out.columns:
            raise SsrmBadRequest()
        sort_cols.append(item["colId"])
        ascending.append(item["sort"] == "asc")
    if sort_cols:
        out = out.sort_values(by=sort_cols, ascending=ascending, kind="mergesort")  # stable
    total = len(out)
    return out.iloc[start:end], total


def _ssrm_json_safe(page) -> list:
    """Records with NaN/NaT -> null and timestamps -> ISO, via pandas' own JSON writer."""
    return json.loads(page.to_json(orient="records", date_format="iso"))


async def _ssrm(request):
    """POST <route>/ssrm for a listed route; 404 otherwise."""
    path = request.url.path
    route = path[: -len(SSRM_SUFFIX)]
    if request.method != "POST" or route not in SSRM_ROUTES:
        return _cors(request, JSONResponse({"detail": "Not Found"}, 404))
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        return _cors(request, JSONResponse({"detail": "The SSRM request body is not JSON."}, 400))
    params = dict(request.query_params)
    key = (route, tuple(sorted(params.items())))
    authorization = request.headers.get("authorization")
    try:
        df = await SSRM_CACHE.get(key, lambda: _acquire(request.app, route, params, authorization))
        page, total = _apply_query(df, body)
    except SsrmBadRequest:
        return _cors(request, JSONResponse(
            {"detail": "This widget's table supports filtering and sorting on single pages only."}, 400))
    except SsrmUpstream as exc:
        response = Response(exc.body, exc.status, media_type=exc.media_type)
        return _cors(request, response)
    return _cors(request, JSONResponse({"rowData": _ssrm_json_safe(page), "rowCount": int(total)}))
```

Wire it into `middleware` — add BEFORE the `if LANE is not None:` line (so a `/ssrm` POST under a lane prefix is handled here, not forwarded to the worker which has no such route):

```python
    if request.method == "POST" and request.url.path.endswith(SSRM_SUFFIX):
        return await _ssrm(request)
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd od-v4 && python3 -m unittest lanes.tests.test_lanes.SsrmRowsTest -v`
Expected: PASS (all 13 tests).

- [ ] **Step 5: Run the whole lane suite + the public scan.**

Run: `cd od-v4 && python3 -m unittest discover lanes/tests && python3 scripts/check-public.py`
Expected: PASS (known macOS `..._memory_passes_the_cap` false failure excepted); `check-public.py` prints `PASS`.

- [ ] **Step 6: Commit.**

```bash
cd od-v4 && git add lanes/openbq_lanes.py lanes/tests/test_lanes.py
git commit -m "feat(v4): serve the largest widgets as server-paged SSRM tables"
```

---

### Task 3: Gateway admits the 23 SSRM routes (openbq-docker)

**Files:**
- Create: `od-v4/funnel-gateway/ssrm-routes.test.mjs`

**Interfaces:**
- Consumes: `lanes/ssrm_widgets.json` (Task 1); `policy.mjs`'s `tableRoute`, `validSsrmRoutes` and `config.mjs`'s `validateConfig` (already present, unchanged).
- Produces: nothing new; proves the door-path list the deploy will set is admitted.

- [ ] **Step 1: Write the failing test.** `funnel-gateway/ssrm-routes.test.mjs`:

```javascript
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tableRoute, validSsrmRoutes } from "./policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const widgets = JSON.parse(readFileSync(join(here, "..", "lanes", "ssrm_widgets.json"), "utf8"));
// The door prefixes the client route with /api and the handler suffixes /ssrm.
const doorPaths = widgets.map(w => `/api${w.route}/ssrm`);

test("the committed list is 23 unique routes the gateway's validator accepts", () => {
  assert.equal(widgets.length, 23);
  assert.equal(new Set(widgets.map(w => w.id)).size, 23);
  assert.equal(new Set(doorPaths).size, 23);
  assert.ok(validSsrmRoutes(doorPaths));
});

test("every committed SSRM route admits a POST and an unlisted sibling does not", () => {
  const config = { ssrmRoutes: doorPaths };
  for (const path of doorPaths) {
    const admitted = tableRoute(new URL(path, "https://example.com"), "POST", config);
    assert.ok(admitted && admitted.managed === false, path);
  }
  // A listed route carrying a widget param in the query string is still admitted.
  assert.ok(tableRoute(new URL(doorPaths[0] + "?start_date=2026-01-01", "https://example.com"), "POST", config));
  // An unlisted /ssrm POST, a GET on a listed route, and a traversal are all refused.
  assert.equal(tableRoute(new URL("/api/api/v1/not/listed/ssrm", "https://example.com"), "POST", config), null);
  assert.equal(tableRoute(new URL(doorPaths[0], "https://example.com"), "GET", config), null);
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `cd od-v4 && docker run --rm -v "$PWD:/r" -w /r/funnel-gateway node:22 sh -c "npm ci --ignore-scripts && npm test"`
Expected: FAIL — `widgets.length` is 23 only once Task 1's file exists; if the file is present the test should pass, so if it is written before Task 1 it fails on the missing file. (If Task 1 is already committed, this test passes immediately — that is acceptable; the point is it is committed and runs in CI.)

- [ ] **Step 3: No implementation needed.** `policy.mjs` already supports `ssrmRoutes`. If the test fails for any reason other than a missing/short list, stop — `policy.mjs` must not be edited (it is the vendored contract); fix the data file instead.

- [ ] **Step 4: Run the full gateway suite.**

Run: `cd od-v4 && docker run --rm -v "$PWD:/r" -w /r/funnel-gateway node:22 sh -c "npm ci --ignore-scripts && npm test"`
Expected: PASS (all gateway tests, including the new file).

- [ ] **Step 5: Commit.**

```bash
cd od-v4 && git add funnel-gateway/ssrm-routes.test.mjs
git commit -m "test(v4): the gateway admits the 23 SSRM POST routes"
```

---

### Task 4: README docs (openbq-docker)

**Files:**
- Modify: `od-v4/README.md`

- [ ] **Step 1: Add a "Large datasets as server-paged tables" subsection** under "Heavy routes" (after the heavy-routes paragraph, ~line 71). Write, in the README's voice:
  - Name the behaviour: the ~23 largest table widgets (default response > ~10 MB) are rewritten in `/widgets.json` to `type: "ssrm_table"` with endpoint `<route>/ssrm`; the full GET never crosses the caches, the door or the client.
  - `POST <route>/ssrm` (listed routes only, else 404) takes the OpenBB SSRM request body and the widget's params in the query string; it acquires the full result once through the app (heavy routes keep their lane), caches it as a pandas DataFrame (3 GiB LRU, 15-minute TTL, concurrent first requests share one acquisition), and answers `{"rowData", "rowCount"}` with a filtered, sorted, ≤1,000-row page. Grouping/values/pivot and unknown filters → 400; an upstream non-2xx keeps its status and sanitised body.
  - The list is `lanes/ssrm_widgets.json`; the full 23-widget table (id + route) copied from the spec.
  - Settings: `OPENBQ_SSRM_WIDGETS`, `OPENBQ_SSRM_CACHE_BYTES`, `OPENBQ_SSRM_TTL`.
  - The door's `ssrmRoutes` must list the 23 `/api/api/v1/<rest>/ssrm` paths (set at deploy from `ssrm_widgets.json`).

- [ ] **Step 2: Run the public scan.**

Run: `cd od-v4 && python3 scripts/check-public.py`
Expected: `PASS`.

- [ ] **Step 3: Commit.**

```bash
cd od-v4 && git add README.md
git commit -m "docs(v4): document the server-paged SSRM table widgets"
```

---

### Task 5: Vendor + parity for the web preview's SSRM route list (BDOBB)

> **This task runs in a clean clone of BDOBB v4, NOT the plan's own worktree** (a gate is running there). Clone/checkout `claude/v4-regression-20261015` elsewhere, or run after the gate finishes. The plan file commit (final step) is the only write to the running worktree.

**Files:**
- Modify: `scripts/gateway-vendor.mjs` (also emit the route list)
- Create: `web/ssrm-routes.vendored.json` (generated, committed)
- Create: `web/ssrm-routes.test.mjs`

**Interfaces:**
- Consumes: openbq-docker's `lanes/ssrm_widgets.json` (read by the vendor script at a tag); `web/config.mjs` `readConfig`, `web/policy.mjs` `tableRoute`/`validSsrmRoutes` (unchanged).
- Produces: `web/ssrm-routes.vendored.json` — a JSON array of 23 door paths; the parity test keeps `SSRM_ROUTES_JSON` equal to it by construction.

- [ ] **Step 1: Extend `gateway-vendor.mjs`.** After it writes `web/policy.mjs` and `web/policy.vendored.json`, add a read of `lanes/ssrm_widgets.json` at the same tag/commit and write the door-path list:

```javascript
const widgetsJson = execFileSync("git", ["-C", OD, "show", `${commit ?? tag}:lanes/ssrm_widgets.json`], { encoding: "utf8" });
const doorPaths = JSON.parse(widgetsJson).map(w => `/api${w.route}/ssrm`);
writeFileSync(join(ROOT, "web", "ssrm-routes.vendored.json"), JSON.stringify(doorPaths, null, 2) + "\n");
```

- [ ] **Step 2: Generate the vendored file.** Run the vendor against the v4 tag (or its head commit before the tag is cut), with `OPENBQ_DOCKER_DIR` pointing at the local openbq-docker checkout:

```bash
OPENBQ_DOCKER_DIR=<path-to-od-v4-checkout> pnpm gateway:vendor v4.0.0 <od-head-commit-40-hex>
```

Expected: `web/ssrm-routes.vendored.json` contains the 23 door paths; `web/policy.mjs` is byte-identical to the committed one (its sha256 unchanged — policy.mjs did not change).

- [ ] **Step 3: Write the failing parity test.** `web/ssrm-routes.test.mjs`:

```javascript
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readConfig } from "./config.mjs";
import { tableRoute, validSsrmRoutes } from "./policy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const routes = JSON.parse(readFileSync(join(here, "ssrm-routes.vendored.json"), "utf8"));

const env = {
  APP_ORIGIN: "https://app.example.com/", AUTH_SECRET: "x".repeat(32),
  AUTH_GITHUB_ID: "id", AUTH_GITHUB_SECRET: "secret", SESSION_EPOCH: "1",
  SSRM_ROUTES_JSON: JSON.stringify(routes),
};

test("the vendored SSRM route list is 23 valid routes the web config accepts", () => {
  assert.equal(routes.length, 23);
  assert.ok(validSsrmRoutes(routes));
  assert.deepEqual(readConfig(env).ssrmRoutes, routes);  // SSRM_ROUTES_JSON == the gateway's list
});

test("the web preview admits exactly the vendored SSRM POSTs", () => {
  const config = { ssrmRoutes: routes };
  for (const path of routes) {
    assert.ok(tableRoute(new URL(path, "https://example.com"), "POST", config), path);
  }
  assert.equal(tableRoute(new URL("/api/api/v1/not/listed/ssrm", "https://example.com"), "POST", config), null);
});
```

- [ ] **Step 4: Run it to verify it fails, then passes.**

Run: `node --test web/ssrm-routes.test.mjs`
Expected: FAIL before Step 2 (missing file), PASS after.

- [ ] **Step 5: Run the web test suite + the scrub gate.**

Run: `node --test web/*.test.mjs && bash scripts/scrub-check.sh`
Expected: PASS; scrub-check prints clean.

- [ ] **Step 6: Commit** (in the clean BDOBB checkout, not the running worktree).

```bash
git add scripts/gateway-vendor.mjs web/ssrm-routes.vendored.json web/ssrm-routes.test.mjs
git commit -m "feat(v4): vendor the 23 SSRM routes for the web preview and pin parity"
```

---

### Task 6: A rewritten-catalogue widget pages and never fetches the whole result (BDOBB)

> Same clean-checkout caveat as Task 5.

**Files:**
- Create: `e2e/ssrm-large-widget.spec.ts`

**Interfaces:**
- Consumes: `normalizeWidgets` (rewritten catalogue shape → `type: "ssrm_table"`, `endpoint`, `ssrm`), the existing SSRM provider, `SsrmTableRenderer`, and the `web/ssrm-provider.mjs`/`e2e/fixtures` harness patterns from `ssrm-parity.spec.ts` / `ssrm-widget.spec.ts`.
- Produces: proof that a card built from the exact `/widgets.json` entry the API now serves pages via `POST <endpoint>` and issues no GET to the bare route.

- [ ] **Step 1: Write the failing test.** `e2e/ssrm-large-widget.spec.ts`. Model it on the second test of `ssrm-parity.spec.ts` ("standard LIVE refuses whole-result consumer surfaces"), but (a) seed the widget via `normalizeWidgets` using the **rewritten catalogue entry shape** the API produces, and (b) intercept network to a fixture that answers `POST <endpoint>` with `{rowData, rowCount}` and asserts the bare GET route is never called:

```typescript
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
import {test, expect} from '@playwright/test';
import {seedApp, dashboardSeed} from './fixtures';

// The exact entry the API now serves for finra_fixedincome_bonds_finra_obb:
// type ssrm_table, endpoint <route>/ssrm, ssrm capabilities. The bare route
// must never be fetched.
const ROUTE = '/api/v1/finra/fixedincome/bonds';
const ENDPOINT = ROUTE + '/ssrm';

test('a rewritten large-dataset widget pages and never issues the full GET', async ({page}) => {
  const bareGets: string[] = [], pagePosts: string[] = [];
  await page.route('**' + ROUTE + '**', async r => {
    const url = new URL(r.request().url());
    if (r.request().method() === 'POST' && url.pathname.endsWith('/ssrm')) {
      pagePosts.push(url.pathname);
      const body = r.request().postDataJSON();
      const all = Array.from({length: 1205}, (_, i) => ({cusip: `C${i}`, price: i + 1}));
      const rowData = all.slice(body.startRow, Math.min(body.endRow, body.startRow + 1000));
      await r.fulfill({contentType: 'application/json', body: JSON.stringify({rowData, rowCount: all.length})});
    } else {
      bareGets.push(url.pathname);                       // a GET on the bare route is the failure
      await r.fulfill({status: 500, body: 'unexpected full GET'});
    }
  });
  await seedApp(page, dashboardSeed([]));
  await page.evaluate(async ({endpoint}) => {
    const r = '/src/stores/widgetRegistryStore.ts', d = '/src/stores/dashboardStore.ts', n = '/src/lib/widgetsJson.ts';
    const registry = (await import(r)).useWidgetRegistryStore as typeof import('../src/stores/widgetRegistryStore').useWidgetRegistryStore;
    const dashboards = (await import(d)).useDashboardStore as typeof import('../src/stores/dashboardStore').useDashboardStore;
    const normalize = (await import(n)).normalizeWidgets as typeof import('../src/lib/widgetsJson').normalizeWidgets;
    registry.setState(s => ({widgets: s.widgets.filter(w => w.type !== 'keys')}));
    registry.setState(s => ({widgets: [...s.widgets, ...normalize({
      finra_bonds: {name: 'FINRA bonds', type: 'ssrm_table', endpoint, ssrm: {sorting: true, filtering: ['text', 'number']}},
    }, 'b1').widgets]}));
    dashboards.setState({dashboards: [{id: 'd1', name: 'Main', tabs: [{id: 't1', name: 'Main',
      cards: [{id: 'bonds', widgetId: 'finra_bonds', backendId: 'b1', params: {}, layout: {x: 0, y: 0, w: 40, h: 20}}]}]}]});
  }, {endpoint: ENDPOINT});
  await expect(page.getByText(/LIVE · paged/)).toBeVisible();
  await expect(page.getByText('C0', {exact: true}).first()).toBeVisible();
  expect(pagePosts.length).toBeGreaterThan(0);
  expect(bareGets).toEqual([]);                           // never the whole 150 MB GET
});
```

Note for the implementer: confirm the exact first-page trigger and the "LIVE · paged" label against `ssrm-parity.spec.ts`; the backend `b1` may need a `backends.json` seed entry (see `ssrm-widget.spec.ts`'s `seed['backends.json']`). Adjust the seed to whatever makes the card mount and fetch its first page — the load-bearing assertions are `pagePosts.length > 0` and `bareGets == []`.

- [ ] **Step 2: Run it to verify it fails, then passes.**

Run: `pnpm exec playwright test e2e/ssrm-large-widget.spec.ts`
Expected: FAIL first (seed/label mismatch or a bare GET), then PASS once the seed mounts the card and the provider pages.

- [ ] **Step 3: Commit.**

```bash
git add e2e/ssrm-large-widget.spec.ts
git commit -m "test(v4): a rewritten large-dataset widget pages and never fetches the whole result"
```

---

### Task 7: Help docs (BDOBB)

> Same clean-checkout caveat as Task 5.

**Files:**
- Modify: `src/help/topics/tables.md`

- [ ] **Step 1: Extend the "LIVE · paged" section** (around line 39). Add a sentence naming the OpenBQ API's largest datasets (FINRA bonds and bond prices, FFIEC institutions/structure, the EIA series, CFTC swap/forward trades, and the rest) as LIVE · paged tables: they fetch one page at a time and sort/filter on the server, and — as the section already states — whole-result formulas, selection charts, exports and linked tables are unavailable because loaded rows cannot represent the complete result. Keep it to two or three sentences; do not restructure the file.

- [ ] **Step 2: Run the scrub gate.**

Run: `bash scripts/scrub-check.sh`
Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add src/help/topics/tables.md
git commit -m "docs(v4): name the largest OpenBQ datasets as LIVE paged tables"
```

---

### Task 8: Build, deploy and live verification (controller / operator)

This task is operator-run after Tasks 1–7 are committed and all repo test suites pass. It is not TDD; its steps are the spec's Verification 4.

- [ ] **Step 1: Build the images multi-arch to GHCR.** From the openbq-docker checkout:

```bash
docker buildx build --builder rss-ticker-builder --platform linux/amd64,linux/arm64 \
  -f Dockerfile.v3 -t ghcr.io/<org>/openbq-local:4.0.0 --push .
docker buildx build --builder rss-ticker-builder --platform linux/amd64,linux/arm64 \
  -f funnel-gateway/Dockerfile -t ghcr.io/<org>/funnel-gateway:4.0.0 --push funnel-gateway
```

- [ ] **Step 2: Set the door and preview route lists at deploy.** Set the gateway `settings.json` `ssrmRoutes` and the web `SSRM_ROUTES_JSON` to the 23 `/api/api/v1/<rest>/ssrm` paths derived from `lanes/ssrm_widgets.json` (the same list `web/ssrm-routes.vendored.json` holds). Deploy both images to the NAS from GHCR (never tarballs). Do not write any tailnet host, IP or token into a committed file.

- [ ] **Step 3: Live checks on the NAS (desktop and through the door):**
  - FINRA bonds (`finra_fixedincome_bonds_finra_obb`), FFIEC institution structure (`ffiec_institution_structure_federal_reserve_obb`) and one EIA widget (e.g. `eia_petroleum_status_report_eia_obb`): the card opens as a paged table — measure first-page time, run a sort, run a text and a number filter.
  - Confirm the API's RSS stays inside its 16 GB cap while these widgets are in use (`GET /openbq/lanes` for the lane; container memory for the API).
  - Re-run the v3 payload sweep: the 23 listed widgets answer in pages, not as the full GET.

- [ ] **Step 4: Record the live results** in the v4 regression ledger (not in this plan).

---

## Self-Review

**1. Spec coverage.**
- Catalogue rewrite (type/endpoint/ssrm, other fields kept, ids unchanged, listed-but-absent skipped) → Task 1. ✓
- Rows endpoint: body contract, acquisition once through the app (lane preserved), LRU 3 GiB / 15-min TTL / single-flight, filter+sort+slice, `{rowData,rowCount}`, JSON-safe, refusals (grouping/values/pivot/unknown filter/bad slice), 404 for unlisted, upstream error kept → Task 2. ✓
- Door `ssrmRoutes` = 23 POST routes → Task 3 (test) + Task 8 Step 2 (deploy). ✓
- BDOBB routing no-change; paging test against rewritten catalogue → Task 6. ✓
- `SSRM_ROUTES_JSON` = same 23, parity test → Task 5. ✓
- Saved cards keep params; LIVE refuses whole-result surfaces → already shipped (`ssrm-parity.spec.ts` second test); Help names it → Task 7. ✓
- Help `tables.md` + README → Task 7 + Task 4. ✓
- Verification 1 (unit), 2 (gateway), 3 (BDOBB), 4 (live) → Tasks 2, 3, 5/6, 8. ✓
- Out of scope (grouping/aggregations refused; no approach A; no sub-10 MB widgets) respected — grouping/values/pivot → 400 in Task 2.

**2. Placeholder scan.** No "TBD"/"add error handling"/"similar to Task N". Each code step carries real code. Task 8's `<org>`/`<path>`/`<od-head-commit>` are deliberate operator substitutions (host-specific, kept out of the repo by the scrub rule), not plan placeholders.

**3. Type consistency.** `SSRM_ROUTES` is `{route: id}` everywhere (Task 1 defines, Task 2 reads). `_rewrite_widgets`/`_rows_from`/`_apply_query`/`_ssrm`/`SsrmCache.get(key, acquire)` signatures match between definition (Task 2) and tests. Door path form `/api${route}/ssrm` is identical in Task 3 (gateway), Task 5 (vendor + parity) and Task 6/8. Reply keys `rowData`/`rowCount` match the client's `OpenbbSsrmRequest`/reply contract in `openbbTypes.ts`/`openbbSsrm.ts`. Filter shapes (`{filterType:'text',type:'contains',filter}`, `{filterType:'number',type:'inRange',filter,filterTo}`, `greaterThanOrEqual`/`lessThanOrEqual`) match what `openbbSsrm.ts buildQuery` emits.

**4. Review Focus.** All five are pinned to Task 2 tests (`test_results_shapes_all_become_row_lists`, `test_concurrent_first_requests_acquire_once`, `test_reply_is_json_safe`, `test_page_past_the_end_is_empty_with_the_true_count`, `test_unknown_column_is_rejected`).
