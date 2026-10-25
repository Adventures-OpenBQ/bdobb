---
type: Note
tags: [bdobb, help, about, sources, provenance, versions]
---

# About This Guide

This guide documents the fresh BDOBB **v3.0.0** release for Episode 3, “Kick the Tires.” Its reference desktop includes backend-served Apps, parameter groups, Run and numeric refresh, ordinary tables and charts, and compatible import/export. The source baseline is maintained BDOBB v3.3.3, with selected Apps and ordinary-state export fixes carried into the clean release. Historical source-version citations below identify donors; they do not name this release.

The analytical Pivot model belongs to v4. Workspaces and Statement belong to v5. Cron scheduling is deferred. Unsupported analytical extensions are refused before import writes anything. Exact source commits and reference-test receipts are recorded in `docs/releases/provenance.md`.

## Three sources, in order of authority

1. **The in-app manual.** BDOBB carries its own written manual — one CommonMark file per topic under `src/help/topics/`, opened with `⌘?` as **Quick Help** — and a branch that changes behaviour edits its topic in the same commit and the same review. That is the only mechanism that keeps a manual honest, and it makes those files the authority for what the app does. Every Interface, Widgets and Configuration page in this guide is built on them, expanded with the context and the *why* the terse in-app form leaves out. Where two topics disagree, the code decides, and the page says so.
2. **The rebuild documents and design records.** `docs/specs/` in the `BDOBB` repository is the set of documents the app was rebuilt from — at this version the `v3.0.0` full baseline alone, carrying `> Superseded …` notes wherever the rebuild diverged from the original — plus the design and verification records under `docs/superpowers/`. These supply the design intent, the gotchas, and everything about the companion services the app talks to. The clean release includes functional Apps discovery and dark/light themes; the current code and its tests decide where historical design records disagree.
3. **The companion repositories themselves.** `openbb-docker`'s README, compose file, Dockerfile, Serve configuration and `docs/funnel.md` for the stack; the `key-maint` README for its service. Read for their interfaces, as the app was.

The *Adventures in OpenBB* article series is the narrative behind all of it and is cited on each page for the reader who wants the story; it is not a source of fact where it and the shipped code disagree.

## This guide ships inside the app

From this version the app carries this snapshot with it. The pages you are reading are copied verbatim into `BDOBB` and opened from the rail's Help menu as the **Reference Manual**, beside **Quick Help** — the in-app manual above. The copy is committed rather than fetched, so it is there with no network; its sections and their order are read from this page's sibling, `home.md`, which is why every page here must be listed there; and its screenshots are the in-app manual's own themed shots rather than second copies. The two are refreshed together, once per release.

That arrangement is also why the rule about which source wins matters more than it used to: where this guide and the in-app manual disagree, a reader can now see both in the same dialog.

## Page by page

| Section | Built from |
|---|---|
| Getting Started | the in-app "Getting started" and "Connections" topics; the repository's `package.json`, `src-tauri/tauri.conf.json` and `.github/workflows/ci.yml` |
| Interface | the in-app "The left rail", "Dashboards and folders", "Dashboard tabs", "The widget library", "Widget cards", "Card parameters", "Running and refreshing" and "Keyboard shortcuts" topics; `GroupLink.tsx`, `GroupMenu.tsx` and `src/lib/paramGroups.ts` |
| Widgets | the in-app "Tables", "Charts", "Built-in widgets", "Documents, PDFs and files" and "HTML and iframe widgets" topics |
| Configuration | the in-app "Settings and logs", "Provider keys", "Import and export" and "Troubleshooting" topics; `src/lib/settingsBundle.ts` and `src/lib/jsonStore.ts`; `key-maint/README.md`; the stack's Serve configuration |
| Integrations | `openbb-docker`'s README, compose file, Dockerfile, Serve configuration and `docs/funnel.md`; `web/`, `vercel.json` and `scripts/gateway-vendor.mjs` for the web preview |
| Troubleshooting | the in-app "Troubleshooting" topic and the Gotchas section of the v3.0.0 rebuild document; `openbb-docker`'s `docs/funnel.md` |
| Testing | `docs/test-environment.md`, `scripts/reference-backend.sh`, `src/test/integration/reference-backend.test.ts` and `docs/examples/*.apps.json` |

## Episodes, for the narrative

| Episode | Title | Feeds into |
|---|---|---|
| 1 | Your Own Bloomberg in a Cabinet | [[openbb-docker-stack\|The openbb-docker Stack]], [[tailscale-networking\|Tailscale Networking]] |
| 2 | The Borrowed Terminal | [[backends-and-connections\|Backends and Connections]] |
| 3 | Kick the Tires on a Reference Build | [[layout-and-navigation\|Layout and Navigation]], [[provider-keys\|Provider Keys]] |

Episode 3 is the release boundary for this version. The reference backend is qualified independently; its exact source and image are recorded in the release provenance.

## What changed from the original guide

Readers of the original *BDOBB Help* will find these differences, all of them because the app changed:

- **There is no news wire.** The original's news wire, and its *Secrets and Access* page for the wire's keys, have no pages here: BDOBB has no news wire at this version, and the stack it pairs with runs no feed server. The one feed widget is the RSS feed built-in, which reads a single feed directly. See [[built-in-widgets|Built-in Widgets]].
- **The original's planned real-time chart and ArcticDB explorer have no pages here**, because neither exists at this version — not in the app, and not in the stack it pairs with.
- **There is no AI side at this version.** The original's AI chat pane has no page here: BDOBB at this version has no chat pane, no agent client and no MCP client, and the stack it pairs with runs no MCP server.
- **The Markdown editor is new**, and so are the RSS feed built-in, the transposed view, run-button widgets, viewer windows, and everything under [[import-and-export|Import and Export]] — including the settings bundle that carries your preferences and folder tree between machines, which the original had no equivalent of. See [[settings-export-and-import|Settings Export and Import]].

## Screenshots

Every screenshot in this guide is one the app takes of itself: the in-app manual's shots are regenerated once per release against a mock backend, in both themes, and the light-theme set is copied here under each topic's name. Pages for surfaces that need a live stack — the stack's own services — are text-only, as the original's unshipped pages were. So are the pages whose in-app topic had no screenshot at this version: Card Parameters, Running and Refreshing, Built-in Widgets, Documents, PDFs and Files, HTML and iframe Widgets, Settings Export and Import, and Using BDOBB -- and the three new pages this version adds (Reference Validation, Example Dashboards, Web Preview), which document a running backend and a deployed preview rather than app UI.

## How this vault is versioned

Each top-level folder of the repository is a complete, self-contained snapshot of the guide at one BDOBB release — `v3.3/` is this one, copied from `v3.1/` and refactored page by page against the `v3.3.0` tag. When the app moves, the folder is copied to the new version's name and refactored page by page against the shipped app; old snapshots are never edited. Wikilinks and images resolve only within their own folder, and `scripts/verify-snapshot.mjs` checks that they do. The repository's README has the procedure.

---
*Adapted for clean BDOBB v3.0.0 from the BDOBB v3.3.3 guide. Historical citations retain source provenance.*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
