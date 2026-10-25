# Pinned cards

A pinned card leaves the grid for a full-width band at the top or bottom of
its tab and stays in view while the rest of the tab scrolls — a News wire
along the bottom, say, or a quote across the top. A pin belongs to one tab of
one dashboard; for a widget along an edge of *every* dashboard, see
**Locked widgets**.

![A card pinned to the top of a tab and another to the bottom](./shots/pinned-cards.png)

## Pin and unpin

A card's `⋯` menu has **Pin widget ▸**, with **Pin to top**,
**Pin to bottom** and **Unpin**; the choice the card already has is greyed
out. On a News card the same menu opens from the chevron at the top of its
strip.

There is one band per edge, per tab. Pin a second card to an edge that is
taken and the two swap: the first goes back into the grid. **Unpin** puts a card
back where it was, at the size it had.

## The band

The band runs edge to edge across the dashboard area, outside the part that
scrolls: a top band sits directly under the tab bar, a bottom band at the
bottom of the area however short the tab is. It starts as tall as the card
was in the grid, up to 40% of the dashboard area (or of its tile in a
workspace); a taller card is shown at that cap and its body scrolls inside the
band. Two grips on its inner edge — the bottom corners of a top band, the top
corners of a bottom band — make it taller or shorter, a row at a time, never
below two rows and never past the cap; the outer edge is the dashboard's own
and does not move. The height you drag to is the card's own grid height, and
the cap only limits what the band shows, so **Unpin** returns the card at its
full size. A maximized pinned card is not held to the cap. A minimized pinned card
shrinks its band to the header.

A pinned card is a card like any other: Refresh, Parameters, Rename, Export
and Maximize all work as they do in the grid. **Maximize** covers the bands
too, and **Escape** puts it back. A locked Rita pane narrows the bands with
the dashboard. In a workspace, each tile's dashboard has its own bands inside
its tile. A viewer window shows pinned cards but offers no **Pin widget ▸**
and no grips.

## What carries a pin

The pin is saved with the dashboard, and the dashboard sync carries it to
your other devices; a BDOBB 7 install on the same account still syncs the
dashboard, without the pin. **Save…** in the **BDOBB Workspace** format
carries it in BDOBB's v8 extension, so such a file opens in BDOBB 8.0.0 or
later; **Save…** in the **Strict OpenBB Workspace** format writes no pin. **Duplicate** and
**Copy to ▸** never copy the pin: the copy lands in the grid.

Rita can pin too: her `pin_card` tool pins a card to the top or bottom of its
tab, or unpins it, and the change is one step on her Undo bar. See **Rita**.

The example *Example Dashboard - Version 8.0.0 - Pinned Cards*,
`docs/examples/v8.0.0-pinned.apps.json`, pins a Note to the top and a Clock to
the bottom over a long Markdown card you can scroll beneath them. It uses
built-ins only and opens in BDOBB 8.0.0 or later.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
