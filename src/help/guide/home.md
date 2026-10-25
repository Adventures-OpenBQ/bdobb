---
type: Note
tags: [bdobb, help, home, index]
---

# BDOBB Help

BDOBB (Better Desktop for OpenBB, second edition) is a private desktop app for OpenBB-compatible backends — dashboards, live data, charts and a private AI analyst, all running against hardware you control. This vault is the searchable help guide for **version 10.0.0**: use the Reference Manual search box to jump straight to a topic, or browse by section below. BDOBB also carries this guide with it — it is the **Reference Manual** on the app's Help menu.

Version 10.0.0 adds the live grid — a table that streams over a websocket, with logos and range bars from the backend's `symbol_meta` — the Live Chart, the web preview's half of the `/grid` relay, and the Episode 10 live-grid example. Version 9.0.0 added EODHD data as the stack's openbq-eodhd extension serves it, with EODHD's calendars in the Calendar view, the Episode 9 calendars example, and provider aggregation hints read from `widgets.json` (they make the older Pivot panel's **Use suggested** live and show in Rita's `describe_table` and `arrange_table`). Version 8.0.0 added the News wire (and the web preview's relay for it), Live TV from the same rss-ticker server, pinned cards, locked widgets that sync, and Rita's `pin_card`, and the rail loses its Add widget row. Version 7.0.0 added the iPad port (see *iPad*), **Export…** and **Import…** for connections, and **File ▸ Import apps.json…**. Version 6.0.0 added the Rita agent, MCP servers and the AI Library. Version 5.0.0 added workspaces — several dashboards on screen together, each workspace with a minimum resolution it zooms to fit below, an **Open at launch** choice that opens the workspace best fitted to the screen, and **Window ▸ Keep Sidebar Open** to pin the rail per workspace — and the **Statement** view, which lays financial rows out as line items and relabels a statement's fiscal periods from each company's fiscal year end. Analytical Pivot models, reusable Statement templates, date expressions and exchange calendars, Calendar presentation, improved library and key controls, and docked parameter panels came in version 4.0.0. Cron scheduling is not supported.


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
- [[news-widget|The News Widget]] — a headline wire from an rss-ticker server: feed tabs, highlights, two layouts, `rss-agg.json`, and the web preview's relay
- [[live-tv|Live TV]] — a YouTube channel's live stream, from the rss-ticker server connected as a backend once you list channels for it
- [[locked-and-pinned-widgets|Locked and Pinned Widgets]] — Pin widget ▸ and its bands, Settings ▸ Locked Widgets and its editor, the docks sync, and what an import replaces
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

- [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] — the OpenBQ Rita and MCP services, the URLs, Check, the 18 local tools and the tool-round limit
- [[rita-chat|Rita (AI Chat)]] — the pane, context sharing and what is sent, Stop, Undo and the chat file
- [[ai-library|The AI Library]] — Rita's URL and options, MCP servers and per-tool disable, skills, share targets and Appearance

## Integrations

- [[openbq-docker-stack|The openbq-docker Stack]] — the base compose and the Episode 3 and 6 overlays, the v8 `web` profile (funnel-gateway and rss-ticker), the ports Tailscale Serve publishes, and what each service is in BDOBB
- [[eodhd-data-provider|EODHD Data]] — the openbq-eodhd widgets openbq-docker v9's API serves, the stack's key, EODHD's calendars in the Calendar view, statements, and aggregation hints
- [[kdb-tick-cache|kdb+ Tick Cache]] — the `live` profile's `openbq-kdb` and live-grid's tick recorder: bring-your-own q, the spool, the seam, the Delta Lake store and the tick widgets
- [[tailscale-networking|Tailscale Networking]] — Serve-only ingress, key-maint's Tailscale Service, and the sharp edges
- [[web-preview|Web Preview]] — the GitHub-gated Vercel preview of the dashboard grid, what it can reach (the News relay included), and what resets

## Troubleshooting

- [[troubleshooting-using-bdobb|Using BDOBB]] — symptoms inside the app: cards, connections, the rail, Rita and the AI Library, settings, files
- [[troubleshooting-infrastructure|Configuring the Infrastructure]] — symptoms in the stack: openbq-docker, Rita and MCP, and Tailscale

## About

- [[about-this-guide|About This Guide]] — where each page's facts come from, and how this vault is versioned
