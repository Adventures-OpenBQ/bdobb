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

- *LIBRARY*
- **Widget Library** — opens the widget library (`⌘K` does too).
- **AI Library** — Rita, MCP servers and share targets; see *AI Library*.
- **Apps** — discovers backend-served apps and opens them as dashboards, grouped by backend. **Search apps** and the **Backend** select (*All backends*, or one connection that serves apps) narrow the list together. Duplicate names use the import conflict dialog.
- *WORKSPACES* — always shown, with a **+** that opens the New workspace
  dialog.
- Your workspaces.
- *MY DASHBOARDS*
- Your folders and dashboards.

Pinned to the bottom, always reachable no matter how many dashboards you have:
**Connections**, **Settings**, **Help**.

Only the dashboard list scrolls. The three bottom rows never move.

There is no separate **Add widget** row: while **Settings ▸ Layout ▸ Quick
add toolbar** is on (the default), the green **+** at the right end of the tab
strip adds a widget from wherever you are — the Locked Widgets editor has the
same **+** — and the **Widget Library** row and `⌘K` always open the library.

## Dashboard rows

The first nine dashboards carry an `⌥1` to `⌥9` badge, in the flat order the
rail lists them — which is the order those shortcuts follow, so reordering
dashboards reassigns them. With **Settings ▸ Layout ▸ Option-number
shortcuts** on Workspaces, the badges go to the first nine workspace rows
instead, never to both. The badge sits where the fixed rows' icons sit, so
it is still visible when the rail is collapsed.

Dashboards past the ninth, and folder rows, show nothing at all while the rail
is collapsed. They are still clickable, and pointing at the rail expands it.

Folders show `▸` when closed and `▾` when open. Clicking a folder row opens or
closes it; it does not select anything.

## Workspaces

The *WORKSPACES* heading is there whether or not you have a workspace. Its
**+** opens the New workspace dialog, as **New workspace…** on the rail
background's right-click menu does. Click a workspace row to open it; click
the active one again to go back to a single dashboard. A workspace row's
right-click menu has **Edit…**, **Arrange…**, **Rename**, **Layout**,
**Open at launch**, **Duplicate** and **Delete**.

In a workspace, a click on a dashboard row leaves the workspace and opens that
dashboard alone. To put a dashboard in a tile instead, drag its row onto the
tile, or choose a tile's letter under **Put in panel** on its right-click menu.

While a workspace is open, a lock button at the right end of the *LIBRARY*
heading pins the rail open for that workspace. While a workspace is being
arranged, the rail does nothing until you press **Done** or **Cancel**.

## Collapsed width

**Settings ▸ Layout ▸ Collapsed rail width** is a slider from 24 to 120 pixels,
default 48. The readout updates as you drag but the value is saved when you let
go, so one adjustment is one write. It applies to every window, including
viewer windows. The expanded width is fixed at 240 and is not a setting.

## What collapses the rail

**Widget Library**, **AI Library**, **Connections** and **Settings** all
collapse the rail before they open, because the expanded rail
would otherwise paint over them. **Help** does not: it opens a small popover anchored to the
row, which the rail is welcome to sit beside. That menu carries two ways in:
**Quick Help (⌘?)**, which opens this manual — one short topic per surface —
and **Reference Manual**, the longer user guide, organised by task and
grouped by section. Choosing either does collapse the rail, on the way to
opening the dialog. Below a rule, **Report a Bug…** and **Request a Feature…** open the
project's issue tracker and feature-request board in your browser. Both dialogs have a search box above their topic list:
type a word and the list narrows to the topics that mention it.
