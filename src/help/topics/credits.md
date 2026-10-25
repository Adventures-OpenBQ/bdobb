# Credits

BDOBB is Apache-2.0 and stands on other people's open source, most importantly
the work of the team at OpenBB. Without their efforts, there would be nothing
to work from.

Everything the app bundles is listed, with its licence text, in
`THIRD_PARTY_NOTICES.md` at the root of the repository: every JavaScript
package and Rust crate the app ships, regenerated from the lockfiles, and
checked on every release by `node scripts/third-party-notices.mjs --check`.
The pieces below ask to be named where you can see them, or are too large a
part of the app to leave out.

## Lightweight Charts™ by TradingView

The **TradingView** chart card (OpenBB's `advanced_charting` widget) and the
**Live Chart** card (live-grid's `live_chart`) are drawn
with **TradingView Lightweight Charts™**, Copyright (c) TradingView, Inc.,
<https://www.tradingview.com/>, licensed under the Apache License 2.0. Every
chart they draw carries the visible credit *Rendered by TradingView*, linked to
<https://www.tradingview.com/lightweight-charts/>, as that library's licence
asks. The app does not offer a way to hide it.

## "Pivot" by Matt Garbarino

The icon on a table card's **Pivot** button is **"Pivot" by Matt Garbarino,
from the Noun Project**, released under the Creative Commons Attribution 3.0
licence. Source: <https://thenounproject.com/icon/pivot-115905/>. It is cropped
to its artwork and drawn in the interface's own colour; nothing else about it
is changed. The Pivot button's tooltip credits it too.

## "Layout" by M Yudi Maulana

The icon beside each workspace in the left rail is **"Layout" by M Yudi
Maulana, from the Noun Project**, released under the Creative Commons
Attribution 3.0 licence. Source: <https://thenounproject.com/icon/layout-3135559/>.
It is cropped to its artwork, its three panes are left open rather than filled,
and it is drawn in the interface's own colour; nothing else about it is
changed.

## "connection" by Muh Syafri

The icon on the **Connections** row of the left rail is **"connection" by Muh
Syafri, from the Noun Project**, released under the Creative Commons
Attribution 3.0 licence. Source: <https://thenounproject.com/icon/connection-8239243/>.
It is cropped to its artwork and drawn in the interface's own colour; nothing
else about it is changed.

## "ai" from Siemens Industrial Experience icons

The icon on the **AI Library** row of the left rail is the "ai" icon from
**Siemens Industrial Experience icons**, Copyright (c) 2022 Siemens AG,
released under the MIT licence. Source: <https://github.com/siemens/ix-icons>.
It is drawn in the interface's own colour; nothing else about it is changed.

## The larger pieces

Each under its own licence, and each reproduced in the notices file:

- **OpenBB Platform**: the data layer every widget speaks to, and the author
  of the `widgets.json` and `apps.json` formats the app reads.
- **Tauri**: the desktop shell, its HTTP, file, dialog and opener plugins.
- **React**, **Zustand** and **react-grid-layout**: the interface, its state
  and the dashboard grid.
- **TanStack Table** and **TanStack Virtual**: tables, sorting, filtering and
  scrolling large results.
- **Plotly.js**: chart cards.
- **React Aria Components** and **@internationalized/date** (Adobe): the
  date, period and fiscal pickers on card parameters.
- **PDF.js** (Mozilla): the PDF viewer.
- **BlockNote** and **Mantine**: the Markdown card's editor.
- **SheetJS**: Excel export, and reading a spreadsheet dropped on the app.

OpenBB and the OpenBB "BB" mark are trademarks of OpenBB Inc.; the mark is
used only to identify OpenBB connections.

*Source: BDOBB 6.0.0 `NOTICE`, `THIRD_PARTY_NOTICES.md`, `package.json`,
`src-tauri/Cargo.toml` and `src/components/renderers/TradingViewRenderer.tsx`.*
