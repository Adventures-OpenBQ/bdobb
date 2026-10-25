---
type: Note
tags: [bdobb, help, configuration, import, export, apps-json, csv, excel]
---

# Import and Export

Several things leave the app as files, and all but one card's data come back in. Each has its own shape, its own way in, and its own guard.

| What | File | Out | In |
|---|---|---|---|
| A dashboard | `<name>.apps.json` | rail row ▸ **Save…** | rail section menu, **File ▸ Import apps.json…**, or a drop on the dashboard |
| Every dashboard, and the locked widgets | `All dashboards.apps.json` | rail section menu ▸ **Export all dashboards…** | as a dashboard file |
| The locked widgets alone | `Locked widgets.apps.json` | Settings ▸ Locked Widgets ▸ **Export locked widgets…** | Settings ▸ Locked Widgets ▸ **Import locked widgets…**, or as a dashboard file |
| A News card's feed list | `rss-agg.json` | the card's menu ▸ **Export feeds…** | the card's menu ▸ **Import feeds…** |
| Your settings and folders | `bdobb-settings.json` | Settings ▸ **Export…** | Settings ▸ **Import…**, or a drop on the dashboard |
| The AI Library's settings | `ai-library.json` | AI Library ▸ **Export…** | AI Library ▸ **Import…** |
| Your connections | `backends.json` | Connections ▸ **Export…** | Connections ▸ **Import…** |
| One card's data | `.csv`, `.json`, `.xlsx` | card ⋯ ▸ **Export ▸** | — |

## Whole dashboards, as `apps.json`

On a Mac, **Save…** opens the macOS Save panel defaulting to `<dashboard name>.apps.json`, with a **Format** pop-up under the file name, and writes that one dashboard in OpenBB Workspace's app shape — the same shape a backend's own `apps.json` uses, so what you export here can be served by a backend or imported by Workspace. Cancelling does nothing. You get a one-line notice in the rail: *Exported Markets.* or *Export failed*, with the message. The notice clears after ten seconds or when the rail folds, whichever comes first, and the next export or import replaces it.

**Strict OpenBB Workspace**, the default format, produces the plain OpenBB shape. **BDOBB Workspace** also preserves dashboard/card names and ordinary table sort, filters, column order, hidden columns, column widths and pinned columns, plus each card's view (table, chart, raw, transposed or calendar) and whether it is minimized, in a validated BDOBB extension. On Windows, Linux, iPad and in the browser, which have no such panel, **Save…** opens a small menu of the two formats first. Neither format includes dropped file bytes or credentials. Analytical extensions are read back on import: the v4 profile restores analytical models, linked cards and docked controls, and a file whose BDOBB extension is unknown or malformed, or that carries an archived enabled Pivot state, is refused before any dashboard is written.

Parameter groups are exported in Workspace's own shape. BDOBB writes two fields of its own into the file, and only when needed: a group's `groupType` when it differs from the parameter name, and a card's `groupBindings` when one of its controls is in a group under a different name (a `ticker` in a `symbol` group). Workspace ignores both, and a file that never used them round-trips byte for byte.

**Import** has three ways in — **Import apps.json…** on the rail's section menu, **File ▸ Import apps.json…** in the desktop app's menu bar, or a drop of the file on the dashboard — and every app in the file becomes a new dashboard. A dashboard whose name is exactly one of yours asks first — **Replace**, **Keep both** (the default, as `Macro (2)`), **Skip**, or **Cancel import** — before anything is written. Parameter groups come with it; unresolved widgets wait for a backend that serves them. The full account, including the 10 MB and 500-dashboard ceilings, is in [[importing-dashboards|Importing Dashboards]].

## Pins, News feeds and locked widgets (v8)

From 8.0.0 the BDOBB extension has a **v8 profile**. **Save…** in the **BDOBB Workspace** format chooses it when a dashboard holds something only v8 can carry: a card pinned to an edge of its tab, or a News card's feeds, highlight keywords and tab order. The file then opens in BDOBB 8.0.0 or later; an earlier version refuses it rather than dropping what it cannot read. **Save…** in the **Strict OpenBB Workspace** format writes none of it, and Workspace has no field for any of it. **Duplicate** and **Copy to ▸** never copy a pin.

Coming in, BDOBB 8 skips v8 data it cannot read — written by a later version, or damaged by hand — instead of refusing the file: a card whose v8 state is unreadable loses that state alone, and the dashboard still imports. The notice ends *skipped v8 data this version cannot read:* and names what was left off.

**Export all dashboards…**, on the rail's section menu, writes every dashboard to one `All dashboards.apps.json`, each in the BDOBB-compatible shape, followed by the locked widgets as one more app marked as the bands — left out when both bands are empty. If one dashboard cannot be written that way, the export is refused and names it. **Settings ▸ Locked Widgets ▸ Export locked widgets…** writes the bands alone.

The marked app always becomes your locked widgets, never a dashboard, and there is one set of them, so an import cannot merge: empty bands are filled silently; bands that hold something ask *Importing will replace your locked widgets on both edges. This cannot be undone.*, with **Replace** and **Keep mine**. The rail's **Import apps.json…**, **File ▸ Import apps.json…** in the desktop menu bar, a dropped file and **Import locked widgets…** all run that check, and the dashboards in the file are imported either way. That is why no shared example carries locked widgets. See [[locked-and-pinned-widgets|Locked and Pinned Widgets]].

A News card's own **Export feeds…** and **Import feeds…** move one wire without its dashboard, as `rss-agg.json`; import replaces the card's list with a file's, all or nothing. See [[news-widget|The News Widget]].

## Settings and folders, as `bdobb-settings.json`

The Settings dialog has its own **Export…** and **Import…**, which carry your preferences and the rail's folder tree between machines — the one thing that, before this version, had no export at all. Import also accepts a drop on the dashboard, recognised by the file's shape rather than its name. Preferences come back one field at a time; the folder tree is replaced wholesale. The full account, including the three notices and why the dashboard order is deliberately left out, is in [[settings-export-and-import|Settings Export and Import]].

## The AI Library's settings, as `ai-library.json`

**Export…** and **Import…** in the AI Library's header write and read the library's settings as one file: the Rita URL, Context sharing, follow-up suggestions, the tool-round limit, the MCP servers and the share targets. The pane's appearance setting is not in it. **The file carries any MCP-server or share-target headers in the clear**, and the notice under the header says so after an export: *Exported. The file holds any server headers in the clear.*

Import treats the file as a snapshot: each field the file holds replaces the current one, and a field it does not hold is left alone — an older file without the tool-round limit leaves your limit as it was. The import is staged, not saved: **Done** applies it and **Cancel** discards it. List entries are checked by the same rules the settings loader applies, so a malformed MCP server or share target is dropped on its own, and the notice counts what was kept — *Imported Rita URL, 2 of 3 MCP servers.*

Two things about an imported MCP server are decided *for* you, and a file cannot override either. A server marked **token** whose credential would come from one of your backends **arrives switched off**, whatever the file says, because enabling it is what sends that backend's credential. And **Send credential anyway** — the cross-host permission — is stripped from every imported entry. Neither the tokens you pasted nor the per-tool switches are in this file at all.

The notice also names every imported server whose address points at this computer or a private network, as *Warning: on this computer or a private network: …*. A shared file is a preset somebody else wrote and it can carry tools that reach your own machine or your LAN, so they are called out rather than arriving silently; they are still imported, and Tailscale addresses and `*.ts.net` names are not flagged. A file that does not parse reads *Not a JSON file.*; one with none of the library's fields, *Not an AI Library file.*; and a field of the wrong type — a Rita URL that is not `http(s)`, a tool-round limit outside 1–40, a list that is not a list — refuses the whole file and names the field. The same 10 MB guard as `apps.json` applies. See [[ai-library|The AI Library]].

## One card, as CSV, JSON or Excel

![A card's Export submenu](../attachments/import-and-export.png)

A card's `⋯` menu has **Export ▸** with **CSV**, **JSON** and **Excel**. The menu item is offered only on cards that actually fetch data, so there is none on framed pages, the keys panel, document viewers, PDFs, or any built-in. A table made by dropping a file exports the rows its table shows.

**When only JSON is offered**, CSV and Excel are shown disabled with the tooltip *Only JSON export is available for this payload* — the payload has no columns to make: an empty array, bare values, a plain string. **Export follows the view:** from the **Transposed** view all three write the transposed rows, `Field` column first.

What comes out is otherwise the **raw values, not what is on screen**. A table showing `2.3M` exports `2300000`; the **Maximum decimal places** setting does not apply, and neither does a sort, a filter or a hidden column.

CSV is RFC 4180 — comma-separated, CRLF line endings, a header row, fields quoted only when they need it. JSON is pretty-printed. Excel is a single sheet named `Data`. CSV and Excel head each column with the name the backend gives it (`RPI` becomes *Real Personal Income*), or the field key where it gives none; JSON keeps the field keys. The suggested filename is the widget's name, its non-blank parameters sorted by name, and today's local date, with anything a filesystem dislikes replaced by a dash, capped at 120 characters. The data itself is never logged.

---
*Source: BDOBB v3.1.0 in-app manual, "Import and export"; `BDOBB` `src/components/LeftRail.tsx` and `src/lib/appsJson.ts` at `v3.1.0`.*
*See also: [[importing-dashboards|Importing Dashboards]] · [[settings-export-and-import|Settings Export and Import]] · [[ai-library|The AI Library]] · [[tables|Tables]] · [[app-data-and-settings|App Data and Settings]]*

## Clean v4 compatible persistence

A **BDOBB Workspace** save uses a versioned v4 profile when analytical models, symbolic selections, linked cards, fiscal/calendar choices or docked controls need to travel. Ordinary v3 files remain readable. Unknown profiles and malformed settings are refused before writes. Local-file bytes and credentials are not bundled; local-file dependencies can be refused as MISSING_LOCAL_ASSET. A **Strict OpenBB Workspace** save omits these additions. Pinned Statement templates are preserved by the v4 analytical profile. Generic Statement presentation belongs to the v5 profile. An `apps.json` from the earlier BDOBB line can mark a statement card with `pivotView`. It imports as the **Statement** view, its collapsed sections as folds; a card whose chart or transposed view is also set keeps that view. Anything in that state with no Statement equivalent is dropped, and the import notice names each piece and where it was.


V5 selects a compatible v5 profile when generic Statement state is present, retaining v4 models, pinned templates and links. Statement CSV, JSON and Excel exports use completed line-item rows, including folded sections. Workspace arrangements and saved layouts persist separately; apps.json does not bundle them.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
