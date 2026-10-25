---
type: Note
tags: [bdobb, help, interface, tabs, dashboards]
---

# Dashboard Tabs

Each dashboard has its own strip of tabs, directly above the grid. Left to right it holds the tabs themselves, then the add-tab `＋`, then a `grouping off` tag if that dashboard has grouping disabled, then a chip for each parameter group the dashboard has, then `↻`, then the quick-add `+`.

![A dashboard's tab strip with four tabs](../attachments/dashboard-tabs.png)

## Adding

The `＋` at the end of the tab list adds a tab immediately, named `Untitled`, then `Untitled 2`, and so on. It does **not** switch to the new tab — you stay where you were, which on a wide strip can look like nothing happened. The one exception is a dashboard that had no tabs: there the new tab becomes the active one, because there was nothing to stay on.

## Renaming

Double-click a tab. There is no tab context menu and no menu item; the double-click is the only way in. The label becomes a text field with everything selected: **Enter** saves, **Escape** cancels, clicking away saves, and an empty or unchanged name is treated as a cancel.

## Closing

The `✕` on a tab closes it, after a real macOS confirmation reading *Delete tab "Overview"?*. Closing a tab you are not looking at does not move you.

A dashboard is allowed to have no tabs at all. Delete the last one and the grid reads *No tab selected. Add one to start.* The strip is still there, holding the `＋`, the `↻` and the quick-add `+`, so you are never stuck.

## Reordering

Drag a tab onto another tab. The whole tab is both the drag source and the drop target, including its `✕`, so there is no dead strip to catch you out; the target highlights while you are over it. The dropped tab takes the target's position as it was *before* the drag, so a drag leftward lands before the target and a drag rightward lands after it — dropping the first tab onto the last makes it last. There is no trailing drop zone and no keyboard equivalent.

Reordering does not change which tab you are looking at, and does not disturb a maximized card. Tabs cannot be dragged in a viewer window, or while one of them is being renamed.

## The strip stays put

The tab strip is pinned to the top of the dashboard area. A dashboard taller than the window scrolls underneath it rather than carrying it off the top of the screen, so the tabs, `↻` and `+` are always where you left them. It sits above every ordinary card, and below a maximized card, the widget library, the expanded rail and any dialog.

## The other two controls

- `↻` refreshes every card on the tab you are looking at. `⌘R` does the same. It is always enabled; on a tab where nothing fetches it is simply a no-op. See [[running-and-refreshing|Running and Refreshing]].
- `+` opens the widget library. It is shown only while **Settings ▸ Layout ▸ Quick add toolbar** is on, which it is by default.

## Cards on other tabs

Cards on tabs you are not looking at are not mounted, and are not refreshed — a tab you switch to fetches when you arrive.

---
## Group chips

Each parameter group on the dashboard has a chip in the strip: its number, its name and its current value, reading `1 Group 1 · AAPL`. The number is the one on the badge of every control in that group. Double-click the name to rename it, in the same inline field as renaming a tab. The chip's `✕` deletes the group after a confirmation reading *Delete group "Group 1"? Its 2 cards keep their current values.* — and they do: each member keeps the value the group was holding.

There are no chips on a dashboard without groups. The chips stay while **Disable grouping** is on, since the groups are kept. In a viewer window they are read-only: no rename, no `✕`. See [[card-parameters|Card Parameters]].

*Source: BDOBB v3.1.0 in-app manual, "Dashboard tabs" and "Running and refreshing."*
*See also: [[dashboards-and-folders|Dashboards and Folders]] · [[widget-library|The Widget Library]] · [[layout-and-navigation|Layout and Navigation]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
