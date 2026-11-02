---
type: Note
tags: [bdobb, help, interface, widgets, cards, header]
---

# Widget Cards

A card is one widget on the grid. Everything you can do to it lives in its header, and the header is deliberately quiet: the title, the controls that apply to this card's kind, and nothing else.

![A card's header with its ⋯ menu open](../attachments/widget-cards.png)

## The header, left to right

- The **title**. This is also the drag handle.
- `⌄` **Show widget controls** — only when **Settings ▸ Widget ▸ Collapse widget controls behind a chevron** is on (off by default). Everything after this point then hides behind it.
- The **controls row** — one control per visible parameter, on its own line directly under the title. It is there whenever the widget has at least one visible parameter. See [[card-parameters|Card Parameters]].
- The **view dropdown**. Its first entry is named for the card's own kind — `Table`, `Chart`, `Markdown`, `HTML`, `Page`, `Metric`, `Note`, `Clock`, `Feed`, `Keys`, or `Default` for a kind it has no name for, such as the Markdown note — and choosing it clears any saved view. Then, when they apply: `Chart`, added to any non-chart card whose rows turn out to contain a time column, or any other axis column with numeric columns beside it; `Raw`, on any card that actually fetches data; and `Transposed`, on table cards. PDF and multi-file cards have no dropdown at all. A saved view the list no longer offers — a chart view whose rows lost their time column, say — is shown as an extra **disabled** entry, so the control never claims to be showing something it is not.
- `⌕` **Filter rows** — table cards only. See [[tables|Tables]].
- **Refresh** — or **Run**, on a widget that declares a run button. See [[running-and-refreshing|Running and Refreshing]].
- `⋯` **Card menu** — only on the cards that carry one; see below.
- `⤢` **Maximize** / `⤡` **Restore**.
- `—` **Minimize card** / `▢` **Expand card**.
- `✕` **Remove card**.

## The ⋯ menu

In order: **Rename…**, **Maximize** (or **Restore**), **Export ▸** (CSV, JSON, Excel), and, while a table is actually on screen, **Columns ▸** and **Reset table**. A widget that declares `exportable: false` has no **Export ▸**; the rest of the menu is unchanged. The menu appears only on cards that fetch data, and never on a PDF card — with one exception: the [[built-in-widgets|Markdown]] note has it too, with **Open file…** and **Save as…** where Export would be. So framed pages, plain notes, clocks, the RSS feed, the keys panel, document viewers and PDFs have none; they can still be renamed by double-clicking the title. Escape or a click outside closes it; reopening it always starts with the flyouts collapsed.

The in-app manual's "Widget cards" topic at this version says every built-in lacks the menu; its own "Built-in widgets" topic, and the code, give the Markdown note one.

## Moving and resizing

**The title is the drag handle.** Dragging anywhere else in the card — including its body — does not move it, which is what lets a table scroll and a chart zoom. Resize from the bottom-right corner, or from all four corners if you turn on **Settings ▸ Layout ▸ Corner drag handles** (that setting also insets the header so the title never sits inside a handle). Position and size are saved when you let go, and only when something actually changed.

## Rename

Double-click the title, or choose **Rename…**. Either way you get the same field: focused, fully selected, **Enter** to save, **Escape** to cancel, clicking away saves, empty or unchanged does nothing. Typing the widget's own name back *removes* the override rather than freezing today's name onto the card, so the card follows the backend again if the widget is renamed upstream. While a custom title is set, hovering it shows the widget's real name. The title is saved per card but is not carried in an `apps.json` export.

## Maximize

Three ways in: the `⤢` button, the menu's **Maximize**, or double-clicking the header's *empty background* — the padding and the gaps between buttons, not the title (that renames) and not a button. The card fills the dashboard area, one at a time per window, and the same card stays mounted throughout, so a chart's zoom, a table's scroll position and a PDF's page all survive.

Maximizing is **never saved**: restarting, or switching dashboard or tab, restores the card. **Escape** restores it too — but only when nothing else wants that press first; see [[keyboard-shortcuts|Keyboard Shortcuts]].

## Minimize

`—` collapses the card to just its title row; the body and the controls row go, the grid slot stays. The button is shown only while **Settings ▸ Widget ▸ Minimize button on header** is on. Minimizing **is** saved, so `▢` **Expand card** is always offered on a minimized card, even in a viewer window and even with the setting off — otherwise a card saved minimized would be stuck that way. Minimize and maximize are mutually exclusive; each undoes the other first.

## Remove

`✕` removes the card immediately. There is **no confirmation and no undo** — unlike deleting a dashboard, a folder or a tab, which all ask first. Removing a card is not available in a viewer window. Removing a card made from a dropped file also deletes the app's stored copy of that file, unless another card still points at it.

## What a card remembers

Per card and per dashboard: its position and size, its custom title, its minimized state, its saved view, its parameters and group links, a table's sort, filters, column order, hidden columns, widths and pins. An `apps.json` export carries the position and size, the parameters, the group links, and a **Chart** or **Transposed** view; the custom title, the minimized state and the table's saved state stay behind.

---
*Source: BDOBB v3.1.0 in-app manual, "Widget cards", "Built-in widgets" and "Settings and logs"; `BDOBB` `src/components/WidgetCard.tsx` at `v3.1.0`; `BDOBB` `src/lib/chartShapes.ts` at `v3.0.6`.*
*See also: [[card-parameters|Card Parameters]] · [[tables|Tables]] · [[built-in-widgets|Built-in Widgets]] · [[import-and-export|Import and Export]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
