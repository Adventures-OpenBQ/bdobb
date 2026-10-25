---
type: Note
tags: [bdobb, help, ipad, touch, interface, hover, settings]
---

# iPad interface differences

BDOBB's desktop interface, the left rail and the Rita tab that open on hover, assumes a cursor. A fingertip does not hover; it either touches or it does not. This page covers how the app adapts, what it does not do by touch, and how to bring a Mac configuration across. The in-app Help topic **BDOBB on iPad** is the short version.

## Touch mode vs. hover mode

The app asks whether *any* attached pointer can hover, and it asks **reactively**:

- **With a trackpad or a Magic Keyboard attached**, the panels behave exactly as on the desktop: hover to open, move away to close.
- **With touch only**, the app switches to a second dialect: **tap to open, tap anywhere else to close.** A panel holding a text field you are typing in stays open, so a stray tap never folds away a half-written question to Rita. A name you are typing into the rail is the exception: a tap outside commits it, as Enter would, and folds the rail.

The switch is live: dock a keyboard and the running app speaks hover, undock it and it speaks tap, with no setting to change. It is *any* pointer, not the primary one, because iPadOS keeps the primary pointer coarse whatever is docked. At this version some iPads report a hovering pointer with nothing docked (seen on an iPad Pro 11-inch (M5)), and on those the app stays in the desktop dialect; long-press menus still work there, because they look at each press itself rather than at this check.

Either way, inside a workspace the left rail has a **Pin the rail open** control beside its **Library** heading, which holds it open whatever the pointer is. On a tablet that is often better than tapping it open each time. Pinning belongs to the active workspace, so each workspace remembers its own; see [[workspaces|Workspaces and Saved Layouts]].

## Long-press is the right-click

Every context menu in the app (rename, delete, duplicate, export, import, the folder actions) opens on a right-click, and iPadOS sends no right-click for a finger. They sit on a workspace, dashboard or folder in the rail and the space around them, a table's column header, a saved layout in the workspace dialog, and a field in a pivot's Arrange panel. Under touch, **hold a fingertip still for half a second** and the app sends a real right-click at that spot, so the same menu opens. Moving more than ten points first counts as a scroll or a drag instead. The lift that ends the press is swallowed, so the menu that just opened is not closed again at once. On the desktop this listener is not installed at all.

## Card titles

**Tap** a card's `⋯` button for the card menu. With **Settings ▸ Widget ▸ Collapse widget controls** on, tap the `⌄` first to show the controls. **Double-tap** the empty background of a card's header, or tap `⤢`, to maximize the card; double-tap again, or tap `⤡`, to restore it. Double-tapping the title renames the card.

## What is not touch-native

**Rearranging cards by finger is not supported.** A card's title is its drag handle as well as its rename target, and nothing in this version adapts card dragging or resizing to touch. Viewing, reading, charts and Rita all work by touch; rearranging a dashboard wants a trackpad or a Magic Keyboard.

**A hard refresh needs a keyboard.** On a run-button card, `⌘`-click (or Ctrl-click) on `▶` re-runs the last request without adopting your un-run edits; a tap is a plain click, so by touch alone `▶` always runs the edited parameters.

**Pinch-to-zoom is left enabled everywhere**, dense tables included: zooming to read a table is legitimate use. Long-press text selection is suppressed on the app's chrome (the rail, the tab bar, card headers and card actions) and left on inside card bodies, so a figure in a table is still selectable and copyable by touch.

The chrome stays inside the safe area, clear of the status bar and the home indicator; the page's rubber-band overscroll is turned off so it does not fight a dashboard's own scrolling; and iOS's automatic text inflation is pinned off so the layout does not resize under itself.

## Saving files

iPadOS has no save dialog. An export writes the file first, then opens the system picker; choose a place in **Files**, or another app. The temporary copy in the app's own folder is removed afterwards.

## Settings live on the device, and they win

The iPad app keeps its own data, separate from the Mac's, in the same layout inside its own container: `Library/Application Support/com.artcashin.bdobb/`. It survives reinstalls of the same app. A build can carry default connection and Rita URLs, but they are applied only when the file, or the setting, is missing. So if you change a build's default, rebuild, reinstall and see no change, the app is keeping what is already on the device. Change it in the app, or delete the app (which deletes its container) before reinstalling.

## Moving your Mac configuration across

For connections alone, **Export…** in the Mac's Connections dialog and **Import…** in the iPad's carry `backends.json` across without any tools. Because the two folders have the same layout, the whole configuration can also be pushed to the iPad with Apple's device tools:

```bash
xcrun devicectl device copy to --device <udid> \
  --domain-type appDataContainer --domain-identifier com.artcashin.bdobb \
  --source ~/Library/Application\ Support/com.artcashin.bdobb \
  --destination "Library/Application Support/com.artcashin.bdobb"
```

The files that matter are `backends.json`, `folders.json`, `settings.json` and the `dashboards/`, `workspaces/` and `layouts/` folders; [[app-data-and-settings|App Data and Settings]] lists the rest. `chat.json` is Rita history, not a setting. Two traps:

- **The copy flattens.** `copy to` puts the *contents* of the source folder at the destination, so the destination must be the full `…/com.artcashin.bdobb` path. Passing the parent folder lands `backends.json` one level too high, where the app never reads it.
- **Stale dashboards survive a push.** The app lists every file in `dashboards/`, so a dashboard already on the iPad shows up beside the pushed set. `devicectl` has no delete: back the container up with `copy from`, uninstall the app (which wipes its container), reinstall, then push.

The piecemeal route, `apps.json` through the app's own import, works too; see [[import-and-export|Import and Export]].

## What is the same

Everything else: connections, the libraries, every widget, Rita, and the keyboard shortcuts when a keyboard is attached.

---
*Source: `BDOBB` `src/hooks/usePointerKind.ts`, `src/hooks/useHoverPanel.ts`, `src/hooks/useLongPressContextMenu.ts` (`LONG_PRESS_MS` 500, `SLOP_PX` 10), `src/components/LeftRail.tsx`, `src/components/DashboardGrid.tsx` (`draggableHandle`), the iPadOS block of `src/styles.css`, `src/lib/saveTextFile.ts`, `src/lib/jsonStore.ts`, `src/lib/backendsFile.ts`, `src/lib/settingsFile.ts`, `src/lib/dashboardsFile.ts`, `src-tauri/tauri.conf.json` and `src/help/topics/ipad.md`, all at `7.0.0`; Adventures in OpenBB, Ep. 7, "The iPadOS Adventure."*
*See also: [[installing-on-ipad|Installing on iPad]] · [[layout-and-navigation|Layout and Navigation]] · [[workspaces|Workspaces and Saved Layouts]] · [[app-data-and-settings|App Data and Settings]] · [[import-and-export|Import and Export]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
