---
type: Note
tags: [bdobb, help, interface, keyboard, shortcuts, escape]
---

# Keyboard Shortcuts

Every global shortcut below is ignored while you are typing — in a text field, a text area, a dropdown or anything editable — and while a dialog is open. On Windows and Linux builds, read `⌘` as Ctrl.

## Global

| Keys | Does |
|---|---|
| `⌘K` | Open the widget library. Needs Command on its own: `⌘⇧K` is deliberately left to the browser in development builds. |
| `⌘R` | Refresh every card on the tab you are looking at. Same as the `↻` button. Works in a viewer window. |
| `⌥1` … `⌥9` | Jump to the first to ninth dashboard in your saved order — one flat list, so with folders in the rail it need not match the rows top to bottom. Reordering reassigns them. There is no shortcut for a tenth. Inert in a viewer window. |
| `⌥0` | Go back to the dashboard you were on before. Inert in a viewer window. |
| `⌘?` | Open **Quick Help**, the in-app manual. It only opens; close it with Escape or its `✕`. The **Reference Manual** — this guide, carried inside the app — has no shortcut; it is the second item on the rail's Help menu. |

## In the widget library

Opening the library moves the keyboard into it: the **Search widgets** box takes focus, so `⌘K` and then typing goes straight to the search rather than to the dashboard behind. Closing it hands focus back to whatever opened it.

- `⌥0` — Go back to the dashboard and tab the library was opened from, and close it.
- `Escape` — Close the library. Anything you clicked is already added.

## In a menu

The right-click menus — a table header's menu, the rail's row and section menus, the rail's Help menu and the Provider-keys row menu — are all one component, so they all behave alike:

- The **first enabled item is focused** when the menu opens, so the keyboard works without a further click.
- `↑` and `↓` move between items, skipping disabled ones.
- `Enter` or `Space` chooses the focused item.
- `Escape` closes the menu. Escape, choosing an item, and a click on empty space all put focus back on whatever you opened the menu from.

A card's `⋯` menu is its own thing and has none of that: it opens under the `⋯` button, and Escape or a click outside closes it.

## In a table header

`Enter`, `Space`, the Context-Menu key or `Shift+F10` on a focused header opens that column's menu rather than sorting — and **sorting is the first thing in that menu**: **Sort ascending**, **Sort descending** and, once the column is sorted, **Clear sort**, above the pinning items. So a sort is reachable without a pointer, and it follows the same single-and-multi-sort rule a click does. A click on the header still sorts directly. Every sortable header also announces its state to a screen reader, including "not sorted". See [[tables|Tables]].

The **Provider** header in **Settings ▸ Provider keys** is in the Tab order too, and `Enter` or `Space` cycles it the same way a click does. See [[provider-keys|Provider Keys]].

## In a PDF card

- `⌘F` — Open the find bar. Not global: it works only while the pointer is over a PDF card or that card holds focus.
- `Enter` — Next match. `Shift+Enter` — Previous match.
- `Escape` — Close the find bar. Inside a PDF card this closes *only* the find bar; it will not also un-maximize the card.

## In a text field

- `Enter` — Commit a rename. Clicking away does the same.
- `Escape` — Cancel a rename and put the old text back.

## What Escape does when more than one thing is open

One press does exactly one thing. In order:

1. **A rename in progress cancels.** Nothing else sees the press.
2. **An open menu or overlay closes** — the widget library, a card's `⋯` menu, a column menu, the rail's right-click menu, the Provider-keys row menu, the rail's Help menu. A maximized card underneath stays maximized and restores on the next press.
3. **An open dialog closes** — Settings, Connections, Apps, Quick Help or the Reference Manual. With one dialog over another (a backend's edit form over Connections), only the one on top closes; the one underneath stays open with its changes. A menu nested *inside* one of them still wins, by rule 2. Escape on Settings is **Cancel**: its unsaved changes, an uncommitted **Default widget ticker** included, are discarded.
4. **A maximized card restores.**
5. Otherwise, nothing.

---
*See also: [[layout-and-navigation|Layout and Navigation]] · [[widget-cards|Widget Cards]]*
