# Widget cards

A card is one widget on the grid. Everything you can do to it lives in its
header.

![A card's header with its ⋯ menu open](./shots/widget-cards.png)

## The header, left to right

- The **title**. This is also the drag handle.
- `⌄` **Show widget controls** — only when
  **Settings ▸ Widget ▸ Collapse widget controls behind a chevron** is on
  (off by default). Everything after this point then hides behind it.
- **Parameters (N)** — only when the widget has at least one visible
  parameter. See **Card parameters**.
- The **view toggle** — a segmented control. Its first segment is named for the
  card's own kind: `Table`, `Chart`, `Markdown`, `HTML`, `Page`, `Metric`,
  `Note`, `Clock`, `Keys`, `PDF` or `Files`. A `Chart` segment is added to any
  non-chart card whose rows turn out to contain a time column, or any other
  axis column with numeric columns beside it, and a `Raw`
  segment appears on any card that actually fetches data.
- `⌕` **Filter rows** — table cards only. See **Tables**.
- **Refresh** — or **Run**, on a widget that declares a run button. See
  **Running and refreshing**.
- `⋯` **Card menu**.
- `⤢` **Maximize** / `⤡` **Restore**.
- `—` **Minimize card** / `▢` **Expand card**.
- `✕` **Remove card**.

## The ⋯ menu

**Rename…**, **Maximize** (or **Restore**), **Export ▸** (CSV, JSON, Excel),
and for tables **Columns ▸** and **Reset table**. It appears only on cards that
fetch data, and never on a PDF card.

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

The title is saved per card, but it is not carried in an `apps.json` export.

Cards with no `⋯` menu — framed pages, the keys panel, document viewers, PDFs
and the built-ins — can still be renamed by double-clicking the title.

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
Settings or Connections dialog takes it; only then does the card restore.

## Remove

`✕` removes the card immediately. There is **no confirmation and no undo** —
unlike deleting a dashboard, a folder or a tab, which all ask first. Removing a
card is not available in a viewer window.
