---
type: Note
tags: [bdobb, help, examples, apps-json, demo-providers]
---

# Example Dashboards

Three example dashboards ship with BDOBB 3.0.0: **Built-in widgets**, **Demo providers** and **Video Library** — the built-in widgets, OpenBB providers that answer with a public demo key or no key at all, and a YouTube card. Each is an ordinary `apps.json` entry (see [[importing-dashboards|Importing Dashboards]]) that you open from the rail's **Apps** list like any other backend-served app, and each opens with nothing entered: no key of your own, no sign-up, no configuration.

BDOBB 3.0.0 pairs with **openbq-docker v3.0.0** (see [[openbq-docker-stack|The openbq-docker Stack]]). Every openbq-docker release serves one combined `apps.json` of every BDOBB example from v3 up to its own version, appended to its API's `/apps.json`, and at v3 that includes all three: the stack's API carries the `openbb-videos` extension the Video Library needs and the EconDB extension behind the Demo providers' EconDB card. The base compose serves them; the Episode 3 overlay is not needed.

## How they get there

The source of every example is `docs/examples/*.apps.json` in the `BDOBB` repository, and `src/lib/appsJson.examples.test.ts` parses and imports each one exactly as opening it would, so a broken example fails BDOBB's own gate. `pnpm apps:sync` writes them all into openbq-docker's one combined file, `examples/bdobb/apps.json`; on this line the command is `EPISODE=3 pnpm apps:sync`, which keeps the examples of episodes up to 3. Every example under `docs/examples` must be listed in the script's `SERVED` table, and a file it cannot route fails the sync rather than being skipped. The result is committed in openbq-docker, whose image bakes the file in. The file names, `v3.1.0-*` and `v3.2.0-*`, record the sub-release that first introduced each example; they are kept, and the examples open in BDOBB 3.0.0.

Each example card carries the BDOBB logo. Its image address is `/openbq/bdobb-logo.svg` on the same backend, which openbq-docker serves without Basic auth, because an image request carries no credential.

## Built-in widgets

One dashboard, six tabs: **Note**, **Markdown**, **Clock** (shown in both the vertical and horizontal layouts), **Website** (framing the OpenBB Workspace docs), **RSS** (a public business-news feed), and **Grouping** — two **Parameter echo** cards sharing one Ticker group, so the chain-link, the numbered badge and the Groups menu are all visible on the same tab without touching a real backend. Every card on this dashboard is a built-in (see [[built-in-widgets|Built-in Widgets]]); none needs a connection at all.

## Demo providers

One dashboard, one card per OpenBB provider that answers on openbq-docker v3 with no sign-up of your own, and a seventh card, the Video Library (see below):

| Provider | Key | What the card shows |
|---|---|---|
| EIA | public demo key | Short-Term Energy Outlook |
| Congress.gov | none (bulk data) | Bills of the 119th Congress |
| BLS | none | A named economic series (`CUUR0000SA0`, CPI-U), through BLS search |
| CFTC | none | Commitment of Traders for market code `067651` (WTI crude oil) since 2025-01-01 |
| EconDB | temporary token | Real GDP for the US; EconDB's service may refuse the temporary token, in which case supply your own EconDB key or skip the card |
| Nasdaq | none | Historical EPS for `IBM` |

The demo key comes from openbq-docker's committed `credentials.demo.env`: api.data.gov's public `DEMO_KEY`, for EIA and Congress.gov, rate-limited to 30 requests an hour and 50 a day per address. Your own keys in `credentials.env` override it. Nothing here is app state, and BDOBB itself carries no provider keys; its Provider API Keys panel only reads and writes the stack's (see [[provider-keys|Provider Keys]]).

## Video Library

The third example holds one **YouTube** card, the Video Library: pick one of two sample videos and the card plays it. The same card is the seventh on the Demo providers dashboard. The widget (`videos_video_custom_obb`) is served by the API itself, from the `openbb-videos` extension, and needs no key; its endpoint answers a bare watch URL and the card frames it. A backend without that extension has no such widget, and an imported card then reads *Widget videos_video_custom_obb is not on any connected backend.*

In the desktop app the card frames a small page the app serves itself on `127.0.0.1`, which embeds the video; YouTube refuses an embed framed straight from the app's own pages. The web preview frames `youtube.com` directly.

*Source: BDOBB `docs/examples/v3.1.0-builtins.apps.json`, `docs/examples/v3.1.0-demo-providers.apps.json`, `docs/examples/v3.2.0-video-library.apps.json`, `scripts/apps-sync.mjs`, `src/lib/appsJson.examples.test.ts`, `src-tauri/src/video_wrapper.rs`, `src/lib/youtube.ts` and `package.json` (`openbqDocker`) at 3.0.0; `openbq-docker` `examples/bdobb/README.md`, `examples/bdobb/apps.json`, `credentials.demo.env`, `Dockerfile` and `lanes/openbq_lanes.py` at `v3.0.0`.*
*See also: [[importing-dashboards|Importing Dashboards]] · [[built-in-widgets|Built-in Widgets]] · [[card-parameters|Card Parameters]] · [[reference-validation|Reference Validation]] · [[provider-keys|Provider Keys]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
