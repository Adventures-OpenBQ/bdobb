---
type: Note
tags: [bdobb, help, configuration, import, export, apps-json, csv, excel]
---

# Import and Export

Three things leave the app as files, and two of them come back in. Each has its own shape, its own way in, and its own guard.

| What | File | Out | In |
|---|---|---|---|
| A dashboard | `<name>.apps.json` | rail row ▸ **Save…** | rail section menu, or a drop on the dashboard |
| Your settings and folders | `bdobb-settings.json` | Settings ▸ **Export…** | Settings ▸ **Import…**, or a drop on the dashboard |
| One card's data | `.csv`, `.json`, `.xlsx` | card ⋯ ▸ **Export ▸** | — |

## Whole dashboards, as `apps.json`

**Save…** opens the macOS Save panel defaulting to `<dashboard name>.apps.json`, with a **Format** pop-up under the file name, and writes that one dashboard in OpenBB Workspace's app shape — the same shape a backend's own `apps.json` uses, so what you export here can be served by a backend or imported by Workspace. Cancelling does nothing. You get a one-line notice in the rail: *Exported Markets.* or *Export failed*, with the message. At this version that notice has no timeout: it stays on the rail, collapsed or expanded, until the next export or import from the rail clears or replaces it.

**Strict OpenBB Workspace**, the default format, produces the plain OpenBB shape. **BDOBB Workspace** also preserves dashboard/card names and ordinary table sort, filters, column order, hidden columns, pinned columns and transposed view in a validated BDOBB extension. In the browser build, which has no Save panel, **Save…** opens a small menu of the two formats first. Neither format includes dropped file bytes or credentials. Analytical extensions are refused on import in v3 before any dashboard is written.

Parameter groups are exported in Workspace's own shape. BDOBB writes two fields of its own into the file, and only when needed: a group's `groupType` when it differs from the parameter name, and a card's `groupBindings` when one of its controls is in a group under a different name (a `ticker` in a `symbol` group). Workspace ignores both, and a file that never used them round-trips byte for byte.

**Import** has two ways in — **Import apps.json…** on the rail's section menu, or a drop of the file on the dashboard — and every app in the file becomes a new dashboard. A dashboard whose name is exactly one of yours asks first — **Replace**, **Keep both** (the default, as `Macro (2)`), **Skip**, or **Cancel import** — before anything is written. Parameter groups come with it; unresolved widgets wait for a backend that serves them. The full account, including the 10 MB and 500-dashboard ceilings, is in [[importing-dashboards|Importing Dashboards]].

## Settings and folders, as `bdobb-settings.json`

The Settings dialog has its own **Export…** and **Import…**, which carry your preferences and the rail's folder tree between machines — the one thing that, before this version, had no export at all. Import also accepts a drop on the dashboard, recognised by the file's shape rather than its name. Preferences come back one field at a time; the folder tree is replaced wholesale. The full account, including the three notices and why the dashboard order is deliberately left out, is in [[settings-export-and-import|Settings Export and Import]].

## One card, as CSV, JSON or Excel

![A card's Export submenu](../attachments/import-and-export.png)

A card's `⋯` menu has **Export ▸** with **CSV**, **JSON** and **Excel**. The menu item is offered only on cards that actually fetch data, so there is none on framed pages, the keys panel, document viewers, PDFs, any built-in, or a table made by dropping a file.

**When only JSON is offered**, CSV and Excel are shown disabled with the tooltip *Only JSON export is available for this payload* — the payload has no columns to make: an empty array, bare values, a plain string. **Export follows the view:** from the **Transposed** view all three write the transposed rows, `Field` column first.

What comes out is otherwise the **raw values, not what is on screen**. A table showing `2.3M` exports `2300000`; the **Maximum decimal places** setting does not apply, and neither does a sort, a filter or a hidden column.

CSV is RFC 4180 — comma-separated, CRLF line endings, a header row, fields quoted only when they need it. JSON is pretty-printed. Excel is a single sheet named `Data`. CSV and Excel head each column with the name the backend gives it (`RPI` becomes *Real Personal Income*), or the field key where it gives none; JSON keeps the field keys. The suggested filename is the widget's name, its non-blank parameters sorted by name, and today's local date, with anything a filesystem dislikes replaced by a dash, capped at 120 characters. The data itself is never logged.

---
*Source: BDOBB v3.1.0 in-app manual, "Import and export"; `BDOBB` `src/components/LeftRail.tsx` and `src/lib/appsJson.ts` at `v3.1.0`.*
*See also: [[importing-dashboards|Importing Dashboards]] · [[settings-export-and-import|Settings Export and Import]] · [[tables|Tables]] · [[app-data-and-settings|App Data and Settings]]*
