# Workspaces and Saved Layouts

A workspace puts several existing dashboards on screen together. Each panel keeps its own tabs, cards and parameter controls. Focusing one panel does not transfer its card edits to another dashboard. A tile holds the dashboard itself, not a copy, so an edit in one workspace is there wherever you open that dashboard.

![Two dashboards in a Laptop workspace](./shots/workspaces.png)

## Creating and editing

The **+** beside the rail's **Workspaces** heading, **New workspace…** on the
rail background's right-click menu, **File ▸ New Workspace…** in the desktop
app, and `⌥N` all open the **Workspaces** dialog. Every workspace is a card
down its left side, drawn in its layout with its minimum resolution and
whether it fits this screen or opens zoomed. Pick a card to edit it, or
**+ New workspace** to start one. Name it, choose **Full Screen**, **Laptop**
or a saved layout, then click a tile and click a dashboard to put it there;
the selection moves on to the next empty tile. You can also drag a dashboard
onto a tile, or use **＋ New dashboard**, which is made when you save.

**Save** keeps your changes and leaves the dialog open; **Open** saves and
switches to the workspace. Picking another card with unsaved changes asks
whether to save or discard them first. **Cancel** or Escape leaves nothing
behind; **Delete** asks first.

Select a workspace in the rail to open it; click the active one again to go
back to a single dashboard. Its row menu has **Edit…** (the same dialog, on
that workspace), **Arrange…**, **Rename**, **Layout**, **Open at launch**,
**Duplicate** and **Delete**. Removing a workspace does not delete its
dashboards.

Choosing a layout re-seats the dashboards top to bottom, then left to right.
A layout with fewer tiles keeps the rest out of sight, and the dialog and the
Arrange bar say how many, as *1 dashboard not shown in this layout*.

## Tile names

Untick **Show dashboard names** in the dialog to drop each tile's title line.
The tile's `✕`, which empties it without touching the dashboard, then moves to
the far right of its tab bar and shows while the pointer is over the tile.

## Arranging

**Arrange…** covers each tile with a lettered face. Drag a face to move the
tile, a corner to resize it; tiles snap to a 12 × 12 grid that fills the
workspace area. Drop a tile with its middle on another and the two swap places
and sizes. A tile moved or grown into another pushes it down, and a push off
the bottom is refused and everything goes back. The `✕` on a face removes the
tile (never its dashboard); **Add tile** fills the largest free space.
**Done** saves; **Cancel** or Escape puts it all back. The rail, `⌥N`, the
`⌥`-number keys and `⌘K` do nothing until you finish.

**Save layout as…** stores reusable panel geometry, not dashboard data. Saving a layout is a separate action: Cancel after saving it still leaves that saved layout available. Applying a saved layout copies its geometry into a workspace; inspect which dashboards fill the resulting slots.

## Filling a tile

Drag a dashboard from the rail onto a tile, or right-click its row and pick
the tile's letter under **Put in panel**. A plain click on a dashboard in the
rail leaves the workspace and opens that dashboard alone; the workspace is
unchanged when you come back.

Moving the mouse into a tile focuses it: a dashboard you create, duplicate or
import lands there, and a tile holding a dashboard is outlined. **⌘K** adds to
the outlined tile. Each workspace remembers which tab each tile was on.

## Minimum resolution and zoom

**Minimum resolution** in the dialog is the smallest screen a workspace is
laid out for: **Any size**, one of your screens, a common size such as
1920 × 1080, 3840 × 2160 or 3440 × 1440, or **Custom…**. Any workspace opens
on any screen. On a smaller screen it is laid out at its minimum and then
zoomed as a whole to fit, so a 3840 × 2160 workspace on a 1920 × 1080 screen
shows everything at 50%. It never zooms above 100%. **Arrange…** always shows
the tiles at 100%.

The size is the screen's scaled size, not its panel resolution: a 4K panel at
200% (or macOS's "Looks like 1920 × 1080") is 1920 × 1080. Width and height
are compared as they are, so a portrait screen is narrower than a landscape
one.

## Opening a workspace at launch

Tick **Open at launch when this is the best fit for the screen** in the dialog,
or **Open at launch** on the row menu, to put a workspace in the running.
When BDOBB starts it reads the screen it opens on and, among the ticked
workspaces whose minimum fits that screen, opens the one with the largest
minimum; ties go to the closest shape, then to rail order. So you can tick a
1920 × 1080 workspace, a 4K one and an ultrawide one, and each screen opens
its own. If none fits, BDOBB opens a single dashboard as usual. The check runs
once: moving the window to another screen later does not switch workspaces.
Duplicate copies the minimum but not the launch tick. It works in the desktop
app on macOS, Windows and Linux and in the browser.

## Option-number shortcuts

**Settings ▸ Layout ▸ Option-number shortcuts** chooses whether `⌥1`–`⌥9`
select **Dashboards** or **Workspaces**; the rail's `⌥` badges follow.

## A workspace stays on this machine

Workspace definitions and saved layouts persist locally, one file each. They are separate from dashboard apps.json exports, and nothing exports them. Optional User Settings storage on a server (Settings ▸ General ▸ User Settings) syncs display settings, and with a server that offers them your dashboards sync too (see Settings and Logs); workspaces, saved layouts and dropped files are not synchronized. A layout is an arrangement, not a copy of its panels' data.

In a workspace the left rail can be pinned open with the lock beside the rail's first section label, or with **Window ▸ Keep Sidebar Open** in the desktop app. The pin is saved with the workspace, so each workspace remembers its own. Outside a workspace the menu item is greyed out.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
