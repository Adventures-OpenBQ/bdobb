---
type: Note
tags: [bdobb, help, examples, apps-json, demo-providers]
---

# Example Dashboards

From v3.1.0, two example dashboards ship with the `openbb-docker` stack (a third, the Video Library, from v3.2.1) — the built-in widgets, and every OpenBB provider that answers with a demo key or no key at all. Each is an ordinary `apps.json` file (see [[importing-dashboards|Importing Dashboards]]), served by openbb-api the same way any backend serves an `apps.json`, and each opens with nothing entered: no key, no sign-up, no configuration.

## How they get there

The source of every example is `docs/examples/*.apps.json` in the `BDOBB` repository, one file per version line. `pnpm apps:sync` reads each file, checks it against `OWNER` (a table naming which backend's `apps.json` carries it — an unowned example fails the sync, since a file nobody serves is a promise nobody sees), and writes it into the matching file in an `openbb-docker` checkout. That write is committed in `openbb-docker`, so it ships with the stack's own next release; `src/lib/appsJson.examples.test.ts` in `BDOBB` parses and imports every example exactly as opening it would, so a broken example fails the gate before it ships.

## Built-in widgets

One dashboard, six tabs: **Note**, **Markdown**, **Clock** (shown in both the vertical and horizontal layouts), **Website** (framing the OpenBB Workspace docs), **RSS** (a public business-news feed), and **Grouping** — two **Parameter echo** cards sharing one Ticker group, so the chain-link, the numbered badge and the Groups menu are all visible on the same tab without touching a real backend. Every card on this dashboard is a built-in (see [[built-in-widgets|Built-in Widgets]]); none needs a connection at all.

## Demo providers

One dashboard, one card per OpenBB provider that works with no sign-up on the `openbb-docker` v3.0.1 image, and from v3.2.1 a seventh card, the Video Library (see below):

| Provider | What the card shows |
|---|---|
| EIA | Short Term Energy Outlook — no key needed at all |
| Congress.gov | Congressional bills |
| BLS | A named economic series (`CUUR0000SA0`, CPI-U) |
| CFTC | Commitment of Traders |
| EconDB | An economic indicator |
| Alpha Vantage | Historical EPS for `IBM` — the provider's demo key answers only its own documented example calls, so `IBM` is the one symbol this card can use; the point is that the call goes through and the table renders |

Each of these rides on a demo or empty key the stack's `credentials.env.example` ships with — nothing here is app state, and BDOBB itself carries no provider keys; its Provider API Keys panel only reads and writes the stack's (see [[provider-keys|Provider Keys]]). The full survey of which providers answer keyless and why is in the reference-validation testing notes the app repository carries alongside the reference backend.

## Video Library

From v3.2.1, a third example holds one **YouTube** card, the Video Library: pick one of two sample videos and the card plays it. The same card is the seventh on the Demo providers dashboard. The widget (`videos_video_custom_obb`) is served by openbb-api itself, from the `openbb-videos` extension, and needs no key; its endpoint answers a bare watch URL and the card frames it. A stack whose openbb-api does not carry that extension has no such widget, and an imported card then reads *Widget videos_video_custom_obb is not on any connected backend.*

In the desktop app the card frames a small page the app serves itself on `127.0.0.1`, which embeds the video; YouTube refuses an embed framed straight from the app's own pages. The web preview frames `youtube.com` directly.

*Source: BDOBB v3.1.0 `docs/examples/v3.1.0-builtins.apps.json` and `docs/examples/v3.1.0-demo-providers.apps.json`; `BDOBB` `scripts/apps-sync.mjs` at `v3.1.0`; `docs/examples/v3.2.0-video-library.apps.json`, `src-tauri/src/video_wrapper.rs`, `src/lib/youtube.ts` and `web/server.mjs` at `v3.2.1`.*
*See also: [[importing-dashboards|Importing Dashboards]] · [[built-in-widgets|Built-in Widgets]] · [[card-parameters|Card Parameters]] · [[reference-validation|Reference Validation]] · [[provider-keys|Provider Keys]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
