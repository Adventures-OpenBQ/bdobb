# Dashboard tabs

Each dashboard has its own strip of tabs, directly above the grid. Left to
right it holds the tabs themselves, then the add-tab `＋`, then a `grouping off`
tag if that dashboard has grouping disabled, then `↻`, then the quick-add `+`.

![A dashboard's tab strip with four tabs](./shots/dashboard-tabs.png)

## Adding

The `＋` at the end of the tab list adds a tab immediately, named `Untitled`,
then `Untitled 2`, and so on. It does **not** switch to the new tab — you stay
where you were, which on a wide strip can look like nothing happened.

## Renaming

Double-click a tab. There is no tab context menu and no menu item; the
double-click is the only way in.

The label becomes a text field with everything selected. **Enter** saves,
**Escape** cancels, clicking away saves, and an empty or unchanged name is
treated as a cancel.

## Closing

The `✕` on a tab closes it, after a real macOS confirmation reading
*Delete tab "Overview"?*. Closing a tab you are not looking at does not move
you.

A dashboard is allowed to have no tabs at all. Delete the last one and you get
an empty grid and a strip holding just the `＋`, so you are never stuck.

## Reordering

Drag a tab onto another tab. The whole tab is both the drag source and the drop
target, including its `✕`, so there is no dead strip to catch you out. The
target highlights while you are over it.

The dropped tab takes the target's position as it was *before* the drag, so a
drag leftward lands before the target and a drag rightward lands after it —
dropping the first tab onto the last makes it last. There is no trailing drop
zone and no keyboard equivalent.

Reordering does not change which tab you are looking at, and does not disturb a
maximized card. Tabs cannot be dragged in a viewer window, or while one of them
is being renamed.

## The strip stays put

The tab strip is pinned to the top of the dashboard area. A dashboard taller
than the window scrolls underneath it rather than carrying it off the top of
the screen, so the tabs, `↻` and `+` are always where you left them. It sits
above every ordinary card, and below a maximized card, the widget library, the
expanded rail and any dialog.

## The other two controls

- `↻` refreshes every card on the tab you are looking at. `⌘R` does the same.
- `+` opens the widget library. It is shown only while
  **Settings ▸ Layout ▸ Quick add toolbar** is on, which it is by default.
