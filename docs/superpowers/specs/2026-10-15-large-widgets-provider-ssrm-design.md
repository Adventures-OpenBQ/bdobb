<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The OpenBQ API's largest datasets as server-paged tables

Date: 2026-10-15
Status: approved in brainstorming (approach B, sections 1–2); written spec awaiting review
Home line: v4 (openbq-docker and BDOBB), carried v5 → v10 by the SSRM walk

## Why

About twenty OpenBQ API table widgets return 10–160 MB of JSON for their default request
(FINRA bonds and bond prices 150 MB, FFIEC institution structure 159 MB). Each full payload
crosses the API's catalogue caches, the Funnel door and the client, which slowed the caches
and crashed the regression's renderer. The user ruled (2026-10-15) that those widgets use the
table-ssrm work: every widget over about 10 MB, routed automatically.

v4's managed table service cannot hold them within its budget without a redesign (whole-document
ingest at every stage, a compiled 32× job reservation, a 65 s acquisition deadline). The user
chose approach **B**: the API itself serves the standard OpenBB SSRM contract for those widgets,
and BDOBB's existing "LIVE · paged" provider renders them.

**Success:** a card for any listed widget opens as a paged table that fetches one page at a
time (never the full GET), sorts and filters on the server, on the desktop and through the door;
the API's memory stays inside its 16 GB cap while those widgets are in use.

## The widgets (from the v3 payload sweep, largest default or non-default response > 10 MB)

| Widget id | Route | Largest response |
|---|---|---|
| `bls_jolts_revisions_bls_obb` | `/api/v1/bls/jolts/revisions` | 11.7 MB |
| `eia_petroleum_imports_exports_and_movements_movements_of_crude_oil_and_selected_products_by_rail_eia_obb` | `/api/v1/eia/petroleum/imports_exports_and_movements/movements_of_crude_oil_and_selected_products_by_rail` | 12.3 MB |
| `tmx_fixedincome_prices_tmx_obb` | `/api/v1/tmx/fixedincome/prices` | 12.9 MB |
| `eia_petroleum_refining_and_processing_refinery_net_input_eia_obb` | `/api/v1/eia/petroleum/refining_and_processing/refinery_net_input` | 13.8 MB |
| `eia_natural_gas_consumption_end_use_natural_gas_consumption_by_end_use_eia_obb` | `/api/v1/eia/natural_gas/consumption_end_use/natural_gas_consumption_by_end_use` | 14.1 MB |
| `eia_coal_by_mine_by_plant_eia_obb` | `/api/v1/eia/coal/by_mine_by_plant` | 14.4 MB |
| `ecb_eligible_assets_ecb_obb` | `/api/v1/ecb/eligible_assets` | 16.0 MB |
| `eia_petroleum_refining_and_processing_refinery_blender_net_input_eia_obb` | `/api/v1/eia/petroleum/refining_and_processing/refinery_blender_net_input` | 16.2 MB |
| `eia_petroleum_refining_and_processing_refinery_net_production_eia_obb` | `/api/v1/eia/petroleum/refining_and_processing/refinery_net_production` | 17.6 MB |
| `eia_petroleum_refining_and_processing_natural_gas_plant_field_production_eia_obb` | `/api/v1/eia/petroleum/refining_and_processing/natural_gas_plant_field_production` | 22.4 MB |
| `imf_chokepoint_volume_imf_obb` | `/api/v1/imf/chokepoint_volume` | 26.6 MB |
| `eia_petroleum_imports_exports_and_movements_movements_by_tanker_and_barge_between_pad_districts_eia_obb` | `/api/v1/eia/petroleum/imports_exports_and_movements/movements_by_tanker_and_barge_between_pad_districts` | 28.7 MB |
| `eia_natural_gas_prices_natural_gas_prices_eia_obb` | `/api/v1/eia/natural_gas/prices/natural_gas_prices` | 30.4 MB |
| `eia_petroleum_prices_weekly_retail_gasoline_and_diesel_prices_eia_obb` | `/api/v1/eia/petroleum/prices/weekly_retail_gasoline_and_diesel_prices` | 39.2 MB |
| `eia_petroleum_status_report_eia_obb` | `/api/v1/eia/petroleum_status_report` | 45.6 MB |
| `cftc_fx_forward_trades_cftc_obb` | `/api/v1/cftc/fx_forward_trades` | 45.8 MB |
| `eia_natural_gas_summary_natural_gas_summary_eia_obb` | `/api/v1/eia/natural_gas/summary/natural_gas_summary` | 47.9 MB |
| `cftc_swap_trades_cftc_obb` | `/api/v1/cftc/swap_trades` | 48.6 MB |
| `ny_market_expectations_federal_reserve_obb` | `/api/v1/federal_reserve/ny/market_expectations` | 54.3 MB |
| `ffiec_institutions_federal_reserve_obb` | `/api/v1/federal_reserve/ffiec/institutions` | 68.8 MB |
| `finra_fixedincome_bonds_finra_obb` | `/api/v1/finra/fixedincome/bonds` | 149.9 MB |
| `finra_fixedincome_bond_prices_finra_obb` | `/api/v1/finra/fixedincome/bond_prices` | 149.9 MB |
| `ffiec_institution_structure_federal_reserve_obb` | `/api/v1/federal_reserve/ffiec/institution_structure` | 158.7 MB |

The list is committed as data (one file) in openbq-docker; a widget id absent from `/widgets.json`
is skipped, not an error.

## openbq-docker v4

Everything lives in the existing `lanes` hook (`lanes/openbq_lanes.py`, `openbb.toml` `[middleware]`);
no upstream OpenBB file changes.

- **Catalogue rewrite.** For each listed widget, the cached `/widgets.json` entry gets
  `type: "ssrm_table"`, `endpoint: "<route>/ssrm"` and
  `ssrm: {"sorting": true, "filtering": ["text", "number"]}`; every other field (params, columnsDefs,
  name, category) is kept. Widget ids do not change, so `/apps.json` cards keep resolving.
- **The rows endpoint** `POST /api/v1/<route>/ssrm`, for listed routes only (anything else 404):
  - Body: the OpenBB SSRM request `{startRow, endRow, sortModel, filterModel, rowGroupCols, groupKeys,
    valueCols, pivotCols, pivotMode}`; the widget's params in the query string.
  - Acquisition: the original `GET <route>?<params>` runs once per (route, params) through the app
    itself, so heavy routes keep their lane, deadlines and caps; a non-2xx keeps its status and the
    door's sanitised body.
  - Cache: the result as a pandas DataFrame in an LRU keyed by (route, sorted params), 3 GiB total
    (by `DataFrame.memory_usage(deep=True)`), 15-minute TTL, concurrent first requests for one key
    share a single acquisition.
  - Query: `filterModel` text `contains` (case-insensitive) and number `inRange`,
    `greaterThanOrEqual`, `lessThanOrEqual`; `sortModel` multi-column stable sort; then the
    `[startRow, endRow)` slice, at most 1,000 rows per request.
  - Reply: `{"rowData": [...], "rowCount": <total after filtering>}`; values JSON-safe (NaN → null,
    timestamps ISO).
  - Refusals: grouping, values, pivot or any unknown filter type/shape → 400 with a fixed message;
    `endRow - startRow` over 1,000 or negative → 400.
- **Door.** The gateway's `ssrmRoutes` lists exactly the 23 POST routes (`/api/api/v1/<route>/ssrm`);
  POSTs carry the injected Basic pair and the daily budget like any `/api` call.

## BDOBB v4

- **Routing: no change.** `ssrm_table` widgets already render through `SsrmTableRenderer` with the
  standard OpenBB SSRM provider ("LIVE · paged"). A test with a catalogue fixture of the rewritten
  form proves a card for such a widget pages and never issues the full GET.
- **Web preview.** `SSRM_ROUTES_JSON` lists the same 23 routes; a test keeps it equal to the
  gateway's list.
- **Saved cards.** Existing saved cards for these widgets keep their params; LIVE pages refuse
  whole-result formulas, selection charts, exports and linked tables visibly, as the v4 Help already
  documents.
- **Help.** `tables.md` names the OpenBQ API's largest datasets as LIVE · paged tables and what they
  do not offer. openbq-docker's README lists the widgets.

## Out of scope

Grouping and aggregations on these widgets (refused; the client already refuses undeclared
capabilities). The managed-table ingest redesign (approach A). Widgets under 10 MB.

## Verification

1. openbq-docker unit tests: catalogue rewrite (type, endpoint, capabilities; unlisted widgets
   byte-identical); rows endpoint (filters, sorts, slice, `rowCount`, the 1,000-row cap, 400s, an
   upstream error kept); LRU eviction at the byte bound and TTL expiry; one acquisition for
   concurrent first requests.
2. Gateway tests: the 23 POST routes pass; an unlisted `/ssrm` POST is refused.
3. BDOBB: the paging test above; the `SSRM_ROUTES_JSON` parity test; the full v4 gate.
4. Live on the NAS (part of the v4 regression): FINRA bonds, FFIEC institution structure and one EIA
   widget on the desktop and through the door — first page time, a sort, a filter, and the API's
   memory under its cap; the payload sweep re-run shows the listed widgets answering in pages.
