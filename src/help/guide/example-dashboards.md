---
type: Note
tags: [bdobb, help, examples, apps-json]
---

# Example Dashboards

The openbq-docker API serves five BDOBB example dashboards on its own `/apps.json`, next to its provider apps: **Built-in widgets**, **Demo providers**, **Video Library**, **V4 core tools** and **Parameters**. Each is an ordinary `apps.json` entry (see [[importing-dashboards|Importing Dashboards]]) that you open from the rail's **Apps** list like any other backend-served app. Each opens with nothing entered: no key, no sign-up, no configuration. Beside them are three of OpenBB Workspace's own dashboards, rebuilt for this stack (see **OpenBB Workspace dashboards** below).

BDOBB 4.0.0 pairs with **openbq-docker v4** (Adventures-OpenBQ/openbq-docker, tag `v4.0.0`; see [[openbq-docker-stack|The openbq-docker Stack]]). Every openbq-docker release serves one combined `apps.json` of every BDOBB example from v3 up to its own version, and has from v3 on: openbq-docker v3 serves Built-in widgets, Demo providers and Video Library, its API carrying the `openbb-videos` and EconDB extensions those need, and each later release adds its own version's examples. Both the base compose and the Episode 3 overlay serve them. Built-in widgets, V4 core tools and Parameters hold only built-ins, so they need no data from a backend; the others read widgets the stack serves.

The file names `v3.1.0-*` and `v3.2.0-*` record the BDOBB sub-release that introduced each of those examples; they are not renamed.

## How they get there

The source of every example is `docs/examples` in the `BDOBB` repository, one `*.apps.json` file per version line, and `src/lib/appsJson.examples.test.ts` parses and imports each one exactly as opening it would, so a broken example fails BDOBB's own gate. `pnpm apps:sync` writes them all into openbq-docker's one combined file, `examples/bdobb/apps.json`; on this line the command is `EPISODE=4 pnpm apps:sync`, which keeps the examples of episodes up to 4. Every example under `docs/examples` must be listed in the script's `SERVED` table, and a file it cannot route fails the sync rather than being skipped. The diff is committed in openbq-docker: its image bakes the file in, and the stack's lanes hook appends it to the API's `/apps.json`.

Each example card carries the BDOBB logo. Its image address is `/openbq/bdobb-logo.svg` on the same backend, which openbq-docker's lanes hook serves without Basic auth, because BDOBB shows only http(s) card images and an image request carries no credential.

## Built-in widgets

One dashboard, six tabs: **Note**, **Markdown**, **Clock** (shown in both the vertical and horizontal layouts), **Website** (framing the OpenBB Workspace docs), **RSS** (a public business-news feed), and **Grouping** — two **Parameter echo** cards sharing one Ticker group, so the chain-link, the numbered badge and the Groups menu are all visible on the same tab without touching a real backend. Every card on this dashboard is a built-in (see [[built-in-widgets|Built-in Widgets]]); none needs data from a backend at all.

## Demo providers

One dashboard, one card per OpenBB provider that answers on openbq-docker v3 with no sign-up of your own, and a seventh card, the Video Library (see below):

| Provider | Key | What the card shows |
|---|---|---|
| EIA | public demo key | Short-Term Energy Outlook (`eia_short_term_energy_outlook_eia_obb`) |
| Congress.gov | public demo key | Congressional bills of the 119th Congress |
| BLS | none | A named economic series (`CUUR0000SA0`, CPI-U), through BLS search |
| CFTC | none | Commitment of Traders |
| EconDB | none | An economic indicator (real GDP) |
| Nasdaq | none | Historical EPS for `IBM` (`nasdaq_equity_fundamental_historical_eps_nasdaq_obb`). Earlier releases used Alpha Vantage here, whose demo key answers only its own example calls; Nasdaq needs no key at all |

The two demo keys come from openbq-docker's committed `credentials.demo.env`, which holds those two providers' own public demo keys; Compose loads it before `credentials.env`, so your own keys there override them. The demo keys are rate-limited (api.data.gov's `DEMO_KEY` allows 30 requests an hour and 50 a day per IP address). Nothing here is app state, and BDOBB itself carries no provider keys; its Provider API Keys panel only reads and writes the stack's (see [[provider-keys|Provider Keys]]). The full survey of which providers answer keyless and why is in the reference-validation testing notes the app repository carries alongside the reference backend.

## OpenBB Workspace dashboards

Three dashboards from OpenBB Workspace's own gallery, each re-keyed to the widget ids openbq-docker serves. Its API runs openbb-core 2, which names a provider's widgets under that provider (`bls_search_bls_obb`), so a card saved under OpenBB Platform 4's shared routers (`economy_survey_bls_search_bls_obb`) would import as unresolved. All three use providers that need no key.

| Dashboard | Cards |
|---|---|
| **OpenBB Workspace - CFTC Commitment of Traders** | Stock-index futures from the COT search, beside 52 weeks of changes in one market's legacy futures positions |
| **OpenBB Workspace - BLS** | BLS search over the nonfarm-payrolls survey, beside one series (`CES0000000001`, total nonfarm employment) since 2016 |
| **OpenBB Workspace - IMF Explorer** | Three tabs: available indicators and indicator data, direction of trade, and PortWatch chokepoint and port volumes, with port information |

OpenBB Workspace's IMF Explorer had two more tabs, built on OpenBB-hosted widgets (`imf_utils_*`) that openbq-docker does not serve; those are left out. Its chokepoint-volume card is a server-side table (`ssrm_table`), which BDOBB draws from 4.0.0; on 3.0.0 the dashboard ships without it. Workspace's own tab strip (`navigation_bar`) is not carried over either, since BDOBB draws its own tabs.

## Video Library

The third example holds one **YouTube** card, the Video Library: pick one of two sample videos and the card plays it. The same card is the seventh on the Demo providers dashboard. The widget (`videos_video_custom_obb`) is served by openbb-api itself, from the `openbb-videos` extension that openbq-docker serves from v3 on, and needs no key; its endpoint answers a bare watch URL and the card frames it. A stack whose openbb-api does not carry that extension has no such widget, and an imported card then reads *Widget videos_video_custom_obb is not on any connected backend.*

In the desktop app the card frames a small page the app serves itself on `127.0.0.1`, which embeds the video; YouTube refuses an embed framed straight from the app's own pages. The web preview frames `youtube.com` directly.

## V4 core tools

The Built-in widgets tabs, plus two for this version's parameter work: **Date expression**, a set of **Date expression** cards showing `T`, `T-5bd`, `T-1m`, `M-1`, `FQ-4` and `Y-1` resolving against the `XNYS` calendar (see [[date-expression|The Date Expression Card]]), and **Period controls**, a **Period echo** card. No credentials are needed.

## Parameters

The v4 parameter features on their own tabs: **Groups** (one value propagated to many cards), **Period pickers** (day, week, month, quarter, fiscal year, date-time and time) and **Dynamic expressions** (relative dates). See [[card-parameters|Card Parameters]].

---
*Source: BDOBB `docs/examples/v3.1.0-builtins.apps.json`, `docs/examples/v3.1.0-demo-providers.apps.json` and `docs/examples/v3.2.0-video-library.apps.json`, `docs/examples/v3.1.0-openbb-workspace.apps.json` (from bdobb-dev/bdobb-v2 `docs/examples/openbb-workspace/` on `main`), `scripts/apps-sync.mjs` and `package.json` (`openbqDocker`) at 4.0.0; the user's pairing rulings of 2026-10-14 (the combined file from v3 on, openbq-docker v3's `openbb-videos` and EconDB extensions, `credentials.demo.env`, the logo route); BDOBB `docs/examples/v4.0.0-builtins.apps.json` and `docs/examples/v4.0.0-parameters.apps.json` at `v4.0.0`; `BDOBB` `src/lib/appsJson.examples.test.ts`; `openbq-docker` `examples/bdobb/README.md`, `examples/bdobb/apps.json`, `Dockerfile` (stages `api` and `v3`).*
*See also: [[importing-dashboards|Importing Dashboards]] · [[built-in-widgets|Built-in Widgets]] · [[card-parameters|Card Parameters]] · [[reference-validation|Reference Validation]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v4.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
