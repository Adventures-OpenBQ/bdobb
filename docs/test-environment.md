> Clean v3 qualification: use the October 6 receipt in `docs/releases/qualification-v3.json`. The earlier generic-fork setup below remains available, but its historical counts are not the curated qualification count.

# The test environment

BDOBB talks to an OpenBB Workspace backend. Until v3.1.0 the only backend that
could exercise it was a private deployment — an account, an API key and a
tailnet — which meant nobody else could run the client against anything, and CI
ran against nothing at all.

OpenBB publishes a **reference backend** for exactly this: a small FastAPI app
in [`backends-for-openbb`](https://github.com/OpenBB-finance/backends-for-openbb)
that serves the widget types the spec documents. It needs no account, no key
and no tailnet. It is the spec's own implementation rather than our reading of
the spec, which is what makes it usable as an oracle. OpenBB has since archived that
repo and its sample PDFs' S3 bucket refuses all access, so the script clones
[`bdobb-dev/backends-for-openbb`](https://github.com/bdobb-dev/backends-for-openbb):
upstream plus `uvicorn[standard]` (the Live Grid websocket) and PDFs linked
from GitHub.

## Running it

```
pnpm reference-backend
```

First run clones the repo into `.reference-backend/` (gitignored) and builds a
virtualenv — about 40 seconds. Every run after that goes straight to serving:

```
reference-backend: serving http://127.0.0.1:7779 (widgets at /widgets.json, apps at /apps.json)
INFO:     Uvicorn running on http://127.0.0.1:7779 (Press CTRL+C to quit)
```

Two knobs:

- `PORT=7780 pnpm reference-backend` — serve somewhere else.
- `REF_BACKEND_REF=<sha> pnpm reference-backend` — check out a specific
  upstream commit, moving an existing checkout onto it if it is elsewhere. CI
  pins `32615f789f9423ea14d3f95003da250f4ef5bcfc`.

Delete `.reference-backend/` to start over.

The pin fixes the backend's *source*, not its dependencies: upstream's
`requirements.txt` names `fastapi`, `uvicorn`, `plotly`, `pandas`, `requests`,
`pydantic` and `highcharts-core` without versions, so a release of any of them
can still change what the `reference` job installs.

The script refuses rather than half-starting. A busy port is the one that
matters:

```
reference-backend: port 7779 is already in use. Stop what is on it, or run PORT=<n> pnpm reference-backend.
```

That check exists because `uvicorn`'s own bind failure is a traceback *inside*
its startup log. From outside it reads as a successful start; the server then
exits and every request fails with nothing to explain it.

## What it serves

At the pinned commit, measured:

- **70 widgets** at `/widgets.json`.
- **1 app** at `/apps.json`, with **14 tabs** and **70 cards**.

By type, after `normalizeWidgets`: 26 `markdown`, 19 `table`, 7 `chart`, 2
`pdf`, 2 `multi_file_viewer`, 1 `metric`, 1 `html` — 58 that BDOBB draws — plus
12 across seven types that it does not.

## Current reference gate

The curated reference tested for clean v3 has **71 widgets**. Its ordinary onboarding app has **14 tabs, 69 cards and three groups**; Python Omni is absent, and two additional table widgets support a later analytical app. v3 deliberately refuses that analytical app without writes.

The clean client passed all 71 rendering cases, seven contract/import/export tests, Apps/grouping acceptance, and numeric-refresh/Run checks. OpenBQ Docker passed nine selected live smoke cases. Browser rehearsal uses a test-only CORS adapter with unchanged responses; native restart and live Workspace account authentication remain unqualified. Cron scheduling is deferred.

For the already-running curated backend on 7780:

```sh
OPENBB_REFERENCE_URL=http://127.0.0.1:7780 pnpm test:reference
OPENBQ_REFERENCE_URL=http://127.0.0.1:7780 pnpm exec playwright test e2e/reference-acceptance.spec.ts
```

For the per-widget rendering and Docker smoke, start `node scripts/browser.mjs` separately, then run `node scripts/reference-render.mjs`, `node scripts/reference-controls.mjs`, and `node scripts/openbq-smoke.mjs`. The current rehearsal scripts use the curated reference on 7780 and OpenBQ Docker on 6912. Do not run two harnesses on 4173/4174. Result files and screenshots go to ignored `e2e-results/`.

## The conformance suite

```
pnpm reference-backend      # one terminal
pnpm test:reference         # another
```

Seven checks, run in the Node environment against the live backend, calling the
same `normalizeWidgets`, `buildWidgetUrl`, `seedParams` and `extractData` the
app calls:

1. **The corpus is big enough to mean anything** (≥ 50 widgets). Without it, a
   backend answering `200 {}` makes every check below vacuously true.
2. **`normalizeWidgets` loses nothing** — it reports no issues.
3. **Every widget has the fields the renderers require** — `id`, `name`,
   `endpoint`.
4. **Every generated URL stays on the backend's own origin.** Nothing in a
   remote `widgets.json` may steer a request elsewhere.
5. **Every table, metric and chart widget actually fetches**, seeded from its
   declared defaults, and yields data at its `dataKey`.
6. **The actual onboarding app round-trips** its cards, tabs and groups, and unsupported analytical apps are refused.
7. **Every type is either rendered or named as known-unrendered** — see below.

### Why it is opt-in and not skip-if-unreachable

Without `OPENBB_REFERENCE` the file skips, so `pnpm test:run` stays green for
someone who has never started the backend. **With** `OPENBB_REFERENCE=1` and no
backend, it fails:

```
Error: could not reach http://127.0.0.1:7779/widgets.json — start it with `pnpm reference-backend`, or point OPENBB_REFERENCE_URL at one that is running
```

A suite that turned itself off when the backend was missing would report green
for a completely broken client — the exact failure it exists to catch. Point it
elsewhere with `OPENBB_REFERENCE_URL`.

CI runs it as its own `reference` job, against the pinned commit, so an
upstream change arrives as a deliberate bump of `REF_BACKEND_REF` rather than
as a red build on someone's unrelated push.

## Importing the app

With the backend running, import `http://127.0.0.1:7779/apps.json`. It arrives
as **one dashboard with 14 tabs and 70 cards**, nothing unresolved, and **three
parameter groups**. On the **Grouping** tab:

- `company_details` and `company_performance` are both in Group 1 (`company`)
  and Group 2 (`year`) — changing either control moves both cards.
- `table_widget_with_grouping_by_cell_click` and
  `widget_managed_by_parameter_from_cell_click_on_table_widget` are both in
  Group 3 (`symbol`).

Those three groups imported as **zero** before this line's own grouping work
(N4). Workspace declares membership on each *layout entry*, naming groups by
name; BDOBB looked for a `widgetIds` list on the app-level group object, which
the reference app does not publish. Export had the mirror-image bug, so
grouping did not survive a round trip either. Both directions are fixed, and
`widgetIds` is still read when a hand-written file uses it.

## The seven types shown as raw JSON

`advanced_charting`, `chart-highcharts`, `chart-vegalite`, `live_grid`,
`newsfeed`, `omni`, `youtube`.

This is the designed exercise of the raw fallback, not a gap: a card still
renders, readably, rather than failing. Check 6 asserts the set, so a **new**
upstream type arrives as a test failure rather than as a silent enlargement of
the set of widgets shown as raw JSON. The two lists live in
`src/lib/widgetTypes.ts`.

## Demo providers

**Demo keys are stack configuration, never app state.** BDOBB ships no
provider keys and has no key UI; a fresh openbb-docker stack works out of
the box because its committed `credentials.env.example` carries the values
below, not because the app stores anything.

The v3.0.0 image installs `openbb==4.7.2` without extras — only the core
provider set. Of those, six work with zero sign-ups:

| Provider | Path | Verified |
|---|---|---|
| EIA | `EIA_API_KEY=DEMO_KEY` (api.data.gov's shared demo key; 30 req/hour/IP) — the Short Term Energy Outlook needs no key at all | 200 |
| Congress.gov | `CONGRESS_GOV_API_KEY=DEMO_KEY` — the provider refuses an empty key, so the demo value is the only zero-sign-up path | 200 |
| BLS | keyless via `bls_search` (`category`+`query`, e.g. `category=cpi&query=CUUR0000SA0`) — BLS's own API needs no `registrationkey` for either fetcher, but `bls_series`'s openbb-bls Fetcher never sets `require_credentials = False` the way `bls_search`'s does, so `bls_series` 400s on this stack's blank `BLS_API_KEY` even though BLS itself would answer it; the example and smoke.sh both use `bls_search` for this reason | 200 |
| CFTC | keyless — `app_token` is optional; Socrata throttles by IP without one | 200 |
| EconDB | keyless — the provider mints a temporary token when `ECONDB_API_KEY` is empty | 200 |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY=demo` answers only the documentation's example calls — through the OpenBB provider that means historical EPS for `IBM` works, nothing else does | EPS 200 |

FMP's `demo` key is dead (401), TradingEconomics' `guest:guest` is
discontinued (410), and FRED/Tiingo/Intrinio/Benzinga have no keyless or
demo path at all — none of those five are wired into the demo-providers
example for that reason.

`docs/examples/v3.1.0-demo-providers.apps.json` (served by od v3.0.1's
`/apps.json`, alongside the built-ins example) carries one card per
provider above, so a freshly imported stack shows real data from all six on
first open with nothing entered.

## What this does not cover

**The chat pane, the agent protocol and MCP.** Not an omission — there is
nothing here to test against. In Workspace the direction of the call is
inverted: Workspace calls *your* agent, so a public reference *agent* is not a
thing that can exist the way a reference backend can. There is no endpoint to
point a conformance suite at.

Covering it needs a different instrument — a local agent implementing the
protocol, driven by a harness that plays the Workspace side. That is v6.0.0
work.
