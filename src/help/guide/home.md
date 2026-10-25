---
type: Note
tags: [bdobb, help, home, index]
---

# BDOBB Help

BDOBB (Better Desktop for OpenBB, second edition) is a private desktop app for OpenBB-compatible backends — dashboards, live data and charts, all running against hardware you control. This vault is the searchable help guide for **version 3.0.0**: use the Reference Manual search box to jump straight to a topic, or browse by section below. BDOBB also carries this guide with it — it is the **Reference Manual** on the app's Help menu.

If you have used the original BDOBB, the shape is familiar and the details are not. BDOBB is a from-scratch rebuild, and this guide describes what it actually does — every page was checked against the shipped app's own manual and code, not against the old app or its plans.

## Getting Started

- [[installing-and-running|Installing and Running BDOBB]] — building from source, the signed disk image, and the first three things to do
- [[connecting-a-backend|Connecting a Backend]] — the Connections dialog, Test, the status dot and the seeded `Local` entry
- [[importing-dashboards|Importing Dashboards]] — `apps.json` two ways, unresolved cards, and parameter groups
- [[reference-validation|Reference Validation]] — the reference backend anyone can run, and the conformance suite that checks the client against it
- [[example-dashboards|Example Dashboards]] — the built-in widgets sample and the demo-providers sample, both keyless and served by the stack

## Interface

- [[layout-and-navigation|Layout and Navigation]] — the left rail, the tab strip, viewer windows and how BDOBB fails in pieces
- [[dashboards-and-folders|Dashboards and Folders]] — creating, renaming, duplicating, deleting, moving, and opening a dashboard in its own window
- [[dashboard-tabs|Dashboard Tabs]] — the strip above the grid and what each control on it does
- [[widget-library|The Widget Library]] — search, the five filters, backend and provider badges, and the three ways to add a widget
- [[widget-cards|Widget Cards]] — the header, the ⋯ menu, moving, resizing, rename, maximize, minimize and remove
- [[card-parameters|Card Parameters]] — Apply, the kinds of control, defaults, cascades, groups, tabs and forms
- [[running-and-refreshing|Running and Refreshing]] — Refresh, `⌘R`, automatic refresh, and run-button widgets
- [[keyboard-shortcuts|Keyboard Shortcuts]] — every shortcut, and what Escape does when several things are open

## Widgets

- [[tables|Tables]] — sorting, filtering, columns, pinning, transpose, cell clicks, and what a backend can declare
- [[charts|Charts]] — the Plotly charts: what a chart widget can return, and zoom, pan and reset
- [[built-in-widgets|Built-in Widgets]] — Note, Markdown, Clock, Website and RSS feed, none of which need a backend
- [[documents-pdf-and-files|Documents, PDFs and Files]] — PDF cards, multi-file viewers, and dropping a data file on a dashboard
- [[html-and-iframe-widgets|HTML and iframe Widgets]] — framed pages, why some go blank, and the messages a page can exchange with its card

## Configuration

- [[settings-and-logs|Settings and Logs]] — the sections of the Settings dialog, including those a backend adds, and the log viewer
- [[provider-keys|Provider Keys]] — which data-vendor credentials the stack holds and whether each vendor accepts them
- [[app-data-and-settings|App Data and Settings]] — where everything lives on disk, atomic writes, and quarantine
- [[import-and-export|Import and Export]] — dashboards as `apps.json`, settings as `bdobb-settings.json`, and one card's data
- [[settings-export-and-import|Settings Export and Import]] — moving your preferences and folder tree between machines
- [[backends-and-connections|Backends and Connections]] — what the credential fields mean for each backend in the stack

## Integrations

- [[openbb-docker-stack|The openbb-docker Stack]] — the services, the ports Tailscale Serve publishes, and what each one is in BDOBB
- [[tailscale-networking|Tailscale Networking]] — Serve-only ingress, Tailscale Services, and the sharp edges
- [[web-preview|Web Preview]] — the GitHub-gated Vercel preview of the dashboard grid, what it can reach, and what resets

## Troubleshooting

- [[troubleshooting-using-bdobb|Using BDOBB]] — symptoms inside the app: cards, connections, the rail, settings, files
- [[troubleshooting-infrastructure|Configuring the Infrastructure]] — symptoms in the stack: openbb-docker and Tailscale

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

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
