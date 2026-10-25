# BDOBB on iPad

From 7.0.0, BDOBB runs on iPadOS as well as on the desktop. It is the same app, with the same dashboards, cards, settings and data. With a trackpad or Magic Keyboard the iPad behaves like the desktop: the rail opens on hover and right-click opens menus. Without a pointer, the app switches to a touch dialect.

![BDOBB on an iPad, in portrait](./shots/ipad.png)

## Touch gestures

- **Tap the rail** to open it, and **tap outside** it to close it. The documents rail and the Rita pane behave the same way. A panel holding a text field you are typing in stays open, so a stray tap cannot fold away a half-written question to Rita. Renaming in the rail is the exception: a tap outside commits the name and folds the rail.
- **Long-press** anything that has a right-click menu to open that menu: a workspace, dashboard or folder in the rail (or the space around them), a table's column header, a saved layout in the workspace dialog, or a field in a pivot's Arrange panel. A press of about half a second opens it; moving your finger more than a few points cancels it.
- **Tap** a card's `⋯` button for the card menu. With **Collapse widget controls** on, tap the `⌄` first to show the controls. **Double-tap** the empty background of a card's header, or tap `⤢`, to maximize the card; double-tap again, or tap `⤡`, to restore it. Double-tapping the title renames the card.
- **Drag** inside a card to scroll it, and **pinch** with two fingers anywhere to zoom. Zoom stays enabled everywhere, dense tables included.

A long press on the app's chrome (the rail, the tab bar, a card header) does not offer to copy its label. The figures inside a card stay selectable and copyable by touch.

## Layout

The app fills the screen to its edges and keeps its controls inside the safe area: nothing sits under the status bar, and the rail's bottom row (Help) stays above the home indicator while the rail's background runs to the bottom edge. Overlays (the Widget and AI Libraries, the Rita pane, the drop veil) start below the status bar.

## Saving files

iPadOS has no save dialog. When you export (a card's data, a dashboard's apps.json, a Markdown card's **Save as…**, the Rita chat), BDOBB writes the file first and then opens the system picker. Choose a place in **Files**, or another app, with **Save to Files** or the share options. The temporary copy in the app's own folder is removed afterwards.

## Try it

`docs/examples/v7.0.0-touch.apps.json` is a one-tab dashboard built for the gestures above: a Note that lists them, a four-zone Clock and a long Markdown card to scroll and pinch. It uses built-in widgets only, so it works with no backend connected. Import it as any other apps.json (see **Import and Export**).

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
