---
type: Note
tags: [bdobb, help, about, sources, provenance, versions]
---

# About This Guide

This guide documents clean BDOBB **v4.0.0** for Episode 4. It builds on the v3 reference desktop with analytical tables, reusable version-pinned Statement templates, date expressions and exchange calendars, Calendar presentation, improved library and key controls, and docked parameter panels. Historical source-version citations identify donors; they do not name this release.

Cron scheduling is not supported. BDOBB Workspace saves preserve validated analytical definitions and Statement snapshots; unknown or malformed extensions are refused before import writes anything. Exact source commits and validation receipts are recorded in `docs/releases/provenance.md` and the v4 integration ledger.

## Three sources, in order of authority

1. **The in-app manual.** BDOBB carries its own written manual — one CommonMark file per topic under `src/help/topics/`, opened with `⌘?` as **Quick Help** — and a branch that changes behaviour edits its topic in the same commit and the same review. That is the only mechanism that keeps a manual honest, and it makes those files the authority for what the app does. Every Interface, Widgets and Configuration page in this guide is built on them, expanded with the context and the *why* the terse in-app form leaves out. Where two topics disagree, the code decides, and the page says so.
2. **The rebuild documents and design records.** `docs/specs/` in the `BDOBB` repository is the set of documents the app was rebuilt from — inherited from the maintained baseline, carrying `> Superseded …` notes wherever the rebuild diverged from the original — plus the design and verification records under `docs/superpowers/`. These supply the design intent, the gotchas, and everything about the companion services the app talks to. The clean release includes functional Apps discovery and dark/light themes; the current code and its tests decide where historical design records disagree.
3. **The companion repositories themselves.** `openbq-docker`'s README, compose files (the base file and the Episode 3 overlay), Dockerfiles and Serve configurations for the stack; the `key-maint` README for its service. Read for their interfaces, as the app was.

The *Adventures in OpenBQ* article series is the narrative behind all of it and is cited on each page for the reader who wants the story; it is not a source of fact where it and the shipped code disagree.

## This guide ships inside the app

The app bundles this guide as the **Reference Manual**, beside **Quick Help** on the rail's Help menu. The files are committed with the app, so the manual works without a network connection. Its sections and order come from `home.md`; screenshots use the same themed assets as Quick Help. Both are updated for the same release.

That arrangement is also why the rule about which source wins matters more than it used to: where this guide and the in-app manual disagree, a reader can now see both in the same dialog.

## Page by page

| Section | Built from |
|---|---|
| Getting Started | the in-app "Getting started" and "Connections" topics; the repository's `package.json`, `src-tauri/tauri.conf.json` and `.github/workflows/ci.yml` |
| Interface | the in-app "The left rail", "Dashboards and folders", "Dashboard tabs", "The widget library", "Widget cards", "Card parameters", "Running and refreshing" and "Keyboard shortcuts" topics; `GroupLink.tsx` and `src/lib/paramGroups.ts` |
| Widgets | the in-app "Tables", "Charts", "Built-in widgets", "Documents, PDFs and files" and "HTML and iframe widgets" topics |
| Configuration | the in-app "Settings and logs", "Provider keys", "Import and export" and "Troubleshooting" topics; `src/lib/settingsBundle.ts` and `src/lib/jsonStore.ts`; `key-maint/README.md`; the stack's Serve configuration |
| Integrations | `openbq-docker`'s README, compose files, Dockerfiles and Serve configurations; `web/` and `openbq-docker`'s `funnel-gateway/` for the web preview |
| Troubleshooting | the in-app "Troubleshooting" topic and the Gotchas section of the v3.0.0 rebuild document; `openbq-docker`'s README and `VERIFICATION.md` |
| Testing | `docs/test-environment.md`, `scripts/reference-backend.sh`, `src/test/integration/reference-backend.test.ts` and `docs/examples/*.apps.json` |

## Episodes, for the narrative

| Episode | Title | Feeds into |
|---|---|---|
| 1 | Your Own Bloomberg in a Cabinet | [[openbq-docker-stack\|The openbq-docker Stack]], [[tailscale-networking\|Tailscale Networking]] |
| 2 | The Borrowed Terminal | [[backends-and-connections\|Backends and Connections]] |
| 3 | Kick the Tires on a Reference Build | [[layout-and-navigation\|Layout and Navigation]], [[provider-keys\|Provider Keys]] |

Episode 3 established the reference baseline; Episode 4 is the release boundary for this version. The reference backend is qualified independently; its exact source and image are recorded in the release provenance.

## What changed from the original guide

Readers of the original *BDOBB Help* will find these differences, all of them because the app changed:

- **There is no news wire.** The original's news wire, and its *Secrets and Access* page for the wire's keys, have no pages here: BDOBB has no news wire at this version, and the stack it pairs with runs no feed server. The one feed widget is the RSS feed built-in, which reads a single feed directly. See [[built-in-widgets|Built-in Widgets]].
- **The original's planned real-time chart and ArcticDB explorer have no pages here**, because neither exists at this version — not in the app, and not in the stack it pairs with.
- **There is no AI side at this version.** The original's AI chat pane has no page here: BDOBB at this version has no chat pane, no agent client and no MCP client, and the stack it pairs with runs no MCP server.
- **The Markdown editor is new**, and so are the RSS feed built-in, the transposed view, run-button widgets, viewer windows, and everything under [[import-and-export|Import and Export]] — including the settings bundle that carries your preferences and folder tree between machines, which the original had no equivalent of. See [[settings-export-and-import|Settings Export and Import]].

## Screenshots

Screenshots come from the running app in both themes. Quick Help and this searchable guide share the themed image assets, so Calendar controls and Statement previews match the interfaces described here. Pages about backend services and deployment use text where an app screenshot would not explain their behavior.

## How this vault is versioned

The current guide is bundled with this release under `src/help/guide/`, alongside Quick Help under `src/help/topics/`. Release history preserves earlier snapshots. Historical donor citations remain as attribution and context; current code, documentation and validation evidence define clean v4 behavior.

---
*Updated for clean BDOBB v4.0.0 from the BDOBB v3.3.3 guide. Historical citations retain source provenance.*
