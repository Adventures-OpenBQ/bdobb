---
type: Note
tags: [bdobb, help, interface, dashboards, folders, viewer-window]
---

# Dashboards and Folders

A dashboard is a named set of tabs, each tab a grid of widget cards. Dashboards live in the rail's *MY DASHBOARDS* area, optionally inside folders, and nearly everything you can do to one hangs off a right-click there: right-clicking empty space gives you the section menu, right-clicking a row gives you that row's own menu. At this version "empty space" is narrower than it sounds: the section menu belongs to the *WORKSPACES* and *MY DASHBOARDS* labels and the lists beneath them, and the blank rail below the last row is not part of it, so a right-click there does not open the section menu. Right-click the label instead.

![The rail's dashboard-row context menu](../attachments/dashboards-and-folders.png)

## Creating

The section menu offers **New dashboard**, **New folder**, **New workspace…** and **Import apps.json…**; **New workspace…** opens the Workspaces dialog (see [[workspaces|Workspaces and Saved Layouts]]). A folder row's own menu is **Rename**, **New dashboard here**, **New folder here** and **Delete folder**; the two *here* items create inside that folder and open it. A dashboard row's menu starts with **Open**, which does what a click on the row does, and, while a workspace is open, **Put in panel**; then come **Rename**, **Move to**, **Duplicate**, **Open in a new window**, **Delete**, **Save…**, **Disable grouping** and **Exchange**.

Nothing asks you for a name first. A new dashboard is called `Untitled`, then `Untitled 2`, `Untitled 3` — the first unused one, not the highest plus one — and the app switches to it. A new folder is created with its name already in an editable field, ready to type over.

## Renaming

Choose **Rename** from a row's menu. The label becomes a text field with everything selected, so your first keystroke replaces it. **Enter** saves, **Escape** cancels, clicking away also saves, and a name that is empty after trimming, or unchanged, is treated as a cancel. There is no double-click-to-rename on rail rows; that gesture works on tabs and card titles, but not here.

## Duplicating

**Duplicate** makes a deep copy — new ids for the dashboard, every tab, every card and every parameter group — named `<original> copy`, placed directly after the original in the same folder. The app switches to the copy. There is no de-duplication of that suffix, so duplicating twice leaves two dashboards both called `X copy`.

## Deleting

**Delete** on a dashboard row, or **Delete folder** on a folder row, asks first, in a real macOS dialog rather than a web one — *Delete dashboard "Markets"?* or *Delete folder "Research"? Its dashboards move up one level.* The folder wording is literal: deleting a folder never deletes what is inside it; everything one level down is re-parented to wherever the folder was. There is no undo for either.

## Folders and Move to…

Folders nest as deeply as you like, but the nesting is set when you create them with **New folder here**; there is no way to move a folder afterwards. **Move to ▸** on a dashboard row opens a flyout listing **Top level** first and then every folder in the app, indented one step per level.

Folders show `▸` when closed and `▾` when open. Clicking a folder row opens or closes it; it does not select anything.

## Dragging to reorder

Drag a dashboard row onto another dashboard row to reorder, or onto a folder row to file it there; the row under the pointer highlights. Because the target's position is read before the dragged row is lifted out, a drag upward lands *before* its target and a drag downward lands *after* it — which is how you reach the last slot. Reordering is mouse-only, and it reassigns the `⌥1`–`⌥9` shortcuts, which follow this order. A drag carrying anything the rail does not recognise is refused, so dragging a file here does nothing.

## Disable grouping

The dashboard-row menu has a checkbox, **☐ Disable grouping**, just above **Exchange** (see [[date-expression|Date Expressions]]). Turn it on and every control's chain-link greys out: each card falls back to its own value instead of any shared group value. The groups are kept, not deleted, so turning it off again restores them intact, and the tab strip carries a small `grouping off` tag while it is on so a card quietly ignoring its group is never unexplained.

## Export

**Save…** on a dashboard row writes it as a file; the Save panel's Format pop-up picks **Strict OpenBB Workspace** (the plain OpenBB shape) or **BDOBB Workspace** (which also preserves custom names and ordinary table state). See [[import-and-export|Import and Export]].

## Open in a new window

**Open in a new window** opens the dashboard in its own 1200 × 800 native window at a URL of its own. Asking for the same dashboard again focuses the window you already have rather than opening a second.

A viewer window shows the tab bar and the grid, and nothing else — no rail, no quick-add, no library, and none of the rail's menus. A card's `⋯` menu and a table's column menu still open there.

- **What still works:** switching tabs, editing parameters, per-card **Refresh**, the `↻` button and `⌘R`, maximize and restore, `⌘?` for Help, every renderer, and Export.
- **What is turned off:** renaming, adding or closing tabs; removing, minimizing, dragging or resizing cards; and `⌥1`–`⌥9` / `⌥0`, because the window is pinned to the one dashboard it was opened for.
- **What is memory-only:** everything else. A parameter you change, a view you toggle, a layout you nudge — all of it shows on screen and none of it is written to disk or seen by the main window. Close the window and it is gone. Settings cannot be opened there at all.
- **What it does not follow:** the main window. At this version a viewer window reads the dashboard once, when it opens, and never again. A parameter applied, a card added or a tab renamed in the main window after that does not reach it. That includes a shared group value, so the two windows can show one group's cards on different values. **Refresh** and `⌘R` refetch with the parameters the window opened with. Asking for the same dashboard again focuses the stale window rather than updating it, so close it and open it again to see the dashboard as it is now.

A viewer window that refuses an edit writes one `INFO` line to the log; see [[settings-and-logs|Settings and Logs]].

---
*Source: BDOBB v3.1.0 in-app manual, "Dashboards and folders" and "Keyboard shortcuts."*
*See also: [[dashboard-tabs|Dashboard Tabs]] · [[layout-and-navigation|Layout and Navigation]] · [[importing-dashboards|Importing Dashboards]] · [[card-parameters|Card Parameters]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v5.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
