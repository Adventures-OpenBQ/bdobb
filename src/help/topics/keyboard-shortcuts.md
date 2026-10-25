# Keyboard shortcuts

Every global shortcut below is ignored while you are typing — in a text field,
a text area, a dropdown or anything editable — and while a dialog is open.

## Global

- `⌘K` — Open the widget library. Needs Command on its own: `⌘⇧K` is
  deliberately left to the browser in development builds.
- `⌘R` — Refresh every card on the tab you are looking at. Same as the `↻`
  button in the tab strip. Works in a viewer window. `⌘⇧R` is deliberately left
  alone.
- `⌥1` to `⌥9` — Jump to the first to ninth dashboard in your saved dashboard
  order, which is one flat list: with folders in the rail, that need not be the
  order the rows read from top to bottom. Reordering dashboards reassigns
  these. There is no shortcut for a tenth. Inert in a viewer window, which is
  pinned to one dashboard.
- `⌥0` — Go back to the dashboard you were on before. Inert in a viewer window.
- `⌘?` — Open Quick Help. It only opens; close it with Escape or its `✕`.
  The Reference Manual has no shortcut; it is the second item on the rail's
  Help menu.

## In the widget library

- `⌥0` — Go back to the dashboard and tab the library was opened from, and
  close it.
- `Escape` — Close the library. Anything you clicked is already added.

## In a menu

The right-click menus — a table header's menu, the rail's row and section
menus, the rail's Help menu and the Provider-keys row menu — are all one
component, so they all behave alike.

- The **first enabled item is focused** when the menu opens, so the keyboard
  works without a further click.
- `↑` and `↓` move between items, skipping disabled ones.
- `Enter` or `Space` chooses the focused item.
- `Escape` closes the menu. Escape, choosing an item, and a click on empty
  space all put focus back on whatever you opened the menu from; a click that
  lands on another control leaves focus there instead.

A card's `⋯` menu is its own thing and has none of that: it opens under the
`⋯` button, and Escape or a click outside closes it.

## In a PDF card

- `⌘F` (or `Ctrl+F`) — Open the find bar. This one is not global: it works only
  while the pointer is over a PDF card or that card holds focus.
- `Enter` — Next match. `Shift+Enter` — Previous match.
- `Escape` — Close the find bar. Inside a PDF card this closes *only* the find
  bar; it will not also un-maximize the card.

## In a text field

- `Enter` — Commit a rename. Clicking away does the same.
- `Escape` — Cancel a rename and put the old text back.

## What Escape does when more than one thing is open

One press does exactly one thing. In order:

1. **A rename in progress cancels.** Nothing else sees the press.
2. **An open menu or overlay closes** — the widget library, a card's `⋯` menu,
   a column menu, the rail's right-click menu, the Provider-keys row menu, the
   rail's Help menu. A maximized card underneath stays maximized and restores
   on the next press.
3. **An open dialog closes** — Settings, Connections, Apps, Quick Help or the
   Reference Manual. With one dialog over another (a backend's edit form over
   Connections), only the one on top closes; the one underneath stays
   open with its changes. A menu
   nested *inside* one of them still wins, by rule 2. Escape on Settings is
   **Cancel**: its unsaved changes, an uncommitted **Default widget ticker**
   included, are discarded.
4. **A maximized card restores.**
5. Otherwise, nothing.
