# Import and export

## Whole dashboards, as `apps.json`

Both live on the rail's right-click menu. Right-click empty space in
*MY DASHBOARDS* for **Import apps.json…**; right-click a dashboard row for
**Save…**. In the desktop app, **File ▸ Import apps.json…** in the menu bar
imports too.

**Save…** opens the macOS Save panel defaulting to `<dashboard name>.apps.json`,
with a **Format** pop-up under the file name. It writes that one dashboard in
OpenBB Workspace's app shape. Cancelling does nothing. You get a one-line
notice in the rail: *Exported Markets.* or *Export failed*, with the message.

**Strict OpenBB Workspace**, the default format, writes the plain OpenBB shape. **BDOBB Workspace** also preserves dashboard/card names and ordinary table state in a validated BDOBB extension: sort, filters, column order, hidden columns, column widths, pinned columns, the card's view (table, chart, raw, transposed or calendar) and whether it is minimized; its notice names the profile it wrote, such as *Exported Markets with BDOBB v4 state.* Dropped file bytes and credentials are never included. Analytical models, linked cards and pinned Statement templates travel in the v4 profile (see Clean v4 compatible persistence below). In the browser build, which has no Save panel, **Save…** opens a small menu of the two formats first.

**Import** opens a file picker and adds every app in the file as a new
dashboard. Dropping an `apps.json` on the dashboard, or **File ▸ Import apps.json…**, does the same.

When a dashboard in the file has **exactly** the name of one of yours
(capitals count), you are asked about it before anything is written, one
dialog per dashboard, with *Conflict 2 of 3* when there are several:

- **Replace** swaps in the file's tabs, cards and groups. Yours keeps its
  name and its place in the rail, and anything you added since is gone.
  When two of your dashboards share the name, Replace is unavailable until
  you rename one.
- **Keep both** (the default) adds it under the first unused name, such as
  `Macro (2)`. The button shows the name it will get.
- **Skip** leaves it out.
- **Cancel import**, or Escape, stops the whole import. Nothing is written,
  and the notice reads *Import cancelled; nothing changed.*

A name repeated *inside* the file is not asked about: the second copy
becomes `Macro (2)` as before. The notice reads
*Imported 3 dashboards (1 replaced, 1 skipped), 21 cards (0 unresolved)*.
The counts in parentheses appear only when they are not zero.

"Unresolved" means a card whose widget id no backend currently serves. It is
not discarded — it reads *Widget `<id>` is not on any connected backend.* and
comes alive by itself the moment a backend serving that id connects.

A Workspace file's **parameter groups** arrive as groups on the dashboard, with
each card's membership read from the card itself (as Workspace writes it) or
from a member list on the group (as a hand-written file may). BDOBB writes two
fields of its own into an exported file, and only when needed: a group's
`groupType` when it differs from the parameter name, and a card's
`groupBindings` when one of its controls is in a group under a different name
(a `ticker` in a `symbol` group). Workspace ignores both; a file that never
used them round-trips byte for byte. Groups can also be made and joined
directly in the app — see Card parameters.

### The size guard

Two hard ceilings, and hitting either imports nothing at all:

- **10 MB**, checked from the file's size *before it is read*, so an oversized
  file is never parsed. The refusal reads *File is 10.1 MB; the limit is 10
  MB.*
- **500 dashboards**, checked after parsing but before anything is written. The
  refusal reads *File holds 501 dashboards; the limit is 500.*

The megabyte figure is rounded up, so a file one byte over the limit reads as
`10.1 MB` and never as `10 MB`. Both limits are inclusive: exactly 10 MB and
exactly 500 dashboards are accepted.

A file that is not an array of apps fails with *not an apps.json file*.

## Settings and folders, as `bdobb-settings.json`

The Settings dialog has its own **Export…** and **Import…**, for moving your
preferences and your rail's folder tree between machines. Import has two ways
in — the dialog's button, or simply **drop the file on the dashboard**, which
is recognised by its shape rather than its name. Both parse the file the same
way, but they end differently: the dialog's **Import…** shows a per-field
review of what would change, with **Apply** and **Discard**, and nothing
reaches disk until **Done**; a drop applies at once and leaves a notice in the
rail.

**Export** writes your preferences and the folder tree. It does **not** write
the dashboard order: importing dashboards gives them new ids, so an exported
order would name dashboards that do not exist on the machine reading it.

**Import** applies preferences **one field at a time** — a setting the file
does not mention keeps the value it already had, so an older or hand-trimmed
file cannot quietly reset the rest. The folder tree is the exception: it is
**replaced**, because merging two trees has no sensible answer for two
folders that share an id and disagree about their parent.

A drop's notice reads *Imported settings and 3 folders.* when the file carries a
folder tree with folders, or *Imported settings.* when the file carries no folder
tree at all — which is what **Export…** now writes for a machine with no
folders of its own, so it never wipes a destination's tree by accident. If a
file DOES carry an *empty* folder tree — a hand-edited file, say, or one from
an older version that always wrote one — the notice reads *Imported settings
and cleared the folder tree.*, and the tree is still replaced: that is the same
replacement rule as above, not an exception to it.

A file that is not JSON, or is JSON of the wrong shape, is refused and changes
nothing. The dialog's **Import…** checks the same 10 MB ceiling the
`apps.json` import uses, before the file is read. A **dropped** file is
checked differently: a dropped `.json` is only sniffed to see whether it is a
settings bundle when it is 10 MB or smaller, so an oversize
`bdobb-settings.json` dropped on the dashboard is never refused as one — it
falls through and becomes a local-table card instead, the same as any other
large `.json` you drop. A dropped bundle never changes the Rita URL, Context
sharing, the Send chat to… targets, the switched-off MCP tools or the agent's
options; its notice names what it skipped and points to **Settings ▸ Import**.

## One card, as CSV, JSON or Excel

![A card's Export submenu](./shots/import-and-export.png)

A card's `⋯` menu has **Export ▸** with **CSV**, **JSON** and **Excel**. It is
offered only on cards that actually fetch data, so not on framed pages, notes,
clocks, the keys panel, document viewers or PDFs.

**When only JSON is offered**, CSV and Excel are shown disabled rather than
hidden, with the tooltip *Only JSON export is available for this payload*.
That happens when the payload has no columns to make: an empty array, an array
of bare values, a plain string or a number. An array of objects or a single
object exports to all three. A payload of nothing at all offers none.

What comes out is the **raw values, not what is on screen**. A table showing
`2.3M` exports `2300000`, and the **Maximum decimal places** setting does not
apply.

CSV is RFC 4180 — comma-separated, CRLF line endings, a header row, fields
quoted only when they need it. JSON is pretty-printed. Excel is a single sheet
named `Data`. CSV and Excel head each column with the name the backend gives
it (`RPI` becomes *Real Personal Income*), or the field key where it gives
none; JSON keeps the field keys.

The suggested filename is the widget's name, its non-blank parameters sorted by
name, and today's local date, with anything a filesystem dislikes replaced by a
dash and the whole thing capped at 120 characters. Cancelling writes nothing; a
failed write shows *Export failed*, with the message, on the card. The data
itself is never
logged.

## Clean v4 compatible persistence

A **BDOBB Workspace** save uses a versioned v4 profile when analytical models, symbolic selections, linked cards, fiscal/calendar choices or docked controls need to travel. Ordinary v3 files remain readable. Unknown profiles and malformed settings are refused before writes. Local-file bytes and credentials are not bundled; local-file dependencies can be refused as MISSING_LOCAL_ASSET. A **Strict OpenBB Workspace** save omits these additions. Pinned Statement templates are preserved by the v4 analytical profile. Workspace layouts and generic Statement presentation belong to v5. An `apps.json` from the earlier BDOBB line can mark a statement card with `pivotView`. It imports as the **Statement** view, its collapsed sections as folds; a card whose chart or transposed view is also set keeps that view. Anything in that state with no Statement equivalent is dropped, and the import notice names each piece and where it was.


V5 selects a compatible v5 profile when generic Statement state is present, retaining v4 models, pinned templates and links. Statement CSV, JSON and Excel exports use completed line-item rows, including folded sections. Workspace arrangements and saved layouts persist separately; apps.json does not bundle them.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
