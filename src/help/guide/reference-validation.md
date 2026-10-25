---
type: Note
tags: [bdobb, help, testing, reference-backend, conformance]
---

# Reference Validation

At first the only backend that could exercise BDOBB was a private deployment — an account, an API key and a tailnet — so nobody outside the project could run the client against anything, and CI ran against nothing at all. The app ships against OpenBB's own **reference backend**: a small FastAPI app in [`backends-for-openbb`](https://github.com/OpenBB-finance/backends-for-openbb) that serves the widget types the OpenBB Workspace spec documents. It needs no account, no key and no tailnet — it is the spec's own implementation, which is what makes it usable as an oracle rather than a copy of the app's own reading of the spec.

OpenBB has since archived that repository, and the storage behind its sample PDFs refuses every request. The script therefore clones [`bdobb-dev/backends-for-openbb`](https://github.com/bdobb-dev/backends-for-openbb), a fork: the same app plus `uvicorn[standard]`, which the Live Grid widget's websocket needs, and sample PDFs linked from GitHub. A `.reference-backend/` left by an earlier run that was cloned from the archived repository is replaced with a fresh clone of the fork.

## Running it

From a BDOBB checkout:

```
pnpm reference-backend
```

The first run clones the repository into `.reference-backend/` (gitignored) and builds a virtualenv — about 40 seconds. Every run after that goes straight to serving on `http://127.0.0.1:7779`, with widgets at `/widgets.json` and apps at `/apps.json`. `PORT=7780 pnpm reference-backend` serves somewhere else; `REF_BACKEND_REF=<sha>` checks out a specific upstream commit — CI pins one commit so an upstream change never breaks a build unannounced.

## Importing it

With the backend running, **Connect** to `http://127.0.0.1:7779` like any other backend (see [[connecting-a-backend|Connecting a Backend]]), then import `http://127.0.0.1:7779/apps.json` the way you would any `apps.json` (see [[importing-dashboards|Importing Dashboards]]). The historical upstream fixture arrives as one dashboard with 14 tabs and 70 cards; the qualified curated build omits Python Omni and has 69 onboarding cards. Both preserve **three parameter groups** on its Grouping tab — proof, on a stack anyone can boot, that the titlebar parameter-groups feature (see [[card-parameters|Card Parameters]]) reads membership the way OpenBB Workspace actually writes it, not only the way an earlier, narrower reading of the shape assumed.

## The conformance suite

A second command, run alongside the backend:

```
OPENBB_REFERENCE=1 pnpm test:reference
```

Seven checks run in Node against the live backend, calling the same code the app calls: the corpus is big enough to mean anything (at least 50 widgets, so a backend answering `200 {}` cannot pass vacuously); `normalizeWidgets` loses nothing; every widget has the fields the renderers require; every generated request URL stays on the backend's own origin; every table, metric and chart widget actually fetches and yields data; and the actual onboarding app imports and round-trips its tabs/cards/groups, and every widget type the backend serves is either one BDOBB renders or one on its known-unrendered list (empty at this version: every type it serves is drawn). Every other type the reference backend serves renders in place: its tables, metrics, markdown and PDFs, its native-Plotly charts and its Highcharts and Vega-Lite charts (translated into that Plotly), the news feed, YouTube embeds, the streaming live grid, the omni prompt widget and the TradingView chart (daily candles on lightweight-charts).

Without `OPENBB_REFERENCE` the suite skips, so the ordinary test run stays green with no backend running. **With** the flag and no backend, every check fails rather than skips — a suite that quietly turned itself off when the backend was missing would report green for a client that is actually broken, which is the one failure this exists to catch.

## The public demo

The repository also carries a public, keyless demo of this version built on the same backend. `deploy/reference-demo/` runs the reference backend in Docker, pinned to the same upstream commit CI tests against, behind a Tailscale Funnel on port 443, and a static browser build of the app, hosted on Vercel, talks to it. The build seeds one connection, **Reference**, pointed at the backend address it is given, and one dashboard, *BDOBB v3.3 — Reference Demo*, with six tabs: Overview, Charts, Data, News, Video (the reference backend's own YouTube widget) and Omni. It is public and unauthenticated by design, serves only the backend's synthetic demo data, and touches nothing on the private stack; `deploy/reference-demo/README.md` has the deploy order. The demo image leaves out the reference backend's Python Chart omni widget, which runs whatever code it is sent; the build fails if that route is still served. A local `pnpm reference-backend` keeps it.

*Source: BDOBB v3.3.0 `docs/test-environment.md`; `BDOBB` `scripts/reference-backend.sh` and `src/test/integration/reference-backend.test.ts` at `v3.3.0`; `deploy/reference-demo/README.md`, `deploy/reference-demo/vercel/build.mjs`, `deploy/reference-demo/vercel/demo-seed.mjs` and `deploy/reference-demo/reference-backend/Dockerfile` at `v3.3.1`; `BDOBB` `scripts/reference-backend.sh` and `.github/workflows/ci.yml` at `v3.1.2`; `BDOBB` `deploy/reference-demo/reference-backend/Dockerfile` and `check-no-exec.py` at `v3.3.2`.*
*See also: [[connecting-a-backend|Connecting a Backend]] · [[importing-dashboards|Importing Dashboards]] · [[example-dashboards|Example Dashboards]] · [[card-parameters|Card Parameters]]*

## Clean v3 reference walkthrough

The October 6, 2026 clean v3 rehearsal used the curated reference image: 71 widgets, the 14-tab **Onboarding App for Devs**, and three parameter groups. Its source and image identity are recorded in the release provenance. A file carrying an archived enabled Pivot state is refused without adding dashboards.

1. Add the running reference backend in **Connections**.
2. Choose **Apps ▸ Open Onboarding App for Devs**.
3. Open **Grouping** and change **Manufacturer** from Toyota to Tesla. Both linked controls and their data should change.
4. Try **Run** on a run-button widget, and a numeric-refresh example. Cron scheduling is not supported.
5. Save the dashboard with **Save…**, Format **BDOBB Workspace**, and import it back with **Keep both**. Ordinary names and table state travel with that file. Choose **Strict OpenBB Workspace** when you need the plain OpenBB shape.

The full curated reference rendering sweep passed 71/71, including interactive PDF viewers, SQL Omni, Live Grid, Highcharts and Vega-Lite. Seven reference contract/import/export tests passed. A separate OpenBQ Docker smoke passed nine selected live cases; that is not certification of its whole catalog. The browser rehearsal used a test-only CORS adapter with unchanged backend responses. Native packaged restart and live Workspace account authentication remain unqualified.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
