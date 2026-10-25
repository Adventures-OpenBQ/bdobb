---
type: Note
tags: [bdobb, help, interface, workspaces, layout, dashboards]
---

# Workspaces and Saved Layouts

A workspace puts several existing dashboards on screen together, as tiles. Each tile holds an ordinary dashboard, with its own tabs, cards and parameter controls. Focusing one tile does not transfer its card edits to another dashboard. A tile holds the dashboard itself, not a copy, so the same dashboard can sit in several workspaces and an edit made in one is there wherever you open it. Within one workspace a dashboard sits in one tile at a time.

![Two dashboards in a Laptop workspace](./shots/workspaces.png)

## Creating and editing a workspace

Every way of making a workspace opens the same **Workspaces** dialog: the **+** beside the rail's **Workspaces** heading, which is there whether or not you have a workspace yet; **New workspace…** on the rail background's right-click menu; **File ▸ New Workspace…** in the desktop app's menu bar; or `⌥N`.

Down the dialog's left side is a card for every workspace, drawn in its layout, with its minimum resolution, a **Fits** or **Zoom** badge for this screen and a **Launch** badge when it opens at launch; **+ New workspace** sits below them. A strip across the top says how the chosen workspace will look on this screen. Beside the cards are the name, filled in with the next free *Untitled* and selected so you can type over it; a strip of layouts, each drawn from its own tiles; **Show dashboard names**; and a preview of the chosen layout as lettered tiles. On the right is your folder tree in the rail's order, with a search field above it and **＋ New dashboard** at the top. Click a tile to select it, then click a dashboard to put it there. The selection moves on to the next empty tile, so filling a two-tile **Laptop** workspace takes two clicks. You can also drag a dashboard onto any tile. A dashboard already in a tile shows that tile's letter at the end of its row, and putting it in a different tile moves it there. **＋ New dashboard** fills the selected tile with a blank dashboard, made when you save and placed at the top level of the rail. A tile's `✕` in the preview empties it, and tiles can be left empty.

Under the name are **Minimum resolution** and **Open at launch when this is the best fit for the screen**; see Quick Help's Workspaces topic for how both work. **Save** keeps your changes and leaves the dialog open; **Open** saves and switches to the workspace. Picking another card with unsaved changes asks whether to save or discard them first. **Cancel**, Escape or the dialog's `✕` leave nothing behind; **Delete** asks first. If saving fails, the dialog says so at the bottom and keeps everything you set, so you can try again; a blank dashboard it had already made by then stays in the rail.

Select a workspace in the rail to open it; click the active one again to go back to a single dashboard, the one whose tile you had focused last. A workspace row's right-click menu has **Edit…**, **Arrange…**, **Rename**, **Layout**, **Open at launch**, **Duplicate** and **Delete**. **Edit…** opens the dialog on that workspace. If it is the workspace on screen, the tiles behind the dialog follow your changes as you make them and go back if you cancel; a **＋ New dashboard** tile shows empty there until you save. **Duplicate** makes a copy named "… copy" that shows the same dashboards; it does not copy them. **Delete** asks first, and deleting a workspace deletes none of its dashboards.

## Changing the layout

**Layout** on a workspace row's menu lists **Full Screen** (one tile) and **Laptop** (two side by side), the current one checked, then your saved layouts. Once a workspace has been arranged by hand, no preset is checked, and the dialog's strip ends with **Custom**, selected, drawn as the tiles are.

Choosing a layout, from **Layout** or from the dialog's strip, re-seats the workspace's dashboards. The ones on screen, read top to bottom and then left to right, take the new layout's tiles in that same order, followed by any the old layout was keeping out of sight; an empty tile passes nothing on. A layout with fewer tiles keeps the rest rather than dropping them, and both the dialog (under its preview) and the Arrange bar say how many, as *1 dashboard not shown in this layout*. They come back as soon as a layout has room for them. The letters on the tiles follow the same reading order.

## Tile names

Each filled tile normally carries a title line above the dashboard's own tabs: the dashboard's name and a `✕` that empties the tile without touching the dashboard. Untick **Show dashboard names** in the workspace's dialog and that line goes from every tile of that workspace, leaving more room for the dashboards. The `✕` is not lost: it moves to the far right of each tile's tab bar and appears while the pointer is over the tile or something inside it has keyboard focus. On a touch screen there is no pointer to bring it up, so empty a tile through **Edit…** instead. The dialog's preview always names its tiles, whatever the box says, because that is how you tell them apart while filling them. Each workspace keeps its own setting.

## Arranging the tiles

**Arrange…** on a workspace row's menu switches to that workspace and puts it in Arrange mode. The dialog's **Arrange…** button saves the dialog first, exactly as **Open** would, and then does the same. A bar appears above the tiles with the workspace's name, the note about hidden dashboards when there are any, **Add tile**, **Save layout as…**, **Cancel** and **Done**. Every tile is covered by a face showing its letter and its dashboard's name, or *Empty*. The dashboards underneath keep running, but nothing in them can be used until you finish. A card you had maximized is restored first.

Drag a face to move its tile, or drag one of its four corners to resize it. Tiles snap to a 12 × 12 grid, drawn faintly behind them, that always fills the workspace area, so an arrangement is shares of the screen rather than pixels and keeps its proportions when the window or the rail changes size. Drop a tile with its middle over another tile, where that tile was when you started dragging, and the two swap places and sizes while nothing else moves; this is how you rearrange a full layout such as **Laptop**. Resizing never swaps. Otherwise a tile moved or grown into another pushes that one down. If the push would send a tile off the bottom, the whole move is refused and every tile goes back where it was, so to grow a tile on a full layout, shrink a neighbour first. The `✕` on a face removes that tile and empties its slot without touching the dashboard; the last tile has no `✕`. **Add tile** puts a new tile in the largest free space at least two cells each way. If the workspace has dashboards the layout is not showing, the new tile shows the first of them; otherwise it is empty. With no such space, **Add tile** is unavailable and its tooltip says *No room. Shrink a tile first.*

**Done** saves the arrangement; **Cancel** or Escape puts everything back as it was. If saving fails, the bar says so and you stay in Arrange mode with your changes intact. While you arrange, the rail, `⌥N`, the `⌥`-number keys and `⌘K` do nothing; `⌘R` still refreshes and `⌘?` still opens Quick Help. A window opened with **Open in a new window** has no rail, so it offers no Arrange.

## Saved layouts

**Save layout as…** on the Arrange bar asks for a name, *Untitled layout* to start with or the next free *Untitled layout 2*, *3*, …, and stores the tiles' shapes as they are at that moment. It stores panel geometry, not dashboards or dashboard data. Saving a layout is a separate action: **Cancel** after saving it still leaves that saved layout available. Names are compared ignoring case and surrounding spaces, so saving under a name you already have asks *Replace the layout "…"?*; say no and you are back at the name. *Full Screen*, *Laptop* and *Custom* cannot be used as a saved layout's name.

Saved layouts appear, by name, in a workspace row's **Layout** submenu after the two built-in ones, and in the dialog's strip after the built-in ones. Choosing one gives the workspace a copy of its tiles and re-seats the dashboards into them in reading order; nothing stays linked, so changing or deleting the saved layout later changes no workspace. Inspect which dashboards fill the resulting tiles. Right-click a saved layout in the dialog's strip to **Rename** it (a name another layout has is refused) or **Delete** it, which asks first.

## Filling a tile

An empty tile reads *Drag a dashboard here, or pick this tile under its row menu's Put in panel.* Drag a dashboard row from the rail onto a tile and the dashboard goes into that tile, whether it is empty or already holds something. Or right-click the dashboard's row and open **Put in panel**, which lists the open workspace's tiles by letter, the same letters the Arrange faces show, with the tile already showing that dashboard checked. Picking a letter puts the dashboard there and focuses it. **Put in panel** is on the menu only while a workspace is open. Either way, a dashboard that was already in another tile of the workspace moves rather than appearing twice.

A plain click on a dashboard row fills nothing. It leaves the workspace and opens that dashboard by itself. The workspace is not changed: open it again and every tile holds what it held, in the arrangement it had. **Open**, the first item on the same row menu, does the same from the keyboard, and so do `⌥1`–`⌥9` and `⌥0` while they select dashboards.

## The focused tile

Moving the mouse into a tile, even onto a card deep inside it, marks that tile as where a dashboard you create, duplicate or import next will land, whether the tile is empty or full. A tile that holds a dashboard is also outlined when it is focused this way; an empty tile has no outline. `⌘K` opens the widget library for the outlined tile's dashboard, so glance at the outline before adding a card in a two-tile layout. Opening a workspace focuses the first tile, in reading order, that holds a dashboard, so `⌘K` has somewhere to go before the mouse has moved.

## Tabs, remembered per tile

Each workspace records which tab each of its dashboards was last on there. Reopening the workspace, or putting a dashboard back in one of its tiles with **Put in panel**, shows that tab again. Outside a workspace nothing is recorded: a dashboard opened on its own, or after a restart, shows its first tab.

## Pinning the rail

In a workspace the left rail can be pinned open with the lock beside the rail's first section label, or with **Window ▸ Keep Sidebar Open** in the desktop app. The pin is saved with the workspace, so each workspace remembers its own. Outside a workspace the menu item is greyed out.

## Option-number shortcuts

`⌥1`–`⌥9` select your first nine dashboards by default; in a workspace that opens the dashboard alone, as a click on its rail row does. **Settings ▸ Layout ▸ Option-number shortcuts** chooses **Dashboards** or **Workspaces**. On **Workspaces** the same nine keys open your first nine workspaces in the rail's order, and `⌥0` goes back to the workspace you were on before. The rail's `⌥` badges move with the setting: dashboard rows carry them for **Dashboards**, workspace rows for **Workspaces**, never both. See [[keyboard-shortcuts|Keyboard Shortcuts]].

## A workspace stays on this machine

Nothing exports a workspace. **Save…** is a dashboard-row item that writes that one dashboard; a workspace row's menu has no export, and the settings bundle carries preferences and the folder tree. Each workspace is one `workspaces/<id>.json` beside your dashboards (see [[app-data-and-settings|App Data and Settings]]), naming the dashboards in its tiles by id, so moving one to another machine means copying that file and the dashboards it points at. Each saved layout is likewise one `layouts/<id>.json`. A layout is an arrangement, not a copy of its panels' data.

Optional User Settings storage on a server (Settings ▸ General ▸ User Settings) syncs display settings, and with a server that offers them your dashboards sync too (see [[settings-and-logs|Settings and Logs]]); workspaces, saved layouts and dropped files are not synchronized.

---
*Source: BDOBB clean v5 `src/components/dialogs/WorkspaceDialog.tsx`, `src/components/WorkspaceGrid.tsx`, `src/components/WorkspaceTile.tsx`, `src/components/WorkspaceArrangeBar.tsx`, `src/components/LeftRail.tsx`, `src/components/railMenu.ts`, `src/components/TabBar.tsx`, `src/hooks/useDashboardShortcuts.ts`, `src/stores/workspacesStore.ts`, `src/lib/workspacePresets.ts`, `src/lib/layoutsFile.ts` and `src/components/dialogs/SettingsDialog.tsx`.*
*See also: [[dashboards-and-folders|Dashboards and Folders]] · [[dashboard-tabs|Dashboard Tabs]] · [[layout-and-navigation|Layout and Navigation]] · [[keyboard-shortcuts|Keyboard Shortcuts]]*
