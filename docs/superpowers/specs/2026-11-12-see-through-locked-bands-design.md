# See-through locked bands

Date: 2026-11-12. Repo: Adventures-OpenBQ/bdobb (first written in `bdobb-dev/bdobb-v2`). Status: approved by the user on 2026-11-12. Approval covers this document only; the implementation plan is not yet written or approved. Updated 2026-11-12 by the implementation plan (docs/superpowers/plans/2026-11-12-see-through-locked-bands.md) with what reading the code settled; see "Settled when writing the plan".

## Intent and decisions

A locked band (Settings ▸ Locked Widgets) reserves a strip of rows at the top or bottom of every dashboard. Today the strip is taken across the full width even where the band holds no card. The user's case: a bottom band 12 rows high whose right half holds the Picture in Picture card; the empty left half should show the dashboard, and the dashboard should be able to use it.

Decided by the user:

- The empty part of a locked band shows the dashboard beneath it.
- Dashboard cards that end up under a locked card are handled with extra scroll room, not by making dashboard cards flow around locked cards.
- Both locked bands, top and bottom. Per-dashboard pinned cards keep their current behaviour.
- One switch per band, off by default. A band with the switch off behaves exactly as today.

## Approaches considered

1. Float the band over the dashboard (selected). When a band's switch is on, the band is laid over the dashboard area instead of taking a strip out of the page column.
2. Keep the band in the column and stretch the dashboard's scroll area under it with negative margins. Same visible result, but it works against the existing rule that keeps the scroll area at least a fifth of the page.
3. Locked cards as obstacles that dashboard cards flow around. Ruled out by the user's choice of scroll room; it would mean rewriting how the dashboard grid lays out.

## Existing structure (read on the v8 line, 2026-11-12)

- The page is a column in `.dashboard-area`: top band, the dashboard's tab bar, a tab's pinned top card, `.dashboard-scroll`, a tab's pinned bottom card, bottom band (`src/App.tsx`, `src/components/DashboardGrid.tsx`, `src/styles.css`). The top band is above the tab bar, so a maximized card leaves it visible.
- `DockBand` (`src/components/DockBand.tsx`) renders one edge's locked cards as a small grid of `dockRows` rows, with a fixed pixel height from `bandHeight`. It paints the page background, has a border on its inner edge, and sits at `z-index: 3`.
- `.dashboard-scroll` takes what the bands leave, with `flex: 1 1 0` and `min-height: 20%`.
- A band taller than the window is capped by `useFitRows` and scrolls its own rows.
- The bands are mounted once in `App`, outside the dashboard switch, and also in viewer windows.
- Row counts are stored in the docks data as `dockRows`, edited in the Locked Widgets editor (`DockEditor`).

File paths are from the v8 carry head the Picture in Picture card was built on and must be re-checked when the plan is written.

## Behaviour with the switch on

- **The band** has no background and no border line. Its locked cards look and behave as now.
- **Empty band space** shows the dashboard and passes clicks, drags and scrolling through to it. Only the locked cards themselves take pointer input.
- **The dashboard's scroll area** runs the full height of the page, beneath both bands.
- **Bottom band:** the dashboard gains scroll room at its end equal to the band's height, so its last rows can be scrolled up clear of the locked cards.
- **Top band:** the dashboard gains the same room at its start and opens scrolled past it. At rest its first rows sit beneath the band, visible in the band's gaps; scrolling up moves them down clear of the locked cards.
- **With the switch off** nothing changes: the band is an opaque strip in the column and the scroll area stops at it.

## The switch

- In the Locked Widgets editor, one "See-through where empty" switch per band.
- Stored in the docks data beside `dockRows`, per edge, absent meaning off. It is saved, synced, and round-trips through the locked-widgets export and import the same way `dockRows` does.

## Cases with a deliberate answer

- **A band that does not fit the window.** Such a band scrolls its own rows today. A see-through band cannot both pass scrolling through and scroll itself, so while the band is capped by the window it behaves as an ordinary opaque band, and becomes see-through again when it fits.
- **The scrollbar.** The dashboard's scrollbar runs the full height and passes under a locked card that sits at the right edge. Today it stops at the band.
- **A maximized card, menus and dialogs** keep their current stacking; the band's level does not change.
- **iPad.** The floating bottom band still sits above the home indicator.
- **Viewer windows.** The same behaviour applies; the switch is read-only there like the rest of the locked widgets.
- **The Picture in Picture card** in a see-through band needs nothing extra, since it reports its own rectangle. Note for any code that positions against the screen on this line: Tauri reports the window's content area as the whole window, and the page starts 32 points lower, at the bottom of the title bar.

## Settled when writing the plan (2026-11-12)

- **Where a floating band lies.** Over the scroll region only. A see-through top band moves from above the tab bar to just below it (and below a tab's pinned top card); a see-through bottom band lies just above a tab's pinned bottom card, which becomes the outermost strip. Done with CSS `order`, so the bands are still mounted once. A maximized dashboard card covers a see-through top band.
- **Local workspaces.** A workspace's area never scrolls and each tile scrolls its own region, so there is no one region to give the room to: every band behaves as opaque while a workspace is shown. Viewer windows show no workspace and float as the main window does.
- **Scroll position.** Nothing saves or restores a dashboard's or tab's scroll; the one scroll element is reused across switches. While a top band floats, the dashboard is set scrolled past the room when the band starts floating and on every dashboard or tab switch, and at no other time.
- **A short tab.** The dashboard grid is kept at least the region's height plus a top band's room, so a short tab still opens scrolled past the room.
- **Export, import and sync.** The switch is `dockSeeThrough` beside `dockRows` in the docks data and `seeThrough` beside `rows` in the apps.json v8 `docks` member, written only for an edge that is on. A build from before the switch keeps a synced copy without it (and uploads it so after an edit there), and imports an exported file with a see-through band as an ordinary dashboard.

## Testing

- Unit tests: the switch's storage and default; export, import and sync round-trips; the band's two modes, including the fallback to opaque while capped by the window.
- Layout tests: the scroll room at each end, the opening scroll position under a top band, and that a band with the switch off is unchanged.
- Existing dock, grid and workspace suites pass.
- Manual acceptance on the Mac and an iPad: empty band space shows the dashboard and takes clicks and drags; cards under a locked card can be scrolled clear at both ends; the too-tall fallback; a viewer window; the Picture in Picture card in a see-through bottom band.

## Placement

- Home line v8, where locked bands first shipped, carried forward from there.
- Built in `Adventures-OpenBQ/bdobb` on its own branch, separate from the Picture in Picture carry.
- The 2026-11-12 release walk was on v7 when this was written. This is not expected to be built, reviewed and accepted before the walk reaches v8, so it is treated as work owed after the walk unless the user says otherwise.

## Documentation

The Locked Widgets help page gains the switch and what it does, on the v8 line.
