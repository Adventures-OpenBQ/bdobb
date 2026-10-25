---
type: Note
tags: [bdobb, help, examples, apps-json]
---

# Example Dashboards

The openbq-docker API serves eleven example dashboards on its own `/apps.json`, next to its provider apps. Eight are BDOBB's own: **Built-in widgets**, **Demo providers**, **Video Library**, **V4 core tools**, **Parameters**, **V5 Statement Example**, *Example Dashboard - Version 5.0.0 - Treasury Auctions* and *Example Dashboard - Version 6.0.0*. Each is an ordinary `apps.json` entry (see [[importing-dashboards|Importing Dashboards]]) that you open from the rail's **Apps** list like any other backend-served app. Each opens with nothing entered: no key, no sign-up, no configuration. The other three are OpenBB Workspace's own dashboards (CFTC Commitment of Traders, BLS and IMF Explorer), rebuilt for this stack (see **OpenBB Workspace dashboards** below).

BDOBB 6.0.0 pairs with **openbq-docker v6** (Adventures-OpenBQ/openbq-docker, tag `v6.0.0`; see [[openbq-docker-stack|The openbq-docker Stack]]). Every openbq-docker release serves one combined `apps.json` of every BDOBB example from v3 up to its own version, and has from v3 on: openbq-docker v3 serves Built-in widgets, Demo providers and Video Library, its API carrying the `openbb-videos` and EconDB extensions those need. Both the base compose and the Episode 3 overlay serve them. Built-in widgets, V4 core tools, Parameters and the 6.0.0 example hold only built-ins, so they need no data from a backend; the others read widgets the stack serves.

The file names `v3.1.0-*` and `v3.2.0-*` record the BDOBB sub-release that introduced each of those examples; they are not renamed.

## How they get there

The source of every example is `docs/examples` in the `BDOBB` repository, one `*.apps.json` file per version line (and `v5-financial-demo/apps.json`, with its fixture beside it), and `src/lib/appsJson.examples.test.ts` parses and imports each one exactly as opening it would, so a broken example fails BDOBB's own gate. `pnpm apps:sync` writes them all into openbq-docker's one combined file, `examples/bdobb/apps.json`; on this line the command is `EPISODE=6 pnpm apps:sync`, which keeps the examples of episodes up to 6. Every example under `docs/examples` must be listed in the script's `SERVED` table, and a file it cannot route fails the sync rather than being skipped. The diff is committed in openbq-docker: its image bakes the file in, and the stack's lanes hook appends it to the API's `/apps.json`.

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

## V5 Statement Example

A synthetic cash-flow statement for trying the **Statement** view with no provider key. One dashboard, one tab, **Cash flow**, holding one card on the `synthetic_cash_flow` widget opened in the Statement view: fiscal 2026 Q3 and TTM operating cash flow (12 and 33) and capital expenditure (−5 and −18). The values are made up; they are not investment data. openbq-docker serves the fixture widget under the same id from v5 on, so the card opens from the API's apps list. It ships as `docs/examples/v5-financial-demo/apps.json`, with the fixture beside it (`widgets.json`, `cash-flow.json`) and a README that serves the fixture locally for a check without the stack. The Statement view travels in BDOBB's v5 extension, so it opens in BDOBB 5.0.0 or later. See [[statement-view|Statement View]].

## Version 5.0.0 — Treasury auctions

Episode 5's example uses the **Calendar** view (from v4): a table whose rows carry a date can be drawn as a calendar grid instead of rows and columns. The dashboard, *Example Dashboard - Version 5.0.0 - Treasury Auctions*, has two cards, each opened in the Calendar view on a month grid, with one event per auction on its `auction_date`, titled by `security_term` (for example *17-Week*) and grouped by `security_type` (Bill, Note, Bond):

| Card | What it shows |
|---|---|
| Upcoming Treasury auctions | The auctions the Treasury has announced but not yet held |
| Treasury auction results, last six weeks | Held auctions from `T-6w` to `T` — a relative start date, so the window moves with every render instead of freezing on the day the dashboard was built |

Both widgets (`ustreasury_upcoming_auctions_us_treasury_obb` and `ustreasury_auction_results_us_treasury_obb`) are served by the API itself, from the `openbb-government-us` extension openbq-docker's base image installs, and need no API key. The file is `docs/examples/v5.0.0-treasury-calendar.apps.json`.

## Example Dashboard - Version 6.0.0

Rita's stage, and the one example whose name is its version rather than its subject. One dashboard, one tab, three built-in cards: a **Markdown** card explaining what to ask for, a **Clock** on New York, London and Tokyo, and a **Note** to scratch in. Nothing needs a backend or a key — the point is Rita working the board rather than the data.

It ships as `docs/examples/v6.0.0-rita.apps.json`, an ordinary `apps.json` (see [[importing-dashboards|Importing Dashboards]]), and uses built-ins only: open it from the API's apps list, or import it from the file.

Set the **Rita URL** and turn **Context sharing** on in **AI Library ▸ Agents** first, or Rita sees no cards at all (see [[rita-chat|Rita (AI Chat)]] and [[rita-ai-agent-setup|Setting Up the Rita AI Agent]]). Everything the Markdown card invites works: adding a note, renaming the dashboard or a card, moving the clock, adding a tab, and finding a widget that is on no board yet. The **build-dashboard** skill is what tells Rita to do the work herself rather than sending you to add a widget by hand.

---
*Source: BDOBB `docs/examples/v3.1.0-builtins.apps.json`, `docs/examples/v3.1.0-demo-providers.apps.json` and `docs/examples/v3.2.0-video-library.apps.json`, `docs/examples/v3.1.0-openbb-workspace.apps.json` (from bdobb-dev/bdobb-v2 `docs/examples/openbb-workspace/` on `main`), `scripts/apps-sync.mjs` and `package.json` (`openbqDocker`) at 6.0.0; `docs/examples/v5-financial-demo/` at 5.0.0; the user's pairing rulings of 2026-10-14 (the combined file from v3 on, openbq-docker v3's `openbb-videos` and EconDB extensions, `credentials.demo.env`, the logo route); BDOBB `docs/examples/v4.0.0-builtins.apps.json`, `docs/examples/v4.0.0-parameters.apps.json` `docs/examples/v5.0.0-treasury-calendar.apps.json` and `docs/examples/v6.0.0-rita.apps.json` at `v6.0.0`; `BDOBB` `src/lib/appsJson.examples.test.ts`; `openbq-docker` `requirements.in` at `v6.0.0`; `examples/bdobb/README.md`, `examples/bdobb/apps.json`, `Dockerfile` (stages `api` and `v3`).*
*See also: [[importing-dashboards|Importing Dashboards]] · [[built-in-widgets|Built-in Widgets]] · [[rita-chat|Rita (AI Chat)]] · [[card-parameters|Card Parameters]] · [[calendar-view|Calendar View]] · [[reference-validation|Reference Validation]]*
