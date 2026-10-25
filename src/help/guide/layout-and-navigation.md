---
type: Note
tags: [bdobb, help, interface, layout, navigation, rail]
---

# Layout and Navigation

BDOBB's layout is built around one rule: chrome should never compete with the market for screen space. Every panel that is not actively in use gets out of the way, and nothing that gets out of the way reflows the grid on its way out.

## The left rail

The rail is the strip down the left edge. It rests at 48 pixels wide and expands to 240 when you point at it; it **floats over the dashboard rather than pushing it aside**, so your charts never twitch while you navigate. It collapses again about a third of a second after the pointer leaves — unless you are part-way through renaming something, in which case it stays open until you finish. Dragging a widget or a dashboard over the rail expands it too, so you are never asked to drop onto a 48-pixel sliver.

![The left rail expanded, showing its fixed rows and dashboard list](../attachments/the-left-rail.png)

The fixed rows surround your folders and dashboards. Top to bottom:

- **Add widget (⌘K)** — opens the widget library. Its `+` is the one accented icon in the rail. See [[widget-library|The Widget Library]].
- *LIBRARY*
- **Widget Library** — the same overlay as **Add widget**.
- **Apps** — opens the backend-served app catalog, grouped by backend. **Search apps** and the **Backend** select (*All backends*, or one connection that serves apps) narrow it together. Choose **Open** to import an app as a dashboard; name conflicts ask before writing.
- *WORKSPACES* — always shown, with a **+** that opens the Workspaces dialog. See [[workspaces|Workspaces and Saved Layouts]].
- Your workspaces.
- *MY DASHBOARDS*
- Your folders and dashboards. See [[dashboards-and-folders|Dashboards and Folders]].

The other three fixed rows are pinned to the bottom, always reachable however many dashboards you have: **Connections**, **Settings**, **Help**. Everything above those three scrolls; they never move. The three section labels are shown only while the rail is expanded.

**Help** does not open a dialog directly. It opens a small menu with four items: **Quick Help (⌘?)** and **Reference Manual**, then a rule, then **Report a Bug…**, which opens the project's GitHub issues, and **Request a Feature…**, which opens its feature-request board — both in your browser.

The two help items open two separate dialogs, each with its own search box above its own list. **Quick Help** is the in-app manual: one short topic per surface, written in the same commit as the behaviour it describes. **Reference Manual** is this guide — the longer, task-organised account — which the app now carries with it, so it is there whether or not you are online, and is grouped by the same sections this vault's front page lists. Links between its pages work inside the dialog, and its screenshots are the manual's own. Only Quick Help has a shortcut; the Reference Manual is reached from this menu.

The first nine dashboards carry an `⌥1` to `⌥9` badge where the fixed rows' icons sit, so it is visible even when the rail is collapsed. The number is the dashboard's place in your saved order, which is one flat list — once folders sort the rail into a tree, the badges need not read 1, 2, 3 from top to bottom. Dashboards past the ninth show nothing while the rail is collapsed; pointing at the rail expands it. With **Settings ▸ Layout ▸ Option-number shortcuts** on **Workspaces**, the badges go to the first nine workspace rows instead, never to both.

**Settings ▸ Layout ▸ Collapsed rail width** is a slider from 24 to 120 pixels, default 48. The expanded width is fixed at 240 and is not a setting.

**What collapses the rail:** **Add widget**, **Widget Library**, **Connections** and **Settings** all collapse it before they open, because the expanded rail would otherwise paint over them. **Help** does not — its menu is a small popover anchored to the row.

## The tab strip

Each dashboard has its own strip of tabs directly above the grid, pinned to the top of the dashboard area so a tall dashboard scrolls underneath it. Left to right: the tabs, the add-tab `＋`, a `grouping off` tag if that dashboard has grouping disabled, the parameter-group chips, `↻` (refresh every card on this tab), and the green quick-add `+` (the widget library, one click closer). See [[dashboard-tabs|Dashboard Tabs]].

## Viewer windows

**Open in a new window** on a dashboard's rail menu opens it in its own 1200 × 800 native window: the tab bar and the grid and nothing else — no rail, no library, no Settings. It is a viewer: you can switch tabs, edit parameters, refresh, maximize and export, but renaming, adding, removing, dragging and resizing are off, and nothing you change there is written to disk. At this version it does not follow the main window either: it reads the dashboard once, when it opens, and changes made in the main window after that do not reach it. See [[dashboards-and-folders|Dashboards and Folders]].

## Degraded states

BDOBB is built to fail in pieces:

- **A backend goes offline** — only the cards that depend on it show a retry state; their **Retry** re-runs discovery. Cards on a working connection keep running, and the Connections dialog moves the backend to *Inactive* with a red dot.
- **A widget answers with a shape the app cannot draw** — you get a raw-JSON view of what actually arrived, never a blank card.
- **An app file on disk is unparseable** — it is quarantined as `<name>.corrupt` and the app carries on with defaults rather than overwriting it. A file that could not be *read* at all is a different event: it is left exactly where it is, and the app refuses to save over it for the rest of the session. See [[app-data-and-settings|App Data and Settings]].

One kind of failure is not contained at this version: an error thrown while drawing. The app has no error boundary, so a render error anywhere — one card's renderer included — leaves the whole window blank, and nothing is written to the log about it. Restart the app to redraw it.

## Why the layout works this way

This layout was not the first idea. It came out of a structured design pass that weighed four approaches — wrapping the hosted OpenBB interface, a from-scratch Electron app, a from-scratch Tauri app, and a bespoke chat protocol — before settling on an icon rail plus a folding chat pane, built on OpenBB's own published protocols rather than anything proprietary. The rebuild kept the conclusion; at this version it has built the rail, and there is no chat pane in the app.

---
*Source: BDOBB v3.0.1 in-app manual, "The left rail", "Dashboard tabs", "Dashboards and folders"; `BDOBB` `src/components/LeftRail.tsx`, `src/components/dialogs/HelpDialog.tsx` and `src/App.tsx` at `v3.0.1`; Adventures in OpenBB, Ep. 3 — "I Asked for Electron and Got Talked Out of It."*
*See also: [[dashboards-and-folders|Dashboards and Folders]] · [[widget-library|The Widget Library]] · [[keyboard-shortcuts|Keyboard Shortcuts]]*
