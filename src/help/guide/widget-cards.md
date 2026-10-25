---
type: Note
tags: [bdobb, help, interface, widgets, cards, header]
---

# Widget Cards

A card is one widget on the grid. Everything you can do to it lives in its header, and at this version the header is **one line**: a timer on the left, then the title, then the card's parameters as chips, then the buttons for this card's kind. The separate controls row under the title is gone — the chips replaced it — and so is the separate **Refresh** button, whose job the timer took.

![A card's title bar with its ⋯ menu open](../attachments/widget-cards.png)

## The header, left to right

- The **timer** — `◷`, or `▶` on a widget that declares a run button. Click it to refresh (or run); `⌘`-click (or Ctrl-click) on a run-button card refreshes without adopting the edited parameters, as `⌘`-clicking **Run** always did. Its colour is the state of what is on screen: green when the answer is current, orange when it is older than the refresh interval in force for that card or the last fetch failed, muted when the card has not fetched yet. A card with no interval in force never goes orange on age — only on a failure. Its tooltip is the reading — *Last refresh 5 minutes ago · 21 Sep 2026, 09:14*, or *Click to retry* after a failure, or *Click to run · Last run: … · ⌘-click: hard refresh* on a run-button card. It is also read out to assistive technology, which a `title` alone never reaches. It is not drawn on a card where a click would refresh nothing — an iframe, a note, the clock, the keys card, a server-side table. See [[running-and-refreshing|Running and Refreshing]].
- The **Parameters chevron** — `▸` after the timer on every card with parameters, `▾` while the docked Parameters panel is open. See [[card-parameters|Card Parameters]].
- The **title**. This is also the drag handle; double-click it to rename.
- The **parameter chips** — one per visible parameter, on the title line itself, each showing its *value* with its name in the tooltip, and, on a card whose widget needs one, an **FY ends** chip as the last of them. They wrap onto a second line when the title bar is too narrow to hold them. See [[card-parameters|Card Parameters]].
- `⌄` **Show widget controls** — only when **Settings ▸ Widget ▸ Collapse widget controls** is on (off by default). The chips and everything after this point then hide behind it.
- The **view dropdown**. Its first entry is named for the card's own kind — `Table`, `Chart`, `Markdown`, `HTML`, `Page`, `Metric`, `Note`, `Clock`, `Feed`, `Keys`, or `Default` for a kind it has no name for, such as the Markdown note — and choosing it clears any saved view. Then, when they apply: `Chart`, added to any non-chart card whose rows turn out to contain a time column, or any other axis column with numeric columns beside it; `Calendar`, on any card whose rows have a date column (see [[calendar-view|Calendar View]]); `Raw`, on any card that actually fetches data; and `Transposed`, on table cards. PDF and multi-file cards have no dropdown at all. A saved view the list no longer offers — a chart view whose rows lost their time column, say — is shown as an extra **disabled** entry, so the control never claims to be showing something it is not.
- `⌕` **Filter rows** — table cards only. See [[tables|Tables]].
- The **Rita** badge — only on a card you have shared with Rita for this conversation, and only while **AI Library ▸ Agents ▸ Context sharing** is on. See [[rita-chat|Rita (AI Chat)]].
- `⋯` **Card menu** — on every card whose widget resolved; see below.
- `⤢` **Maximize** / `⤡` **Restore**.
- `—` **Minimize card** / `▢` **Expand card**.
- `✕` **Remove card**.

Unlike earlier versions, the chevron now hides the parameters too: a collapsed card that still showed its chips would defeat the point of collapsing it.

## The ⋯ menu

**Every card whose widget resolved has this menu now** — framed pages, plain notes, clocks, the RSS feed, the keys panel, document viewers and PDFs included. **Rename…** and **Maximize** live in it unconditionally, so a card with nothing to export still needs it. Only a card whose widget could not be resolved at all has none.

In order:

- **Rename…** — the same field double-clicking the title gives you. The menu closes with it, because the field replaces the title behind the menu.
- **Parameters** (or **Hide parameters** while it is open) — only when the widget has at least one visible parameter. It opens the same docked Parameters panel the title bar's chevron does: *the same controls as the chips*, this time with their names shown beside them, under the title bar. It is the way to read a row of chips you cannot identify at a glance, and the way to work a card whose title bar is too narrow for them. Focus moves into it when you open it; it stays open until you close it, and whether it is open is saved with the card.
- **Duplicate** — a copy of the card on the same tab, placed below everything already there. It carries the widget, the backend, the parameters and the custom title, and it deliberately does **not** carry the card's group links: a group binding belongs to one card.
- **Copy to ▸** — the same copy, appended to any tab of any dashboard. The flyout lists every dashboard's tabs, shown as `Dashboard › Tab` where the dashboard has more than one. The source card is left alone.
- **Maximize** (or **Restore**).
- **Pin widget ▸** — **Pin to top**, **Pin to bottom** or **Unpin**: the card leaves the grid for a full-width band at that edge of its tab and stays in view while the rest scrolls; one card per edge per tab. Not in a viewer window, and never on a locked widget. See [[locked-and-pinned-widgets|Locked and Pinned Widgets]].
- **Create linked chart** and **Create linked table** — on a table card whose table the app computes itself, never in a viewer window or on a locked widget. Each adds a **Linked chart** or **Linked table** card, below everything on the tab, that reads this card's rows. A linked card has **Choose source** here instead, to point it at another table on the same dashboard. See [[linked-widgets|Linked Widgets]].
- **Share with Rita** (or **Stop sharing with Rita**) — only while **AI Library ▸ Agents ▸ Context sharing** is on, never on an off-limits card (the Provider API Keys table, a settings widget, any widget on a key-maint backend, or a Linked table built on one of those), and never in a viewer window. It marks the card as added to Rita's context and puts the **Rita** badge on its title. See [[rita-chat|Rita (AI Chat)]].
- **Quick actions ▸** — table cards only, while a table is actually on screen: **Autosize columns** and **Reset columns** (what earlier versions called **Reset table**). See [[tables|Tables]].
- **Columns ▸** — table cards only, on the same condition.
- **Export ▸** (CSV, JSON, Excel) — only on cards that fetch data, and never on a PDF card.
- **Open file…** and **Save as…** — the [[built-in-widgets|Markdown]] note only, where Export would be.

**Duplicate** and **Copy to ▸** are not offered in a viewer window, which does not write dashboards, and neither copies a pin: the copy lands in the grid.

Two kinds of card show the menu differently. A **News** card has no header, so the same menu opens from the chevron at the top of the strip down its right edge, with **Configure feeds…**, **Export feeds…** and **Import feeds…** after **Rename…** — see [[news-widget|The News Widget]]. A **locked widget** keeps only what reads or shows it: nothing that would change it — Rename, Parameters, Duplicate, Copy to, Pin widget, Close — is offered outside its band's editor; see [[locked-and-pinned-widgets|Locked and Pinned Widgets]].

Escape or a click outside closes the menu. Reopening it always starts with every flyout collapsed, so it is the same shape each time.

## Moving and resizing

**The title is the drag handle.** Dragging anywhere else in the card — including its body — does not move it, which is what lets a table scroll and a chart zoom. Resize from the bottom-right corner, or from all four corners if you turn on **Settings ▸ Layout ▸ Corner drag handles** (that setting also insets the header so the title never sits inside a handle). Position and size are saved when you let go, and only when something actually changed.

The gap between cards is **Settings ▸ Layout ▸ Dashboard widget spacing**, 1 to 25 pixels, 10 by default.

## Rename

Double-click the title, or choose **Rename…**. Either way you get the same field: focused, fully selected, **Enter** to save, **Escape** to cancel, clicking away saves, empty or unchanged does nothing. Typing the widget's own name back *removes* the override rather than freezing today's name onto the card, so the card follows the backend again if the widget is renamed upstream. While a custom title is set, hovering it shows the widget's real name. The title is saved per card; a **Strict OpenBB Workspace** `apps.json` export does not carry it, and the **BDOBB Workspace** format does. Double-clicking is never the only way in at this version: every resolved card carries the `⋯` menu, so **Rename…** is always reachable too.

## Maximize

Three ways in: the `⤢` button, the menu's **Maximize**, or double-clicking the header's *empty background* — the padding and the gaps between buttons, not the title (that renames) and not a button. The card fills the dashboard area, one at a time per window, and the same card stays mounted throughout, so a chart's zoom, a table's scroll position and a PDF's page all survive.

Maximizing is **never saved**: restarting, or switching dashboard or tab, restores the card. **Escape** restores it too — but only when nothing else wants that press first; see [[keyboard-shortcuts|Keyboard Shortcuts]].

## Minimize

`—` collapses the card to just its title row; the body goes and the chips go with it, the grid slot stays. The button is shown only while **Settings ▸ Widget ▸ Minimize button on header** is on. Minimizing **is** saved, so `▢` **Expand card** is always offered on a minimized card, even in a viewer window and even with the setting off — otherwise a card saved minimized would be stuck that way. Minimize and maximize are mutually exclusive; each undoes the other first.

## Remove

`✕` removes the card immediately, with no confirmation — unlike deleting a dashboard, a folder or a tab, which all ask first. A *Card removed.* notice then offers **Undo**, which puts the card back where it was, and **Dismiss**. Only the most recent removal can be undone, and only until the app closes. Removing a card is not available in a viewer window. Removing a card made from a dropped file also deletes the app's stored copy of that file, unless another card still points at it.

## What a card remembers

Per card and per dashboard: its position and size, its custom title, its minimized state, its saved view, its parameters and group links, its **FY ends** override when one is set, and a table's sort, filters, column order, hidden columns, widths and pins. An `apps.json` export carries the position and size, the parameters, the group links, the **FY ends** override, and a **Chart** or **Transposed** view; the custom title, the minimized state and the table's saved state stay behind.

---
*See also: [[card-parameters|Card Parameters]] · [[tables|Tables]] · [[built-in-widgets|Built-in Widgets]] · [[import-and-export|Import and Export]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
