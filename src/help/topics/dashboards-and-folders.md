# Dashboards and folders

Everything in this topic hangs off a right-click in the rail's *MY DASHBOARDS*
area. Right-clicking empty space there gives you the section menu;
right-clicking a row gives you that row's own menu.

![The rail's dashboard-row context menu](./shots/dashboards-and-folders.png)

## Creating

The section menu offers **New dashboard**, **New folder** and
**Import apps.json…**. A folder row's menu offers **New dashboard here** and
**New folder here**, which create inside that folder and open it.

Nothing asks you for a name first. A new dashboard is called `Untitled`, then
`Untitled 2`, `Untitled 3` — the first unused one, not the highest plus one —
and the app switches to it. A new folder is created and its name goes straight
into an editable field, ready to type over.

## Renaming

Choose **Rename** from a row's context menu. The row's label becomes a text
field with everything selected, so your first keystroke replaces it.

- **Enter** saves.
- **Escape** cancels.
- Clicking away also saves.
- A name that is empty after trimming, or unchanged, is treated as a cancel.

There is no double-click-to-rename on rail rows. That gesture works on tabs and
on card titles, but not here.

## Duplicating

**Duplicate** makes a deep copy — new ids for the dashboard, every tab, every
card and every parameter group — named `<original> copy`, placed directly after
the original and in the same folder. The app switches to the copy. There is no
de-duplication of that suffix, so duplicating twice leaves you with two
dashboards both called `X copy`.

## Deleting

**Delete** asks first, in a real macOS dialog, not a web one:

- A dashboard: *Delete dashboard "Markets"?*
- A folder: *Delete folder "Research"? Its dashboards move up one level.*

The folder wording is literal — deleting a folder never deletes what is inside
it. Everything one level down is re-parented to wherever the folder was.

There is no undo for either.

## Folders and Move to…

Folders nest as deeply as you like, but the nesting is set when you create
them, with **New folder here**. There is no way to move a folder afterwards.

**Move to ▸** on a dashboard row opens a flyout listing **Top level** first and
then every folder in the app, indented one step per level. Indentation is the
only nesting cue; the item text is just the folder's name.

## Dragging to reorder

Drag a dashboard row onto another dashboard row to reorder, or onto a folder
row to file it there. The row under the pointer highlights. A drag carrying
anything the rail does not recognise is refused outright, so dragging a file
here does nothing.

Because the target's position is read before the dragged row is lifted out, a
drag upward lands *before* its target and a drag downward lands *after* it —
which is how you reach the last slot.

Reordering is mouse-only. It also reassigns the `⌥1`–`⌥9` shortcuts, which
follow this order.

## Disable grouping

The dashboard-row menu's last item is a checkbox, **☐ Disable grouping**. Turn
it on and every control's chain-link greys out: each card falls back to its
own value instead of any shared group value. The groups themselves are kept,
not deleted, so turning it off again restores them intact.

While it is on, the dashboard's tab strip carries a small `grouping off` tag,
so a card quietly ignoring its group is never unexplained.

## Open in a new window

**Open in a new window** opens the dashboard in its own 1200 x 800 native
window at a URL of its own. Asking for the same dashboard again focuses the
window you already have rather than opening a second.

A viewer window shows the tab bar and the grid, and nothing else — no rail, no
quick-add, no library, no context menus.

**What still works there:** switching tabs, editing parameters, per-card
**Refresh**, the `↻` refresh-all button and `⌘R`, maximize and restore,
`⌘?` for this Help, every renderer, and Export.

**What is turned off there:** renaming, adding or closing tabs; removing,
minimizing, dragging or resizing cards; and `⌥1`–`⌥9` / `⌥0`, because the
window is pinned to the one dashboard it was opened for.

**What is memory-only there:** everything else. A parameter you change, a view
you toggle, a layout you nudge — all of it shows on screen and none of it is
written to disk or seen by the main window. Close the window and it is gone.
Settings are the one exception: those are saved, and apply everywhere.
