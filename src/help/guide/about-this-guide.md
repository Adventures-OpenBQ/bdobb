---
type: Note
tags: [bdobb, help, about, sources, provenance, versions]
---

# About This Guide

This guide documents clean BDOBB **v8.0.0**, which builds on the Episode 5 line. It builds on the v3 reference desktop with analytical tables, reusable version-pinned Statement templates, date expressions and exchange calendars, Calendar presentation, improved library and key controls, and docked parameter panels. Version 6.0.0 adds the Rita agent, MCP servers and the AI Library; their pages are under *Rita and AI*. Version 7.0.0 adds the iPad, under *iPad*. Version 8.0.0 adds the News wire, pinned cards and locked widgets, under *Widgets*, and pairs with openbq-docker v8, under *Integrations*. Historical source-version citations identify donors; they do not name this release.

V5 adds Workspace layouts and generic Statement presentation to the inherited v4 analytical core. Cron scheduling is not supported. BDOBB Workspace saves preserve validated analytical definitions, Statement snapshots and the v5 presentation; unknown or malformed extensions are refused before import writes anything; from 8.0.0, v8 card data a version cannot read is skipped instead, and the import notice names what was left off. Exact source commits and validation receipts are recorded in `docs/releases/provenance.md` and the v4 integration ledger.

## Three sources, in order of authority

1. **The in-app manual.** BDOBB carries its own written manual — one CommonMark file per topic under `src/help/topics/`, opened with `⌘?` as **Quick Help** — and a branch that changes behaviour edits its topic in the same commit and the same review. That is the only mechanism that keeps a manual honest, and it makes those files the authority for what the app does. Every Interface, Widgets and Configuration page in this guide is built on them, expanded with the context and the *why* the terse in-app form leaves out. Where two topics disagree, the code decides, and the page says so.
2. **The rebuild documents and design records.** `docs/specs/` in the `BDOBB` repository is the set of documents the app was rebuilt from — inherited from the maintained baseline, carrying `> Superseded …` notes wherever the rebuild diverged from the original — plus the design and verification records under `docs/superpowers/`. These supply the design intent, the gotchas, and everything about the companion services the app talks to. The clean release includes functional Apps discovery and dark/light themes; the current code and its tests decide where historical design records disagree.
3. **The companion repositories themselves.** `openbq-docker`'s README, compose files (the base file, the Episode 3 overlay and the Episode 6 overlay), Dockerfiles and Serve configurations for the stack, and at v8 its `funnel-gateway/README.md` for the `web` profile and `docs/v8/news-relay-and-hidden-dashboards.md` for the News relay and the hidden docks route; the `key-maint` README for its service; `Adventures-OpenBQ/agent-rita-bdobb` for the Rita image (the MCP image is built from openbq-docker's own `mcp/`). Read for their interfaces, as the app was. The web preview's route rules are not written here at all: `web/policy.mjs` is openbq-docker's `funnel-gateway/policy.mjs`, vendored verbatim by `scripts/gateway-vendor.mjs` from an openbq-docker checkout (`OPENBQ_DOCKER_DIR`) and pinned in `web/policy.vendored.json`.

The *Adventures in OpenBQ* article series is the narrative behind all of it and is cited on each page for the reader who wants the story; it is not a source of fact where it and the shipped code disagree.

## This guide ships inside the app

The app bundles this guide as the **Reference Manual**, beside **Quick Help** on the rail's Help menu. The files are committed with the app, so the manual works without a network connection. Its sections and order come from `home.md`; screenshots use the same themed assets as Quick Help. Both are updated for the same release.

That arrangement is also why the rule about which source wins matters more than it used to: where this guide and the in-app manual disagree, a reader can now see both in the same dialog.

## Page by page

| Section | Built from |
|---|---|
| Getting Started | the in-app "Getting started" and "Connections" topics; the repository's `package.json`, `src-tauri/tauri.conf.json` and `.github/workflows/ci.yml` |
| Interface | the in-app "The left rail", "Dashboards and folders", "Dashboard tabs", "The widget library", "Widget cards", "Pinned cards", "Locked widgets", "Card parameters", "Running and refreshing" and "Keyboard shortcuts" topics; `GroupLink.tsx` and `src/lib/paramGroups.ts` |
| Widgets | the in-app "Tables", "Charts", "Built-in widgets", "News", "Pinned cards", "Locked widgets", "Documents, PDFs and files" and "HTML and iframe widgets" topics |
| Configuration | the in-app "Settings and logs", "Provider keys", "Import and export" and "Troubleshooting" topics; `src/lib/settingsBundle.ts` and `src/lib/jsonStore.ts`; `key-maint/README.md`; the stack's Serve configuration |
| Rita and AI | the in-app "Rita" and "AI Library" topics; the v6 client design and the Rita table-model design under `docs/superpowers/specs/`; `src/lib/agent/` (`localTools.ts`, `tableModel/`, `execute.ts`, `query.ts`, `mcp.ts`, `proxiedTools.ts`), `src/components/ai/`, `src/components/rita/` and `src/stores/chatStore.ts` |
| Integrations | `openbq-docker`'s README, compose files, Dockerfiles and Serve configurations, and at v8 `ts-config/serve-funnel.json` and `funnel-gateway/README.md`; `web/`, `vercel.json`, `scripts/gateway-vendor.mjs` and `web/policy.vendored.json` for the web preview |
| Troubleshooting | the in-app "Troubleshooting" topic and the Gotchas section of the v3.0.0 rebuild document; `openbq-docker`'s README and `VERIFICATION.md` |
| Testing | `docs/test-environment.md`, `scripts/reference-backend.sh`, `src/test/integration/reference-backend.test.ts` and `docs/examples/*.apps.json` |

## Episodes, for the narrative

| Episode | Title | Feeds into |
|---|---|---|
| 1 | Your Own Bloomberg in a Cabinet | [[openbq-docker-stack\|The openbq-docker Stack]], [[tailscale-networking\|Tailscale Networking]] |
| 2 | The Borrowed Terminal | [[backends-and-connections\|Backends and Connections]] |
| 3 | Kick the Tires on a Reference Build | [[layout-and-navigation\|Layout and Navigation]], [[provider-keys\|Provider Keys]] |

Episode 3 established the reference baseline and Episode 4 the analytical core; Episode 5 is the release boundary for this version. The reference backend is qualified independently; its exact source and image are recorded in the release provenance.

## What changed from the original guide

Readers of the original *BDOBB Help* will find these differences, all of them because the app changed:

- **The news wire is back, rebuilt.** From 8.0.0 the **News** built-in is a headline wire fed by an rss-ticker server, openbq-docker's `rss-ticker` service (part of its `web` profile, and started on its own for a desktop card); the card owns its feed list, and the server holds no keys, so the original's *Secrets and Access* page for the wire's keys still has no counterpart. The web preview relays the wire for approved feeds only. See [[news-widget|The News Widget]]. The plain RSS feed built-in still reads a single feed directly.
- **Pinned cards and locked widgets are new** in 8.0.0: a card pinned to an edge of its tab, and widgets locked along an edge of every dashboard, which sync to a Workspace server as one hidden record. See [[locked-and-pinned-widgets|Locked and Pinned Widgets]].
- **The original's planned real-time chart and ArcticDB explorer have no pages here**, because neither exists at this version — not in the app, and not in the stack it pairs with.
- **The AI side is new here.** The original's AI chat pane has pages again, rewritten for the OpenBQ Rita and MCP services: [[rita-chat|Rita (AI Chat)]], [[ai-library|The AI Library]] and [[rita-ai-agent-setup|Setting Up the Rita AI Agent]]. Rita and the MCP server are off until you set their URLs, and Rita's table tools work on CSV/XLS, managed server and linked tables only.
- **The Markdown editor is new**, and so are the RSS feed built-in, the transposed view, run-button widgets, viewer windows, and everything under [[import-and-export|Import and Export]] — including the settings bundle that carries your preferences and folder tree between machines, which the original had no equivalent of. See [[settings-export-and-import|Settings Export and Import]].

## Screenshots

Screenshots come from the running app in both themes. Quick Help and this searchable guide share the themed image assets, so Calendar controls and Statement previews match the interfaces described here. Pages about backend services and deployment use text where an app screenshot would not explain their behavior.

## How this vault is versioned

The current guide is bundled with this release under `src/help/guide/`, alongside Quick Help under `src/help/topics/`. Release history preserves earlier snapshots. Historical donor citations remain as attribution and context; current code, documentation and validation evidence define clean v5 behavior.

---
*Updated for clean BDOBB v8.0.0 from the BDOBB v3.3.3 guide. Historical citations retain source provenance.*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
