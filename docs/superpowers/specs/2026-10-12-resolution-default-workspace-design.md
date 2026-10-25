# Workspace minimum resolution, uniform zoom and the launch choice

Status: approved design (prototype reviewed 2026-10-12). Supersedes this
file's first revision, which gave each workspace a fixed screen group
(`defaultFor: "uhd" | "fhd"`) chosen from a rail submenu. That revision was
never released, so nothing on disk is migrated.

Platforms: macOS, Windows and Linux desktop builds. iOS/Android keep today's
behaviour (no launch choice; zoom still applies, see §4).

## 1. Decisions

| Question | Decision |
| --- | --- |
| Pixel unit | Logical (scaled) pixels: physical size ÷ scale factor. A 4K panel at 200% is 1920×1080. |
| When the launch choice runs | Once, at launch, in the main window only. |
| Where the settings live | In the workspace file, so they travel with the workspace through Workspace sync. |
| What a workspace says about screens | An optional minimum resolution (W×H), not a screen group. |
| Where the choices come from | The machine's monitors (`availableMonitors()`), then common sizes, Any size and Custom. |
| A screen smaller than the minimum | The workspace still opens: it is laid out at the larger size and zoomed uniformly to fit. |
| Dialog | One Workspaces dialog, like the Art's Charts layout editor: workspaces down the side, the editor on the right. |

## 2. Data model (`src/lib/workspacesFile.ts`)

Two optional keys on `Workspace`, both written only when they say something,
so a workspace that uses neither is byte-for-byte what it was before:

```ts
/** Logical pixels. Absent = Any size. */
minResolution?: { width: number; height: number };
/** Present only as true. */
openAtLaunch?: true;
```

Validation: `minResolution`, when present, must be an object with integer
`width` in 640…15360 and `height` in 480…8640; anything else refuses the
workspace whole, like every other malformed field in this file.
`openAtLaunch`, when present, must be `true`. `MIN_RES_LIMITS` holds the
bounds and the dialog's Custom inputs use the same constant.

`defaultFor` is removed. A stray `defaultFor` on disk (a build of the first
revision) is an unknown key: ignored and kept on write-back, as unknown keys
already are.

Duplicate copies `minResolution` and drops `openAtLaunch`, so a copy never
silently becomes a launch candidate.

## 3. Fit and zoom (`src/lib/screenFit.ts`)

```
zoomFor(screen, min) = min === undefined ? 1 : min(1, screen.w / min.w, screen.h / min.h)
fits(screen, min)    = zoomFor(screen, min) === 1
```

Sizes are compared after rounding to whole logical pixels, because fractional
scale factors (Windows 150%) leave fractions. The comparison is not
orientation-free: a 1080×1920 portrait screen does not fit a 1920×1080
minimum and zooms to 56%.

## 4. Uniform zoom on the grid (`WorkspaceGrid`)

`WorkspaceGrid` measures its area (W×H CSS px) as today. With zoom `s` from
§3, where the screen is `window.screen` in CSS pixels (that is, logical
pixels) and is re-read on `resize`, it renders an inner wrapper
`.workspace-zoom` sized W/s × H/s with CSS `zoom: s`, and lays the 12×12 grid
out at W/s × H/s. The result fills the area with no letterboxing: the
workspace keeps the whole window, and every tile, text and chart inside
shrinks by the same factor.

- CSS `zoom`, not `transform: scale()`: a transform would become the
  containing block for `position: fixed` (the maximized card), the reason
  the grid already sets `useCSSTransforms={false}`. `zoom` is supported by
  WKWebView (macOS), WebView2 (Windows, Chromium) and WebKitGTK (Linux).
- While Arrange mode is on, the zoom is 1. react-grid-layout converts
  pointer deltas from CSS px, so a zoomed grid would drift under the cursor
  on engines that do not rescale event coordinates. Proportions are the
  12×12 grid's either way, so arranging at 100% changes nothing saved.
- The draft's `minResolution` is laid over the saved workspace like every
  other draft field, so changing it in the dialog re-zooms the live grid.
- `data-zoom` on the area carries the percentage for tests and for the
  dialog's notice strip.

### 4.1 Keeping the screen current (`useScreenSize`)

`resize` alone is not enough: dragging the window between two monitors with
the same scale factor but different sizes (a 1080p and a 1440p screen, both
at 100%) changes neither the viewport nor the device pixel ratio, so no
engine is required to fire it, and `window.screen` may lag. So the hook:

- starts from `window.screen` (synchronous, so the first frame is right on
  the common single-screen setup);
- in Tauri, also listens to the window's `onMoved` and `onScaleChanged`
  events, and on mount, on `resize` and after those events (debounced 150 ms,
  as `moved` fires continuously during a drag) re-reads `currentMonitor()`
  and takes its logical size (`size.toLogical(scaleFactor)`);
- falls back to `window.screen` when the monitor read returns null or fails
  (Wayland, the browser build);
- ignores a read that finishes after a newer one has started, and keeps the
  same object when the size is unchanged, so the grid does not re-lay out.

`core:default` already grants the event listeners and `currentMonitor`.

## 5. The launch choice (`pickLaunchWorkspace`)

Among the workspaces with `openAtLaunch`, the ones that fit the launch
screen (§3) are candidates. The one with the largest minimum area wins (Any
size counts as 0); a tie goes to the minimum whose aspect ratio is closest to
the screen's (|ln(min aspect ÷ screen aspect)|), then to rail order. If no
candidate fits, the app opens a single dashboard as it always has.

So with "Desk 1080" (≥1920×1080), "Trading 4K" (≥3840×2160), "Ultrawide"
(≥3440×1440) and "Research" (Any) all marked: a 4K-at-100% screen opens
Trading 4K, a 3440×1440 screen opens Ultrawide, a 1920×1080 screen (including
4K at 200%) opens Desk 1080, and a 1512×982 laptop opens Research.

`readLaunchScreen()` is kept from the first revision: `currentMonitor()`,
then `primaryMonitor()`, then `window.screen`; 1 s deadline; null on
iOS/Android. `bootstrap.openLaunchWorkspace()` logs one line:
`launch screen W×H logical (source) → workspace "Name"` or `→ no workspace
fits`, and switches only from single-dashboard mode.

## 6. The screens list (`listScreens`)

`listScreens()` returns `{ name, width, height, physicalWidth,
physicalHeight, scaleFactor, current }[]` in logical pixels from
`availableMonitors()` (permission `core:window:allow-available-monitors`,
already in `core:window:default`), marking the one `currentMonitor()` names.
Outside Tauri, or when the call fails, it returns `window.screen` alone,
named "This screen". Monitors with the same logical size are merged into one
choice that names them all.

## 7. The Workspaces dialog (`WorkspaceDialog.tsx`)

Header: eyebrow "Workspaces", the workspace's name as the title, the
subtitle "Pick a workspace to open or edit. Any workspace opens on any
screen; larger ones zoom to fit." Close ✕.

Notice strip: a chip — "Fits · 100%" or "Zoom N%" — then "This screen W×H",
then one sentence: "Minimum W×H fits, so it lays out at full size." or
"Minimum W×H is larger than this screen. Lays out at W×H, then zooms
everything to N%." Any size reads "Any size fits every screen."

Sidebar, "Workspaces n": one card per workspace in rail order. Each card has
a thumbnail of its arrangement drawn at its minimum's aspect ratio (16:9 for
Any size), the name, "≥ W×H" or "Any size", and chips: Fits or Zoom N% for
this screen, and Launch when it is the workspace this screen would open at
launch (§5). An edited card shows an unsaved dot. "+ New workspace" (dashed)
is last. A hint under the list explains the drawing and the Launch chip.

Editor (right): Name; Minimum resolution select (Any size; "Your screens"
group from §6 with "· this screen" on the current one; "Common sizes"
1920×1080, 2560×1440, 3440×1440, 3840×2160, 5120×2160; Custom… which shows
W and H inputs bounded by `MIN_RES_LIMITS`); "Open at launch when this is
the best fit for the screen" checkbox; then the existing Layout strip, Show
dashboard names, tile preview and dashboard tree unchanged.

Switching cards with unsaved edits shows a bar above the editor: "Save
changes to "Name" before switching?" with Discard and Save. Save commits and
moves; Discard drops the draft and moves. A new workspace with nothing typed
is not "unsaved".

Footer: a hint ("Open switches to this workspace. Nothing is saved until you
Save or Open."), then Delete (existing workspaces; asks first), Cancel,
Arrange…, Save (commits and stays; disabled while nothing changed), Open
(commits if needed, closes, switches to it — the old Create/Done path).

The dialog opens on the workspace it was asked for (`workspaceId`), or on a
new one for `null`, exactly as today; the rail's Edit and New entries are
unchanged.

## 8. The rail menu

The first revision's "Open at launch ▸ On 4K or higher / On 1920×1080 or
lower" submenu becomes a single checkbox item "Open at launch" that toggles
`openAtLaunch`. The store's `setDefaultFor`/`launchWorkspaceFor` become
`setOpenAtLaunch(id, on)` and `pickLaunchWorkspace(workspaces, screen)`.

## 9. Testing and qualification

Unit (vitest): `screenFit` (zoom, fit, rounding, portrait, launch rule and
every tie-break, `listScreens` merge and fallback, `readLaunchScreen`
unchanged); `workspacesFile` validation; store (draft carries both fields,
commit writes/omits them, Duplicate, `setOpenAtLaunch`); `WorkspaceGrid`
zoom wrapper and Arrange override; dialog sidebar, switching with the dirty
bar, minimum select including Custom, Save vs Open, Delete; rail menu;
bootstrap logging.

Manual, per OS (CI is Ubuntu only): on macOS, Windows and Linux, with one
1080p-class and one 4K-class screen, (1) the Minimum resolution list names
each monitor at its logical size, (2) launch opens the expected workspace on
each, (3) a 4K-minimum workspace on the 1080p screen fills the window at 50%
with readable charts, a maximized card still covers the window, and Arrange
mode shows 100%, (4) moving the window to the other monitor re-zooms.
