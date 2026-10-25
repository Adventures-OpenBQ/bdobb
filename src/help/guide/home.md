---
type: Note
tags: [bdobb, help, home, index]
---

# BDOBB Help

BDOBB (Better Desktop for OpenBB, second edition) is a private desktop app for OpenBB-compatible backends — dashboards, live data, charts and a private AI analyst, all running against hardware you control. This vault is the searchable help guide for **version 7.0.0**: use the Reference Manual search box to jump straight to a topic, or browse by section below. BDOBB also carries this guide with it — it is the **Reference Manual** on the app's Help menu.

Version 7.0.0 adds the iPad port (see *iPad*), **Export…** and **Import…** for connections, and **File ▸ Import apps.json…**. Version 6.0.0 added the Rita agent, MCP servers and the AI Library. Version 5.0.0 added workspaces — several dashboards on screen together, each workspace with a minimum resolution it zooms to fit below, an **Open at launch** choice that opens the workspace best fitted to the screen, and **Window ▸ Keep Sidebar Open** to pin the rail per workspace — and the **Statement** view, which lays financial rows out as line items and relabels a statement's fiscal periods from each company's fiscal year end. Analytical Pivot models, reusable Statement templates, date expressions and exchange calendars, Calendar presentation, improved library and key controls, and docked parameter panels came in version 4.0.0. Cron scheduling is not supported.

If you have used the original BDOBB, the shape is familiar and the details are not. BDOBB is a from-scratch rebuild, and this guide describes what it actually does — every page was checked against the shipped app's own manual and code, not against the old app or its plans.

## Getting Started

- [[installing-and-running|Installing and Running BDOBB]] — building from source, the signed disk image, and the first three things to do
- [[connecting-a-backend|Connecting a Backend]] — the Connections dialog, Test, the status dot and the seeded `Local` entry
- [[importing-dashboards|Importing Dashboards]] — `apps.json` three ways, unresolved cards, and parameter groups
- [[reference-validation|Reference Validation]] — the reference backend anyone can run, and the conformance suite that checks the client against it
- [[example-dashboards|Example Dashboards]] — every BDOBB example from 3.0.0 to this version, Demo providers and Video Library among them, served together as one file by the paired openbq-docker

## Interface

- [[layout-and-navigation|Layout and Navigation]] — the left rail, the Rita tab, the tab strip, viewer windows and how BDOBB fails in pieces
- [[dashboards-and-folders|Dashboards and Folders]] — creating, renaming, duplicating, deleting, moving, and opening a dashboard in its own window
- [[workspaces|Workspaces and Saved Layouts]] — several dashboards, panel arrangements and local persistence
- [[dashboard-tabs|Dashboard Tabs]] — the strip above the grid and what each control on it does
- [[widget-library|The Widget Library]] — search, the filters, backend and provider badges, and the three ways to add a widget
- [[widget-cards|Widget Cards]] — the header, the ⋯ menu, moving, resizing, rename, maximize, minimize and remove
- [[card-parameters|Card Parameters]] — Apply, the kinds of control, defaults, cascades, groups, tabs and forms
- [[date-expression|Date Expressions]] — relative dates, fiscal periods and exchange sessions
- [[running-and-refreshing|Running and Refreshing]] — Refresh, `⌘R`, automatic refresh, and run-button widgets
- [[keyboard-shortcuts|Keyboard Shortcuts]] — every shortcut, and what Escape does when several things are open

## Widgets

- [[statement-view|Statement View]] — financial line items, fiscal periods, saved folds and exports

- [[tables|Tables]] — sorting, filtering, columns, pinning, transpose, cell clicks, and what a backend can declare
- [[charts|Charts]] — the Plotly charts: what a chart widget can return, and zoom, pan and reset
- [[calendar-view|Calendar View]] — dated rows, navigation, fields and saved filters
- [[linked-widgets|Linked Widgets]] — tables and charts that draw from another table on the dashboard
- [[built-in-widgets|Built-in Widgets]] — Note, Markdown, Clock, Website and RSS feed, none of which need a backend
- [[documents-pdf-and-files|Documents, PDFs and Files]] — PDF cards, multi-file viewers, and dropping a data file on a dashboard
- [[html-and-iframe-widgets|HTML and iframe Widgets]] — framed pages, why some go blank, and the messages a page can exchange with its card

## Configuration

- [[settings-and-logs|Settings and Logs]] — the sections of the Settings dialog, including those a backend adds, and the log viewer
- [[provider-keys|Provider Keys]] — which data-vendor credentials the stack holds and whether each vendor accepts them
- [[app-data-and-settings|App Data and Settings]] — where everything lives on disk, atomic writes, and quarantine
- [[import-and-export|Import and Export]] — dashboards as `apps.json`, settings as `bdobb-settings.json`, the AI Library's settings, and one card's data
- [[settings-export-and-import|Settings Export and Import]] — moving your preferences and folder tree between machines
- [[backends-and-connections|Backends and Connections]] — what the credential fields mean for each backend in the stack

## iPad

- [[installing-on-ipad|Installing on iPad]] — the toolchain wrapper, dev and release builds, free-tier signing, and the three gates
- [[ipad-interface-differences|iPad interface differences]] — the touch dialect, long-press, what is not touch-native, and moving settings across

## Rita and AI

- [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] — the OpenBQ Rita and MCP services, the URLs, Check, the 17 local tools and the tool-round limit
- [[rita-chat|Rita (AI Chat)]] — the pane, context sharing and what is sent, Stop, Undo and the chat file
- [[ai-library|The AI Library]] — Rita's URL and options, MCP servers and per-tool disable, skills, share targets and Appearance

## Integrations

- [[openbq-docker-stack|The openbq-docker Stack]] — the base compose and the Episode 3 and 6 overlays, the ports Tailscale Serve publishes, and what each service is in BDOBB
- [[tailscale-networking|Tailscale Networking]] — Serve-only ingress, key-maint's Tailscale Service, and the sharp edges
- [[web-preview|Web Preview]] — the GitHub-gated browser build, served over HTTP through the stack's gateway

## Troubleshooting

- [[troubleshooting-using-bdobb|Using BDOBB]] — symptoms inside the app: cards, connections, the rail, Rita and the AI Library, settings, files
- [[troubleshooting-infrastructure|Configuring the Infrastructure]] — symptoms in the stack: openbq-docker, Rita and MCP, and Tailscale

## About

- [[about-this-guide|About This Guide]] — where each page's facts come from, and how this vault is versioned

---

## Documentation terms

Copyright © 2026 SecretoftheUniverse.com LLC. All rights reserved, subject to the exceptions below.

### Scope

These terms apply to original prose, illustrations, and screenshots owned by SecretoftheUniverse.com LLC in `src/help/topics/`, `src/help/guide/`, `src/help/shots/`, `docs/reference-manual/`, and `docs/user-guide.md`, and to their rendered or exported documentation editions, beginning with the revision that introduces these terms. They do not cover the repository's software, executable code examples, configuration examples, third-party material, user content, or material separately identified as having another license. Directory placement alone does not override those exclusions.

### Permitted use

You may read, search, download, and print these materials for personal or internal organizational use to learn, evaluate, install, operate, troubleshoot, and maintain bdobb. You may make reasonable internal copies for those purposes and retain archival copies. Keep the copyright notice and these terms with copies. You may link to the publisher's documentation. Software and executable examples remain usable under their applicable software licenses.

### Restrictions

Except as permitted above, separately authorized in writing by SecretoftheUniverse.com LLC, or allowed by applicable law or an existing license, you may not reproduce, republish, redistribute, sell, sublicense, translate, adapt, or create derivative documentation from the covered materials.

You may not use the covered materials to reverse engineer, reconstruct, or replicate bdobb or another product, or to derive its source code, architecture, algorithms, or implementation details, except to the extent applicable law or an existing license permits that activity. This restriction concerns use of the covered documentation; it does not restrict activities independently authorized under the software's license.

### Software rights and prior permissions

These documentation terms are separate from the software license and add no conditions to software licensed under GNU AGPL-3.0 or any other applicable software license. They do not restrict copying, modification, distribution, network use, or access to Corresponding Source as authorized by that license. If any covered material must accompany the software or form part of its Corresponding Source under an applicable software license, that license governs the material to the extent needed to satisfy those obligations.

These terms do not revoke permissions already granted for any previously licensed version, relicense third-party contributions, or override third-party notices. Third-party material remains subject to its own terms. Nothing here limits fair use, statutory exceptions, or other rights that cannot lawfully be restricted. No exclusive rights are claimed in underlying ideas, facts, systems, or methods as such.

### Additional permission

Obtain written permission from SecretoftheUniverse.com LLC before undertaking a use outside the permissions above. A copyright notice or these published terms alone do not establish that a reader has entered a separate contract; any contractual restrictions requiring agreement must be presented through an appropriate acceptance process.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
