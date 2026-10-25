# Widget cards

A card is one widget on the grid. Everything you can do to it lives in its
header.

![A card's header with its ⋯ menu open](./shots/widget-cards.png)

## The header, left to right

- The **timer** — `◷`, or `▶` on a widget that declares a run button. Green
  means the data on screen is fresh; orange means it is stale, or the last
  fetch failed. Its tooltip reads *Last refresh 5 minutes ago*. Click it to
  refresh (or run). On a run-button card it pulses when the live parameters
  have changed since the last run.
- The **Parameters chevron** — `▸` on every card with parameters, `▾` while
  its docked Parameters panel is open. Open or closed is saved with the card.
  See **Card parameters**.
- The **title**. This is also the drag handle; double-click it to rename.
- The **parameter chips** — one per visible parameter, on the title line
  itself, wrapping to a second line when the title bar is narrow. See
  **Card parameters**.
- `⌄` **Show widget controls** — only when
  **Settings ▸ Widget ▸ Collapse widget controls** is on
  (off by default). The chips and everything after this point then hide
  behind it.
- The **view dropdown**. Its first entry is named for the card's own kind:
  `Table`, `Chart`, `Markdown`, `HTML`, `Page`, `Metric`, `Note`, `Clock`,
  `Feed`, `Keys` or `Default` for a kind it has no name for. Choosing it clears
  the card's saved view rather than writing one. Then, when they apply:
  `Chart`, added to any non-chart card whose rows turn out to contain a time
  column, or any other axis column with numeric columns beside it;
  `Calendar`, on any card whose rows have a date column — see **Calendar
  view**; `Raw`, on any card that actually fetches data; and `Transposed`, on
  table cards — see **Tables**. PDF and multi-file cards have no dropdown at
  all: their bodies are document viewers with toolbars of their own.
  If the card carries a saved view the list no longer offers — a chart view
  whose rows lost their time column, say — that view is shown as an extra
  **disabled** entry, so the control never claims to be showing something it
  is not, and picking another entry really does change it.
- `⌕` **Filter rows** — table cards only. See **Tables**.
- `⋯` **Card menu**.
- **Pivot** — on a pivotable table. See **Tables**.
- `⤢` **Maximize** / `⤡` **Restore**.
- `—` **Minimize card** / `▢` **Expand card**.
- `✕` **Remove card**.

## The ⋯ menu

In order: **Rename…**, **Parameters** (**Hide parameters** while the panel is
open), **Duplicate**, **Copy to ▸** (every dashboard's tabs), **Maximize** (or
**Restore**); on a table, **Create linked chart** and **Create linked table**,
which add a new card on the same tab drawing from this card's rows; on a
linked card, **Choose source** (see **Linked widgets**); and, while a table is
actually on screen, **Quick actions ▸** (**Autosize columns**, **Reset
columns** — what **Reset table** did) and **Columns ▸**, then **Export ▸**
(CSV, JSON, Excel) and, on a markdown note, **Open file…** and **Save as…**.

Escape or a click outside closes it. Reopening it always starts with every
flyout collapsed.

## Moving and resizing

**The title is the drag handle.** Dragging anywhere else in the card —
including its body — does not move it. Resize from the bottom-right corner, or
from all four corners if you turn on
**Settings ▸ Layout ▸ Corner drag handles**. Position and size are saved when
you let go, and only when something actually changed.

## Minimize

`—` collapses the card to just its title row; the body and the controls row
go, the grid slot stays. It is shown only while
**Settings ▸ Widget ▸ Minimize button on header** is on, which it is not by
default.

Minimizing **is** saved, so a minimized card is still minimized after a
restart. `▢` **Expand card** is therefore always offered on a minimized card,
even in a viewer window and even with the setting off — otherwise a card saved
minimized would be stuck that way.

Minimize and maximize are mutually exclusive: each undoes the other first.

## Rename

Double-click the title, or choose **Rename…** from the `⋯` menu. Either way you
get the same field: focused, fully selected, **Enter** to save, **Escape** to
cancel, clicking away saves, empty or unchanged does nothing.

Typing the widget's own name back *removes* the override rather than freezing
today's name onto the card, so the card follows the backend again if the widget
is renamed upstream. While a custom title is set, hovering it shows the
widget's real name.

The title is saved per card. A **Strict OpenBB Workspace** `apps.json` export
does not carry it; the **BDOBB Workspace** format does.

Every resolved card carries the `⋯` menu, including framed pages, the keys
panel, document viewers, PDFs and the built-ins — so double-clicking the
title is never the only way to rename one. What the menu offers varies:
**Export ▸** appears only on cards that fetch data (and not on PDFs), and the
note-specific items (**Open file…**, **Save as…**, above) appear only on a
markdown note.

## Maximize

Three ways in: the `⤢` button, the `⋯` menu's **Maximize**, or double-clicking
the header's *empty background* — the padding and the gaps between buttons, not
the title (that renames) and not a button (that does the button's job).

The card fills the dashboard area, one at a time per window. The same card
stays mounted throughout, so a chart's zoom, a table's scroll position and a
PDF's page all survive.

Maximizing is **never saved**. Restarting the app, or switching to a different
dashboard or tab, restores the card. It is allowed in a viewer window.

**Escape** restores it — but only when nothing else wants that press first. An
open rename field cancels first; then any open menu, the widget library, or the
Settings, Connections or Help dialog takes it; only then does the card restore.

## Remove

`✕` removes the card immediately, with no confirmation — unlike deleting a
dashboard, a folder or a tab, which all ask first. A *Card removed.* notice
then offers **Undo**, which puts the card back where it was, and **Dismiss**.
Only the most recent removal can be undone, and only until the app closes. Removing a
card is not available in a viewer window.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v5.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
