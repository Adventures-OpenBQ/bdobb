---
type: Note
tags: [bdobb, help, home, index]
---

# BDOBB Help

BDOBB (Better Desktop for OpenBB, second edition) is a private desktop app for OpenBB-compatible backends — dashboards, live data and charts, all running against hardware you control. This vault is the searchable help guide for **version 5.0.0**: use the Reference Manual search box to jump straight to a topic, or browse by section below. BDOBB also carries this guide with it — it is the **Reference Manual** on the app's Help menu.

This version adds workspaces — several dashboards on screen together, each workspace with a minimum resolution it zooms to fit below, an **Open at launch** choice that opens the workspace best fitted to the screen, and **Window ▸ Keep Sidebar Open** to pin the rail per workspace — and the **Statement** view, which lays financial rows out as line items and relabels a statement's fiscal periods from each company's fiscal year end. Analytical Pivot models, reusable Statement templates, date expressions and exchange calendars, Calendar presentation, improved library and key controls, and docked parameter panels came in version 4.0.0. Cron scheduling is not supported.

If you have used the original BDOBB, the shape is familiar and the details are not. BDOBB is a from-scratch rebuild, and this guide describes what it actually does — every page was checked against the shipped app's own manual and code, not against the old app or its plans.

## Getting Started

- [[installing-and-running|Installing and Running BDOBB]] — building from source, the signed disk image, and the first three things to do
- [[connecting-a-backend|Connecting a Backend]] — the Connections dialog, Test, the status dot and the seeded `Local` entry
- [[importing-dashboards|Importing Dashboards]] — `apps.json` two ways, unresolved cards, and parameter groups
- [[reference-validation|Reference Validation]] — the reference backend anyone can run, and the conformance suite that checks the client against it
- [[example-dashboards|Example Dashboards]] — every BDOBB example from 3.0.0 to this version, Demo providers and Video Library among them, served together as one file by the paired openbq-docker

## Interface

- [[layout-and-navigation|Layout and Navigation]] — the left rail, the tab strip, viewer windows and how BDOBB fails in pieces
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
- [[import-and-export|Import and Export]] — dashboards as `apps.json`, settings as `bdobb-settings.json`, and one card's data
- [[settings-export-and-import|Settings Export and Import]] — moving your preferences and folder tree between machines
- [[backends-and-connections|Backends and Connections]] — what the credential fields mean for each backend in the stack

## Integrations

- [[openbq-docker-stack|The openbq-docker Stack]] — the base compose and the Episode 3 overlay, the ports Tailscale Serve publishes, and what each service is in BDOBB
- [[tailscale-networking|Tailscale Networking]] — Serve-only ingress, key-maint's Tailscale Service, and the sharp edges
- [[web-preview|Web Preview]] — the GitHub-gated browser build, served over HTTP through the stack's gateway

## Troubleshooting

- [[troubleshooting-using-bdobb|Using BDOBB]] — symptoms inside the app: cards, connections, the rail, settings, files
- [[troubleshooting-infrastructure|Configuring the Infrastructure]] — symptoms in the stack: openbq-docker and Tailscale

## About

- [[about-this-guide|About This Guide]] — where each page's facts come from, and how this vault is versioned
