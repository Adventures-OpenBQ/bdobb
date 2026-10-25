# The left rail

The rail is the strip down the left edge. It is 48 pixels wide at rest and
expands to 240 when you point at it; it floats over the dashboard rather than
pushing it aside, so nothing reflows. It collapses again about a third of a
second after the pointer leaves — unless you are part-way through renaming
something, in which case it stays open until you finish.

Dragging a widget or a dashboard over the rail expands it too, so you are never
asked to drop onto a 48-pixel sliver.

![The left rail expanded, showing its fixed rows and dashboard list](./shots/the-left-rail.png)

## The rows, top to bottom

- **Add widget (⌘K)** — opens the widget library. Its `+` is the one accented
  icon in the rail.
- **Apps** — discovers backend-served apps and opens them as dashboards, grouped by backend. **Search apps** and the **Backend** select (*All backends*, or one connection that serves apps) narrow the list together. Duplicate names use the import conflict dialog.
- *LIBRARY*
- **Widget Library** — the same overlay as **Add widget**.
- *MY DASHBOARDS*
- Your folders and dashboards.

Pinned to the bottom, always reachable no matter how many dashboards you have:
**Connections**, **Settings**, **Help**.

Only the dashboard list scrolls. The three bottom rows never move.

## Dashboard rows

The first nine dashboards carry an `⌥1` to `⌥9` badge, in the flat order the
rail lists them — which is the order those shortcuts follow, so reordering
dashboards reassigns them. The badge sits where the fixed rows' icons sit, so
it is still visible when the rail is collapsed.

Dashboards past the ninth, and folder rows, show nothing at all while the rail
is collapsed. They are still clickable, and pointing at the rail expands it.

Folders show `▸` when closed and `▾` when open. Clicking a folder row opens or
closes it; it does not select anything.

## Collapsed width

**Settings ▸ Layout ▸ Collapsed rail width** is a slider from 24 to 120 pixels,
default 48. The readout updates as you drag but the value is saved when you let
go, so one adjustment is one write. It applies to every window, including
viewer windows. The expanded width is fixed at 240 and is not a setting.

## What collapses the rail

**Add widget**, **Widget Library**, **Connections** and **Settings** all
collapse the rail before they open, because the expanded rail would otherwise
paint over them. **Help** does not: it opens a small popover anchored to the
row, which the rail is welcome to sit beside. That menu carries two ways in:
**Quick Help (⌘?)**, which opens this manual — one short topic per surface —
and **Reference Manual**, the longer user guide, organised by task and
grouped by section. Choosing either does collapse the rail, on the way to
opening the dialog. Both dialogs have a search box above their topic list:
type a word and the list narrows to the topics that mention it.
