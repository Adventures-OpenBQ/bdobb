# Window Portal Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in "Window Portal" card that reserves space on a dashboard. On the macOS desktop app, BDOBB moves and sizes Chrome's floating `Picture in Picture` player over the card, hands it back when the card goes away, and offers a mute button that steps the source tab's `Volume Level` slider.

**Architecture:** There are two units. The native controller is a new Rust module, `src-tauri/src/window_portal/`. Its platform-neutral `logic.rs` holds the geometry, the placement state machine and the mute bookkeeping behind two small traits. `ax.rs` implements those traits on macOS through hand-written Accessibility, CoreFoundation and CoreGraphics declarations. `mod.rs` exposes five Tauri commands that answer "not supported" off macOS. The card is a new renderer, `src/components/renderers/WindowPortalRenderer.tsx`, plus a thin invoke layer, `src/lib/windowPortal.ts`. It measures its body every frame and sends a rectangle only when the rectangle changes. It releases the player when it unmounts or when it is fully out of view. Its header carries a mute button.

**Tech Stack:** Rust (Tauri 2.12.5, serde, objc2 0.6, raw FFI to ApplicationServices, CoreFoundation and CoreGraphics), React 19 + TypeScript, Vitest 2 + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-12-window-portal-card-design.md` (approved 2026-11-12). Read it before any task. Its probe results are facts, and this plan encodes them.

## Global Constraints

- **No new crate versions and no lock change.** `git diff --stat src-tauri/Cargo.lock` must print nothing after every task. A direct dependency on an already-locked crate is NOT lock-neutral. Verified 2026-11-12 on a scratch copy: adding `core-foundation = "0.10"` adds the line `"core-foundation 0.10.1",` to `bdobb`'s entry in `Cargo.lock`, and `cargo … --locked` against the committed lock then fails. So the Accessibility, CoreFoundation and CoreGraphics calls are hand-written `extern "C"` declarations with `#[link(name = "…", kind = "framework")]`. Do not add or change anything in `src-tauri/Cargo.toml`, including features. Chrome's process id comes from `objc2` `msg_send!` to `NSRunningApplication`, and `objc2` and `objc2-foundation` (feature `NSString`) are already direct macOS dependencies.
- **macOS only.** All native window code is `#[cfg(target_os = "macos")]`. On iOS, Windows and Linux the same five commands exist and answer `{ "state": "not_supported" }` (fit) or `{ "state": "unavailable", … }` (mute). `logic.rs` compiles everywhere, so CI's Linux `cargo test` runs its tests.
- **No change** to window transparency, `macOSPrivateApi`, `tauri.conf.json`, `src-tauri/capabilities/*.json` or `src-tauri/build.rs`.
- **Capabilities: none needed.** `build.rs` is a bare `tauri_build::build()` with no `AppManifest`. Tauri 2 therefore allows every command in `generate_handler!` without a permission entry. The three existing custom commands (`video_wrapper_port`, `set_window_pin`, `save_workspace_panel`) have no entry in `capabilities/default.json` or `ios.json`. `scripts/generate-capabilities.mjs` only writes `share-folders.json` for fs scopes.
- **Never call a Tauri window method while holding the controller's lock.** The window event handler runs on the main thread. Read `inner_position`, `scale_factor` and `is_minimized` first, then lock.
- **Coordinates.** Accessibility (AX) coordinates and `CGDisplayBounds` are global, top-left origin, in points. The card's rectangle is `getBoundingClientRect()` in CSS pixels, relative to the webview, which fills the window's content area. Screen point = `inner_position / scale_factor` + CSS rectangle. This line has no webview page zoom: no `setZoom` and no zoom hotkeys. It does have a workspace zoom (CSS `zoom: var(--ws-zoom)` on the workspace grid, spec 2026-10-12 §4). `getBoundingClientRect()` already reports post-zoom viewport pixels, and `WorkspaceTile.tsx` relies on the same fact. So no zoom factor is applied anywhere.
- **Probe facts encoded verbatim:** bundle id `com.google.Chrome`; player window title exactly `Picture in Picture`; size limits min 284 × 160, max 1388 × 781 (measured on 1736 × 1133), 16:9 locked, width wins; restore order is move fully on-screen, then set size, then set position; the mute slider is `AXSlider` titled `Volume Level` in the Chrome window whose title contains the source text; its `AXValue` reads like `100%`; `AXDecrement` and `AXIncrement` move it 10% per step; setting `AXValue` directly does nothing; the page's `Mute` button cannot be pressed.
- **Platform detection.** Copy the line's existing checks. `isTauri()` from `@tauri-apps/api/core` is false in the browser build, where it is replaced by `src/browser-shim/core.ts`. `import.meta.env.TAURI_ENV_PLATFORM` is `"darwin"` on the macOS desktop app (see `LeftRail.tsx`) and `"ios"` on iPad (see `saveTextFile.ts` and `screenFit.ts`). Anything else, Windows and Linux included, gets the placeholder.
- **Carry-friendly edits.** This plan is cherry-picked onto v9, v10 and main, where `WidgetCard.tsx`, `builtins.ts`, `lib.rs`, `home.md` and `guide.test.ts` differ. Edits to those files are a few lines each, at the anchors named in the tasks. Everything else is in new files. Do not reformat or reorder anything in the shared files.
- **New source files carry the house header** as their first two lines (`scripts/header-check.sh`):
  `// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.`
  `// SPDX-License-Identifier: AGPL-3.0-only`
- **Scrub.** No absolute home-directory paths in any committed file. Write `<worktree>` or `~` instead (`scripts/scrub-check.sh`).
- **Commits.** One commit per task, made in the worktree on its own branch. Never push. End each commit message with the attribution line your session's instructions give.
- **Gates.** These mirror `.github/workflows/ci.yml`'s build and scrub jobs. Run them from the worktree root:
  - `pnpm typecheck`
  - `pnpm lint` (only a new ESLint violation fails)
  - `pnpm knip` (`knip.json`: an unused file or dependency fails; unused exports only warn, but add none)
  - `pnpm test:run`
  - `pnpm test:web`
  - `pnpm build:web`
  - `NODE_OPTIONS=--max-old-space-size=6144 pnpm build`
  - `cargo check --locked` and `cargo test --locked` in `src-tauri`
  - `pnpm notices:check`
  - `pnpm scrub` (scrub check plus header check)
  - `git diff --stat src-tauri/Cargo.lock`, which must be empty
  - `git status --short`, which must be clean after the commit

  `.githooks/pre-push` mentions a `pnpm check` script. None exists on this line, so do not look for it.

## Review Focus

1. **A fit still in flight when the card scrolls out or is removed.** The release must reach the controller after that fit. Otherwise an invisible card holds the player. Task 5 pins this with a deferred fit that the release must wait behind.
2. **A player that started partly off the right edge.** It must come back exactly where it was, which takes the probe's order: move on-screen, size, position. Task 1 pins `restore_ops` and the round trip through `Portal`.
3. **Chrome refusing the requested size.** The 1388 maximum is 80% of the 1736-wide probe display, so it probably varies by display. The player must still end up centred in the card, using the size Chrome actually applied. Task 1 pins this with a fake that clamps the width.
4. **The user changes the volume in the player after BDOBB muted it.** The button must follow the slider, and a later Unmute must not jump to a stale level. Task 2 pins this.
5. **Two portal cards on screen.** The second card shows "in use" and must not steal the player. A release from the second card does nothing. Once the first card releases, the second card's three-second recheck takes the player. Task 1 pins the controller side.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src-tauri/src/window_portal/logic.rs` | create | `Rect`, `Status`, `MuteState`, `Op`, geometry functions, `PlayerWindow` and `VolumeSlider` traits, `Portal<W>` and `Mute<V>` state machines, and all native unit tests |
| `src-tauri/src/window_portal/ax.rs` | create | macOS only: FFI declarations, `AxWindow: PlayerWindow`, `AxSlider: VolumeSlider`, `ask_for_permission()`, and one ignored smoke test against the real player |
| `src-tauri/src/window_portal/mod.rs` | create | The five Tauri commands, `release_all()`, and (macOS) the two locked controllers plus the window event hook |
| `src-tauri/src/lib.rs` | modify | `mod window_portal;`, five names in `generate_handler!`, and `RunEvent::Exit` calls `release_all()` |
| `src/lib/windowPortal.ts` | create | Platform check, settings defaults, rectangle equality and typed `invoke` wrappers |
| `src/lib/windowPortal.test.ts` | create | Tests for the above |
| `src/components/renderers/WindowPortalRenderer.tsx` | create | Card body (macOS fitting and states, iPad hint, placeholder) and the header mute button |
| `src/components/renderers/WindowPortalRenderer.test.tsx` | create | Every card state, mute button, ordering of fit and release |
| `src/lib/builtins.ts` | modify | One `BUILTIN_WIDGETS` entry and one import |
| `src/lib/builtins.test.ts` | modify | One test |
| `src/components/WidgetCard.tsx` | modify | One import, one body branch, one header element |
| `src/components/WidgetCard.test.tsx` | modify | One dispatch test |
| `src/help/guide/window-portal.md` | create | Help guide page |
| `src/help/guide/home.md` | modify | One bullet under Widgets |
| `src/help/topics/built-in-widgets.md` | modify | One `## Window Portal` section (the in-repo reference manual, `src/help/index.ts`) |
| `src/help/guide.test.ts` | modify | Page count 44 → 45, and one content test |

---

### Task 1: Geometry and the placement state machine (pure Rust, test-first)

**Files:**
- Create: `src-tauri/src/window_portal/logic.rs`
- Create: `src-tauri/src/window_portal/mod.rs` (two lines for now; Task 4 replaces it)
- Modify: `src-tauri/src/lib.rs:4-6` (module list)

**Interfaces:**
- Consumes: nothing.
- Produces (all in `crate::window_portal::logic`, all `pub`):
  - `struct Rect { x: f64, y: f64, width: f64, height: f64 }`: `Clone, Copy, Debug, PartialEq, Deserialize, Serialize`.
  - `enum Status { Fitted, NoPermission, NoPlayer, InUse, TooSmall, ViewerWindow, NotSupported, Failed { reason: String } }`, serialised with `#[serde(tag = "state", rename_all = "snake_case")]`.
  - `enum Op { Move(f64, f64), Size(f64, f64) }`.
  - `const MIN_SIZE: (f64, f64) = (284.0, 160.0)` and `const MAX_SIZE: (f64, f64) = (1388.0, 781.0)`.
  - `fn to_screen(css: Rect, origin: (f64, f64)) -> Rect`
  - `fn fit_16x9(area: Rect) -> Option<Rect>`
  - `fn restore_ops(saved: Rect, display: Rect) -> [Op; 3]`
  - `trait PlayerWindow { fn trusted(&self) -> bool; fn frame(&mut self) -> Result<Option<Rect>, String>; fn apply(&mut self, op: Op) -> Result<(), String>; fn display_bounds(&self, rect: Rect) -> Rect; }`
  - `struct Portal<W>` with `fn new(window: W) -> Self`, `fn fit(&mut self, card: &str, css: Rect, origin: (f64, f64)) -> Status`, `fn refit(&mut self, origin: (f64, f64)) -> Option<Status>`, `fn suspend(&mut self) -> bool`, `fn release(&mut self, card: &str) -> bool`, `fn release_all(&mut self)`.

- [ ] **Step 1: Prepare the worktree for cargo**

`tauri::generate_context!` reads `../dist`, so the crate does not compile until the frontend has been built once. The worktree also has no `node_modules`. Follow CI's order:

```bash
cd <worktree>
pnpm install --frozen-lockfile
test -x .pivot-tools/bin/wasm-bindgen || cargo +1.98.1 install wasm-bindgen-cli --version 0.2.128 --locked --root .pivot-tools
pnpm pivot:build
NODE_OPTIONS=--max-old-space-size=6144 pnpm build
```

Expected: each command exits 0, and `dist/index.html` exists. Keep cargo output in `src-tauri/target`, which is gitignored. Do not set `CARGO_TARGET_DIR` to `/tmp` or `$TMPDIR`.

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, change lines 4-6 from:

```rust
mod migrate;
mod save_panel;
mod video_wrapper;
```

to:

```rust
mod migrate;
mod save_panel;
mod video_wrapper;
mod window_portal;
```

Create `src-tauri/src/window_portal/mod.rs`:

```rust
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

#[allow(dead_code)]
mod logic;
```

Task 4 replaces this file. Until then `logic` has no caller, which is why it carries `allow(dead_code)`.

- [ ] **Step 3: Write the failing tests**

Create `src-tauri/src/window_portal/logic.rs` containing only the test module below and the `use` line it needs. The types do not exist yet.

```rust
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

#[cfg(test)]
mod tests {
    use super::*;

    const DISPLAY: Rect = Rect { x: 0.0, y: 0.0, width: 1736.0, height: 1133.0 };
    /// Partly off the right edge (1600 + 400 > 1736), as in the probe.
    const ORIGINAL: Rect = Rect { x: 1600.0, y: 100.0, width: 400.0, height: 225.0 };
    const CARD: Rect = Rect { x: 10.0, y: 20.0, width: 640.0, height: 400.0 };
    const ORIGIN: (f64, f64) = (100.0, 50.0);

    fn r(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.01
    }

    /// Chrome's floating player as the probe found it: position and size
    /// settable, 16:9 locked with the width winning, and a width it refuses
    /// past `max_width`.
    struct FakeWindow {
        trusted: bool,
        frame: Option<Rect>,
        ops: Vec<Op>,
        max_width: f64,
    }

    impl FakeWindow {
        fn with_player() -> Self {
            Self { trusted: true, frame: Some(ORIGINAL), ops: Vec::new(), max_width: f64::INFINITY }
        }
    }

    impl PlayerWindow for FakeWindow {
        fn trusted(&self) -> bool {
            self.trusted
        }
        fn frame(&mut self) -> Result<Option<Rect>, String> {
            Ok(self.frame)
        }
        fn apply(&mut self, op: Op) -> Result<(), String> {
            self.ops.push(op);
            let frame = self.frame.as_mut().ok_or_else(|| "no player".to_string())?;
            match op {
                Op::Move(x, y) => {
                    frame.x = x;
                    frame.y = y;
                }
                Op::Size(width, _) => {
                    frame.width = width.min(self.max_width);
                    frame.height = frame.width * 9.0 / 16.0;
                }
            }
            Ok(())
        }
        fn display_bounds(&self, _rect: Rect) -> Rect {
            DISPLAY
        }
    }

    #[test]
    fn to_screen_adds_the_window_origin() {
        assert_eq!(to_screen(r(10.0, 20.0, 300.0, 200.0), (100.0, 50.0)), r(110.0, 70.0, 300.0, 200.0));
    }

    #[test]
    fn fit_16x9_takes_the_largest_centred_16x9_rectangle() {
        let wide = fit_16x9(r(0.0, 0.0, 1000.0, 400.0)).unwrap();
        assert!(close(wide.width, 711.11) && close(wide.height, 400.0) && close(wide.x, 144.44) && close(wide.y, 0.0));
        assert_eq!(fit_16x9(r(0.0, 0.0, 400.0, 1000.0)), Some(r(0.0, 387.5, 400.0, 225.0)));
    }

    #[test]
    fn fit_16x9_stays_within_the_measured_limits() {
        assert_eq!(fit_16x9(r(0.0, 0.0, 3000.0, 2000.0)), Some(r(806.0, 609.625, 1388.0, 780.75)));
        assert_eq!(fit_16x9(r(0.0, 0.0, 284.0, 160.0)).map(|f| f.width), Some(284.0));
        assert_eq!(fit_16x9(r(0.0, 0.0, 283.0, 500.0)), None);
        assert_eq!(fit_16x9(r(0.0, 0.0, 500.0, 159.0)), None);
    }

    #[test]
    fn restore_ops_move_on_screen_then_size_then_position() {
        assert_eq!(restore_ops(ORIGINAL, DISPLAY), [Op::Move(1336.0, 100.0), Op::Size(400.0, 225.0), Op::Move(1600.0, 100.0)]);
        let on_screen = r(100.0, 100.0, 400.0, 225.0);
        assert_eq!(restore_ops(on_screen, DISPLAY), [Op::Move(100.0, 100.0), Op::Size(400.0, 225.0), Op::Move(100.0, 100.0)]);
        // A display left of the main one has negative x.
        let left = r(-1920.0, 0.0, 1920.0, 1080.0);
        assert_eq!(restore_ops(r(-300.0, 500.0, 400.0, 225.0), left)[0], Op::Move(-400.0, 500.0));
    }

    #[test]
    fn fit_moves_then_sizes_then_centres_in_screen_points() {
        let mut portal = Portal::new(FakeWindow::with_player());
        assert_eq!(portal.fit("a", CARD, ORIGIN), Status::Fitted);
        // Card at (110, 70) 640 × 400 on screen; 640 × 360 centred vertically.
        assert_eq!(portal.window.ops, vec![Op::Move(110.0, 90.0), Op::Size(640.0, 360.0), Op::Move(110.0, 90.0)]);
        assert_eq!(portal.window.frame, Some(r(110.0, 90.0, 640.0, 360.0)));
    }

    #[test]
    fn fit_centres_on_the_size_chrome_actually_allowed() {
        let mut window = FakeWindow::with_player();
        window.max_width = 500.0;
        let mut portal = Portal::new(window);
        assert_eq!(portal.fit("a", r(0.0, 0.0, 1200.0, 800.0), (0.0, 0.0)), Status::Fitted);
        assert_eq!(portal.window.ops.last(), Some(&Op::Move(350.0, 259.375)));
    }

    #[test]
    fn release_by_the_holder_restores_a_player_that_was_partly_off_screen() {
        let mut portal = Portal::new(FakeWindow::with_player());
        portal.fit("a", CARD, ORIGIN);
        assert!(portal.release("a"));
        assert_eq!(portal.window.ops[3..], [Op::Move(1336.0, 100.0), Op::Size(400.0, 225.0), Op::Move(1600.0, 100.0)]);
        assert_eq!(portal.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn a_second_card_neither_steals_nor_releases_the_player() {
        let mut portal = Portal::new(FakeWindow::with_player());
        portal.fit("a", CARD, ORIGIN);
        let before = portal.window.ops.len();
        assert_eq!(portal.fit("b", CARD, ORIGIN), Status::InUse);
        assert!(!portal.release("b"));
        assert_eq!(portal.window.ops.len(), before);
        assert!(portal.release("a"));
        assert_eq!(portal.fit("b", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn no_permission_and_no_player_touch_nothing() {
        let mut window = FakeWindow::with_player();
        window.trusted = false;
        let mut portal = Portal::new(window);
        assert_eq!(portal.fit("a", CARD, ORIGIN), Status::NoPermission);
        assert!(portal.window.ops.is_empty());

        let mut window = FakeWindow::with_player();
        window.frame = None;
        let mut portal = Portal::new(window);
        assert_eq!(portal.fit("a", CARD, ORIGIN), Status::NoPlayer);
        assert_eq!(portal.refit(ORIGIN), None);
    }

    #[test]
    fn a_card_too_small_for_the_player_hands_it_back() {
        let mut portal = Portal::new(FakeWindow::with_player());
        portal.fit("a", CARD, ORIGIN);
        assert_eq!(portal.fit("a", r(0.0, 0.0, 200.0, 100.0), ORIGIN), Status::TooSmall);
        assert_eq!(portal.window.frame, Some(ORIGINAL));
        assert_eq!(portal.fit("b", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn suspend_hands_the_player_back_and_refit_takes_it_again() {
        let mut portal = Portal::new(FakeWindow::with_player());
        portal.fit("a", CARD, ORIGIN);
        assert!(portal.suspend());
        assert_eq!(portal.window.frame, Some(ORIGINAL));
        assert!(!portal.suspend());
        assert_eq!(portal.refit(ORIGIN), Some(Status::Fitted));
        assert_eq!(portal.window.frame, Some(r(110.0, 90.0, 640.0, 360.0)));
        portal.release("a");
        assert_eq!(portal.window.frame, Some(ORIGINAL));
    }
}
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd <worktree>/src-tauri && cargo test --locked window_portal::logic`
Expected: compile errors such as ``cannot find type `Rect` in this scope`` and ``cannot find function `fit_16x9` ``.

- [ ] **Step 5: Write the implementation**

Insert this above the `#[cfg(test)]` line in `logic.rs`:

```rust
//! The Window Portal's platform-neutral half (spec
//! docs/superpowers/specs/2026-11-12-window-portal-card-design.md): the
//! geometry, the placement state machine and the mute bookkeeping. Nothing
//! here names macOS. `ax.rs` implements the two traits on macOS, and a later
//! Windows design can implement them there.

use serde::{Deserialize, Serialize};

/// Chrome's floating player, measured 2026-11-12 on a 1736 × 1133 display
/// (spec, "What the probe measured"). The maximum may scale with the display
/// (1388 is 80% of 1736), so `Portal::place` centres on the size Chrome
/// reports back rather than trusting this constant.
pub const MIN_SIZE: (f64, f64) = (284.0, 160.0);
pub const MAX_SIZE: (f64, f64) = (1388.0, 781.0);

/// Points, top-left origin. From the card it is CSS pixels relative to the
/// window's content; from the player it is global screen points.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What `fit` tells the card: `{ "state": "fitted" }`,
/// `{ "state": "failed", "reason": "…" }` and so on.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Status {
    Fitted,
    NoPermission,
    NoPlayer,
    InUse,
    TooSmall,
    ViewerWindow,
    /// Built only by the commands off macOS.
    #[allow(dead_code)]
    NotSupported,
    Failed { reason: String },
}

/// One call on the player window.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Move(f64, f64),
    Size(f64, f64),
}

pub fn to_screen(css: Rect, origin: (f64, f64)) -> Rect {
    Rect { x: origin.0 + css.x, y: origin.1 + css.y, ..css }
}

/// The largest 16:9 rectangle inside `area`, centred and no wider than
/// MAX_SIZE; None when even MIN_SIZE does not fit.
pub fn fit_16x9(area: Rect) -> Option<Rect> {
    let width = area.width.min(area.height * 16.0 / 9.0).min(MAX_SIZE.0);
    if width < MIN_SIZE.0 {
        return None;
    }
    let height = width * 9.0 / 16.0;
    Some(Rect {
        x: area.x + (area.width - width) / 2.0,
        y: area.y + (area.height - height) / 2.0,
        width,
        height,
    })
}

/// The probe's restore order: macOS clamps a resize to the screen at the
/// player's current position, so first move to where `saved` fits wholly on
/// `display`, then size, then put it back exactly.
pub fn restore_ops(saved: Rect, display: Rect) -> [Op; 3] {
    let x = saved.x.min(display.x + display.width - saved.width).max(display.x);
    let y = saved.y.min(display.y + display.height - saved.height).max(display.y);
    [Op::Move(x, y), Op::Size(saved.width, saved.height), Op::Move(saved.x, saved.y)]
}

/// The floating player, behind whatever reaches it on this platform.
pub trait PlayerWindow {
    fn trusted(&self) -> bool;
    /// None while no floating player is open.
    fn frame(&mut self) -> Result<Option<Rect>, String>;
    fn apply(&mut self, op: Op) -> Result<(), String>;
    /// The display holding the centre of `rect`, else the main display.
    fn display_bounds(&self, rect: Rect) -> Rect;
}

/// Which card holds the player, where the player was before, and the
/// card's last rectangle for re-fits after a window move.
pub struct Portal<W> {
    window: W,
    holder: Option<String>,
    saved: Option<Rect>,
    last: Option<Rect>,
    suspended: bool,
}

impl<W: PlayerWindow> Portal<W> {
    pub fn new(window: W) -> Self {
        Self { window, holder: None, saved: None, last: None, suspended: false }
    }

    pub fn fit(&mut self, card: &str, css: Rect, origin: (f64, f64)) -> Status {
        if !self.window.trusted() {
            return Status::NoPermission;
        }
        if self.holder.as_deref().is_some_and(|holder| holder != card) {
            return Status::InUse;
        }
        let Some(target) = fit_16x9(to_screen(css, origin)) else {
            self.release(card);
            return Status::TooSmall;
        };
        let frame = match self.window.frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => {
                self.forget();
                return Status::NoPlayer;
            }
            Err(reason) => return Status::Failed { reason },
        };
        if self.holder.is_none() || self.suspended {
            self.saved = Some(frame);
        }
        self.holder = Some(card.to_owned());
        self.last = Some(css);
        self.suspended = false;
        match self.place(target) {
            Ok(()) => Status::Fitted,
            Err(reason) => Status::Failed { reason },
        }
    }

    /// Top-left first, so the resize is not clamped where the player was,
    /// then the size, then centred on what Chrome actually allowed.
    fn place(&mut self, target: Rect) -> Result<(), String> {
        self.window.apply(Op::Move(target.x, target.y))?;
        self.window.apply(Op::Size(target.width, target.height))?;
        let actual = self.window.frame()?.unwrap_or(target);
        self.window.apply(Op::Move(
            target.x + (target.width - actual.width) / 2.0,
            target.y + (target.height - actual.height) / 2.0,
        ))
    }

    /// Re-fits the holder with its last rectangle (BDOBB's window moved,
    /// resized or came back from the Dock). None when no card holds it.
    pub fn refit(&mut self, origin: (f64, f64)) -> Option<Status> {
        let card = self.holder.clone()?;
        let css = self.last?;
        Some(self.fit(&card, css, origin))
    }

    /// BDOBB minimised: hand the player back but remember the card, so the
    /// next refit takes it again. True when this call handed it back.
    pub fn suspend(&mut self) -> bool {
        if self.holder.is_none() || self.suspended {
            return false;
        }
        self.restore();
        self.suspended = true;
        true
    }

    /// True when `card` held the player and it has been handed back.
    pub fn release(&mut self, card: &str) -> bool {
        if self.holder.as_deref() != Some(card) {
            return false;
        }
        self.release_all();
        true
    }

    pub fn release_all(&mut self) {
        self.restore();
        self.forget();
    }

    fn forget(&mut self) {
        self.holder = None;
        self.saved = None;
        self.last = None;
        self.suspended = false;
    }

    fn restore(&mut self) {
        let Some(saved) = self.saved.take() else { return };
        for op in restore_ops(saved, self.window.display_bounds(saved)) {
            if let Err(error) = self.window.apply(op) {
                eprintln!("window portal: cannot restore the player: {error}");
                return;
            }
        }
    }
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd <worktree>/src-tauri && cargo test --locked window_portal::logic`
Expected: `test result: ok. 11 passed; 0 failed`.

- [ ] **Step 7: Check the lock and commit**

```bash
cd <worktree>
git diff --stat src-tauri/Cargo.lock   # expected: no output
bash scripts/header-check.sh            # expected: header-check: clean
git add src-tauri/src/lib.rs src-tauri/src/window_portal/mod.rs src-tauri/src/window_portal/logic.rs
git commit -m "feat(window-portal): placement geometry and state machine"
```

---

### Task 2: Mute bookkeeping (pure Rust, test-first)

**Files:**
- Modify: `src-tauri/src/window_portal/logic.rs`

**Interfaces:**
- Consumes: `logic.rs` from Task 1.
- Produces (in `crate::window_portal::logic`, all `pub`):
  - `enum MuteState { Sound, Muted, Unavailable { reason: String } }`, serialised with `#[serde(tag = "state", rename_all = "snake_case")]`.
  - `const STEP_PERCENT: u8 = 10` and `const FULL_VOLUME: u8 = 100`.
  - `fn steps(from: u8, to: u8) -> u32`
  - `fn parse_percent(text: &str) -> Option<u8>`
  - `trait VolumeSlider { fn level(&mut self, source: &str, label: &str) -> Result<u8, String>; fn step(&mut self, source: &str, label: &str, up: bool, count: u32) -> Result<(), String>; }`
  - `struct Mute<V>` with `fn new(slider: V) -> Self`, `fn state(&mut self, source: &str, label: &str) -> MuteState`, `fn set(&mut self, source: &str, label: &str, muted: bool) -> MuteState`, `fn restore(&mut self)`.

- [ ] **Step 1: Write the failing tests**

Append these inside `mod tests` in `logic.rs`, after the last Task 1 test:

```rust
    /// The page's Volume Level slider: AXDecrement / AXIncrement move it 10%
    /// per step and stop at 0 and 100.
    struct FakeSlider {
        level: u8,
        broken: Option<String>,
        steps: Vec<(bool, u32)>,
    }

    impl FakeSlider {
        fn at(level: u8) -> Self {
            Self { level, broken: None, steps: Vec::new() }
        }
    }

    impl VolumeSlider for FakeSlider {
        fn level(&mut self, _source: &str, _label: &str) -> Result<u8, String> {
            self.broken.clone().map_or(Ok(self.level), Err)
        }
        fn step(&mut self, _source: &str, _label: &str, up: bool, count: u32) -> Result<(), String> {
            self.steps.push((up, count));
            let moved = u32::from(STEP_PERCENT) * count;
            let level = u32::from(self.level);
            let next = if up { (level + moved).min(100) } else { level.saturating_sub(moved) };
            self.level = next as u8;
            Ok(())
        }
    }

    const SRC: &str = "CNBC";
    const LABEL: &str = "Volume Level";

    #[test]
    fn steps_round_up_to_whole_ten_percent_steps() {
        assert_eq!(steps(100, 0), 10);
        assert_eq!(steps(95, 0), 10);
        assert_eq!(steps(0, 55), 6);
        assert_eq!(steps(30, 30), 0);
    }

    #[test]
    fn parse_percent_reads_the_slider_text() {
        assert_eq!(parse_percent("100%"), Some(100));
        assert_eq!(parse_percent(" 40 % "), Some(40));
        assert_eq!(parse_percent("0%"), Some(0));
        assert_eq!(parse_percent("150%"), Some(100));
        assert_eq!(parse_percent("abc"), None);
        assert_eq!(parse_percent(""), None);
        assert_eq!(parse_percent("NaN%"), None);
    }

    #[test]
    fn mute_records_the_level_and_unmute_returns_to_it() {
        let mut mute = Mute::new(FakeSlider::at(70));
        assert_eq!(mute.set(SRC, LABEL, true), MuteState::Muted);
        assert_eq!(mute.slider.level, 0);
        assert_eq!(mute.slider.steps, vec![(false, 7)]);
        assert_eq!(mute.set(SRC, LABEL, false), MuteState::Sound);
        assert_eq!(mute.slider.level, 70);
        assert_eq!(mute.slider.steps[1], (true, 7));
    }

    #[test]
    fn a_level_off_the_ten_percent_grid_comes_back_on_it() {
        let mut mute = Mute::new(FakeSlider::at(95));
        mute.set(SRC, LABEL, true);
        assert_eq!(mute.slider.level, 0);
        mute.set(SRC, LABEL, false);
        assert_eq!(mute.slider.level, 100);
    }

    #[test]
    fn the_slider_is_the_state_when_the_user_changes_the_volume_in_the_player() {
        let mut mute = Mute::new(FakeSlider::at(70));
        mute.set(SRC, LABEL, true);
        mute.slider.level = 40;
        assert_eq!(mute.state(SRC, LABEL), MuteState::Sound);
        mute.slider.level = 0;
        assert_eq!(mute.state(SRC, LABEL), MuteState::Muted);
        // BDOBB did not mute it this time, so there is no recorded 70 to return to.
        mute.set(SRC, LABEL, false);
        assert_eq!(mute.slider.steps.last(), Some(&(true, 10)));
        assert_eq!(mute.slider.level, 100);
    }

    #[test]
    fn an_unreachable_slider_is_unavailable_with_its_reason() {
        let mut slider = FakeSlider::at(70);
        slider.broken = Some("No slider".into());
        let mut mute = Mute::new(slider);
        let unavailable = MuteState::Unavailable { reason: "No slider".into() };
        assert_eq!(mute.set(SRC, LABEL, true), unavailable);
        assert_eq!(mute.state(SRC, LABEL), unavailable);
        assert!(mute.slider.steps.is_empty());
    }

    #[test]
    fn restore_returns_the_volume_only_when_bdobb_muted_it() {
        let mut mute = Mute::new(FakeSlider::at(60));
        mute.set(SRC, LABEL, true);
        mute.restore();
        assert_eq!(mute.slider.level, 60);
        assert_eq!(mute.slider.steps, vec![(false, 6), (true, 6)]);
        mute.restore();
        assert_eq!(mute.slider.steps.len(), 2);
    }

    #[test]
    fn muting_an_already_silent_slider_records_nothing() {
        let mut mute = Mute::new(FakeSlider::at(0));
        assert_eq!(mute.set(SRC, LABEL, true), MuteState::Muted);
        assert!(mute.slider.steps.is_empty());
        mute.set(SRC, LABEL, false);
        assert_eq!(mute.slider.level, 100);
    }
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd <worktree>/src-tauri && cargo test --locked window_portal::logic`
Expected: compile errors such as ``cannot find type `Mute` in this scope`` and ``cannot find function `steps` ``.

- [ ] **Step 3: Write the implementation**

Insert this in `logic.rs` after the `impl<W: PlayerWindow> Portal<W>` block and before `#[cfg(test)]`:

```rust
/// One AXIncrement or AXDecrement moves the page's volume slider this far.
pub const STEP_PERCENT: u8 = 10;
/// Where Unmute goes when BDOBB recorded no level (the user muted in the player).
pub const FULL_VOLUME: u8 = 100;

/// What the mute button shows: `{ "state": "muted" }`,
/// `{ "state": "unavailable", "reason": "…" }` and so on.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum MuteState {
    Sound,
    Muted,
    Unavailable { reason: String },
}

/// Whole steps between two levels, rounded up so a mute always reaches 0.
pub fn steps(from: u8, to: u8) -> u32 {
    u32::from(from.abs_diff(to)).div_ceil(u32::from(STEP_PERCENT))
}

/// The slider's value as Chrome reports it ("100%"), as a whole percent.
pub fn parse_percent(text: &str) -> Option<u8> {
    let value: f64 = text.trim().trim_end_matches('%').trim().parse().ok()?;
    value.is_finite().then(|| value.round().clamp(0.0, 100.0) as u8)
}

/// The volume slider in the stream's tab, behind whatever reaches it.
pub trait VolumeSlider {
    fn level(&mut self, source: &str, label: &str) -> Result<u8, String>;
    fn step(&mut self, source: &str, label: &str, up: bool, count: u32) -> Result<(), String>;
}

struct Recorded {
    source: String,
    label: String,
    level: u8,
}

/// The slider's value is the state (spec, Mute). The only thing kept here is
/// the level BDOBB stepped down from, so that Unmute and release can step
/// back to it.
pub struct Mute<V> {
    slider: V,
    recorded: Option<Recorded>,
}

impl<V: VolumeSlider> Mute<V> {
    pub fn new(slider: V) -> Self {
        Self { slider, recorded: None }
    }

    pub fn state(&mut self, source: &str, label: &str) -> MuteState {
        match self.slider.level(source, label) {
            Err(reason) => MuteState::Unavailable { reason },
            Ok(0) => MuteState::Muted,
            Ok(_) => {
                // Sound again without BDOBB, so nothing is left for it to restore.
                self.recorded = None;
                MuteState::Sound
            }
        }
    }

    /// Answers the state it stepped to rather than re-reading the slider: a
    /// page that applies steps late would otherwise read as "the user turned
    /// it back up" and lose the recorded level. The card's next poll reads
    /// the real value.
    pub fn set(&mut self, source: &str, label: &str, muted: bool) -> MuteState {
        let level = match self.slider.level(source, label) {
            Ok(level) => level,
            Err(reason) => return MuteState::Unavailable { reason },
        };
        let stepped = if muted {
            if level == 0 {
                Ok(())
            } else {
                self.recorded = Some(Recorded { source: source.to_owned(), label: label.to_owned(), level });
                self.slider.step(source, label, false, steps(level, 0))
            }
        } else {
            let to = self.recorded.take().map_or(FULL_VOLUME, |r| r.level);
            if to > level { self.slider.step(source, label, true, steps(level, to)) } else { Ok(()) }
        };
        match stepped {
            Ok(()) if muted => MuteState::Muted,
            Ok(()) => MuteState::Sound,
            Err(reason) => MuteState::Unavailable { reason },
        }
    }

    /// Steps back to the recorded level if BDOBB muted it (spec, Flow 4).
    pub fn restore(&mut self) {
        let Some(recorded) = self.recorded.take() else { return };
        if let Ok(level) = self.slider.level(&recorded.source, &recorded.label) {
            if recorded.level > level {
                let _ = self.slider.step(&recorded.source, &recorded.label, true, steps(level, recorded.level));
            }
        }
    }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd <worktree>/src-tauri && cargo test --locked window_portal::logic`
Expected: `test result: ok. 19 passed; 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd <worktree>
git diff --stat src-tauri/Cargo.lock   # expected: no output
git add src-tauri/src/window_portal/logic.rs
git commit -m "feat(window-portal): mute bookkeeping on the page's volume slider"
```

---

### Task 3: macOS Accessibility implementation

There is no unit test here: CI cannot grant Accessibility or run Chrome (spec, Testing). The gate is that the code compiles, plus one ignored smoke test that the human runs on the real player in Task 8.

**Files:**
- Create: `src-tauri/src/window_portal/ax.rs`
- Modify: `src-tauri/src/window_portal/mod.rs` (declare `ax`)

**Interfaces:**
- Consumes: `logic::{parse_percent, Op, PlayerWindow, Rect, VolumeSlider}`.
- Produces (macOS only, in `crate::window_portal::ax`):
  - `#[derive(Default)] pub struct AxWindow`, which implements `PlayerWindow`.
  - `#[derive(Default)] pub struct AxSlider`, which implements `VolumeSlider`.
  - `pub fn ask_for_permission()`.

- [ ] **Step 1: Write `ax.rs`**

```rust
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! The Window Portal's macOS half: Chrome's floating player and its tab's
//! volume slider, reached through the Accessibility API (spec
//! docs/superpowers/specs/2026-11-12-window-portal-card-design.md).
//!
//! Hand-written declarations, not a bindings crate. No crate in Cargo.lock
//! binds ApplicationServices' AX calls, and naming core-foundation or
//! core-graphics as a dependency would add a line to Cargo.lock, which each
//! release line's dependency pack forbids. AppKit already links all three
//! frameworks; the #[link] attributes only say so.

use std::collections::VecDeque;
use std::ffi::{c_char, c_void, CStr};
use std::ptr;
use std::time::{Duration, Instant};

use super::logic::{parse_percent, Op, PlayerWindow, Rect, VolumeSlider};

const CHROME_BUNDLE_ID: &str = "com.google.Chrome";
/// The floating player's AX title in an English Chrome (spec, "Not verified": other languages).
const PLAYER_TITLE: &str = "Picture in Picture";
const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
/// Nodes visited looking for the slider before giving up.
/// ponytail: fixed cap; make it adaptive if a real page's slider lies deeper.
const SEARCH_LIMIT: usize = 20_000;
/// After a failed search (about 150 ms each), repeat its reason this long instead of searching again.
const SEARCH_COOLDOWN: Duration = Duration::from_secs(5);

type CFTypeRef = *const c_void;
const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
const NUMBER_DOUBLE: isize = 13; // kCFNumberDoubleType
const AX_POINT: u32 = 1; // kAXValueTypeCGPoint
const AX_SIZE: u32 = 2; // kAXValueTypeCGSize
const AX_SUCCESS: i32 = 0;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[allow(non_upper_case_globals)]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    // Only their addresses are used; the type is a stand-in.
    static kCFTypeDictionaryKeyCallBacks: u8;
    static kCFTypeDictionaryValueCallBacks: u8;
    static kCFBooleanTrue: CFTypeRef;
    fn CFRelease(cf: CFTypeRef);
    fn CFRetain(cf: CFTypeRef) -> CFTypeRef;
    fn CFGetTypeID(cf: CFTypeRef) -> usize;
    fn CFStringGetTypeID() -> usize;
    fn CFNumberGetTypeID() -> usize;
    fn CFArrayGetTypeID() -> usize;
    fn CFArrayGetCount(array: CFTypeRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFTypeRef, index: isize) -> CFTypeRef;
    fn CFStringCreateWithBytes(alloc: CFTypeRef, bytes: *const u8, len: isize, encoding: u32, external: u8) -> CFTypeRef;
    fn CFStringGetCString(string: CFTypeRef, buffer: *mut c_char, size: isize, encoding: u32) -> u8;
    fn CFNumberGetValue(number: CFTypeRef, kind: isize, out: *mut c_void) -> u8;
    fn CFDictionaryCreate(
        alloc: CFTypeRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFTypeRef;
}

#[allow(non_upper_case_globals)]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFTypeRef;
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
    fn AXUIElementCreateApplication(pid: i32) -> CFTypeRef;
    fn AXUIElementCopyAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> i32;
    fn AXUIElementSetAttributeValue(element: CFTypeRef, attribute: CFTypeRef, value: CFTypeRef) -> i32;
    fn AXUIElementPerformAction(element: CFTypeRef, action: CFTypeRef) -> i32;
    fn AXValueCreate(kind: u32, value: *const c_void) -> CFTypeRef;
    fn AXValueGetValue(value: CFTypeRef, kind: u32, out: *mut c_void) -> u8;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    fn CGMainDisplayID() -> u32;
}

/// An owned (+1) CoreFoundation reference, released on drop.
struct Cf(CFTypeRef);

impl Cf {
    fn new(raw: CFTypeRef) -> Option<Cf> {
        // `then`, never `then_some`: an eagerly built Cf(null) would be
        // dropped, and CFRelease(NULL) crashes.
        (!raw.is_null()).then(|| Cf(raw))
    }
}

impl Drop for Cf {
    fn drop(&mut self) {
        // SAFETY: Cf only ever holds a non-null reference it owns.
        unsafe { CFRelease(self.0) }
    }
}

// SAFETY: CF retain and release are thread-safe, and every AX call made
// through a Cf happens behind the controller's mutex (mod.rs).
unsafe impl Send for Cf {}

fn cfstr(text: &str) -> Option<Cf> {
    // SAFETY: the bytes are valid UTF-8 for their length; CF copies them.
    Cf::new(unsafe { CFStringCreateWithBytes(ptr::null(), text.as_ptr(), text.len() as isize, UTF8, 0) })
}

fn attr(element: CFTypeRef, name: &str) -> Option<Cf> {
    let name = cfstr(name)?;
    let mut out: CFTypeRef = ptr::null();
    // SAFETY: element is a live AXUIElement; out receives a +1 reference on success.
    let error = unsafe { AXUIElementCopyAttributeValue(element, name.0, &mut out) };
    if error == AX_SUCCESS { Cf::new(out) } else { None }
}

fn set(element: CFTypeRef, name: &str, value: &Cf) -> Result<(), String> {
    let key = cfstr(name).ok_or("cannot build an AX attribute name")?;
    // SAFETY: live element, CFString key, AXValue value.
    match unsafe { AXUIElementSetAttributeValue(element, key.0, value.0) } {
        AX_SUCCESS => Ok(()),
        error => Err(format!("Accessibility refused {name} (error {error})")),
    }
}

fn string(cf: CFTypeRef) -> Option<String> {
    // SAFETY: type-checked before reading; the buffer is NUL-terminated by CF on success.
    unsafe {
        if CFGetTypeID(cf) != CFStringGetTypeID() {
            return None;
        }
        let mut buffer = vec![0u8; 4096];
        (CFStringGetCString(cf, buffer.as_mut_ptr().cast(), buffer.len() as isize, UTF8) != 0)
            .then(|| CStr::from_ptr(buffer.as_ptr().cast()).to_string_lossy().into_owned())
    }
}

fn number(cf: CFTypeRef) -> Option<f64> {
    // SAFETY: type-checked before reading into an f64.
    unsafe {
        if CFGetTypeID(cf) != CFNumberGetTypeID() {
            return None;
        }
        let mut value = 0f64;
        (CFNumberGetValue(cf, NUMBER_DOUBLE, (&mut value as *mut f64).cast()) != 0).then_some(value)
    }
}

fn string_attr(element: CFTypeRef, name: &str) -> Option<String> {
    attr(element, name).and_then(|value| string(value.0))
}

/// An array attribute's elements, each retained.
fn elements(element: CFTypeRef, name: &str) -> Vec<Cf> {
    let Some(array) = attr(element, name) else { return Vec::new() };
    // SAFETY: type-checked; each value is retained before it is wrapped.
    unsafe {
        if CFGetTypeID(array.0) != CFArrayGetTypeID() {
            return Vec::new();
        }
        (0..CFArrayGetCount(array.0))
            .filter_map(|i| Cf::new(CFRetain(CFArrayGetValueAtIndex(array.0, i))))
            .collect()
    }
}

fn value<T: Default>(element: CFTypeRef, name: &str, kind: u32) -> Option<T> {
    let raw = attr(element, name)?;
    let mut out = T::default();
    // SAFETY: kind matches T (AX_POINT for CGPoint, AX_SIZE for CGSize).
    let ok = unsafe { AXValueGetValue(raw.0, kind, (&mut out as *mut T).cast()) } != 0;
    ok.then_some(out)
}

fn ax_value<T>(kind: u32, value: &T) -> Option<Cf> {
    // SAFETY: kind matches T; AX copies the value.
    Cf::new(unsafe { AXValueCreate(kind, (value as *const T).cast()) })
}

fn chrome_pid() -> Option<i32> {
    use objc2::{class, msg_send, rc::autoreleasepool, runtime::AnyObject};
    use objc2_foundation::NSString;
    autoreleasepool(|_| {
        let bundle = NSString::from_str(CHROME_BUNDLE_ID);
        // SAFETY: AppKit's NSRunningApplication class method and getters, with their declared types.
        unsafe {
            let apps: *mut AnyObject =
                msg_send![class!(NSRunningApplication), runningApplicationsWithBundleIdentifier: &*bundle];
            if apps.is_null() {
                return None;
            }
            let first: *mut AnyObject = msg_send![apps, firstObject];
            if first.is_null() {
                return None;
            }
            let pid: i32 = msg_send![first, processIdentifier];
            Some(pid)
        }
    })
}

fn chrome() -> Option<Cf> {
    let pid = chrome_pid()?;
    // SAFETY: returns a +1 AXUIElement for the pid.
    Cf::new(unsafe { AXUIElementCreateApplication(pid) })
}

/// Registers BDOBB in the Accessibility list (the system prompt) and opens
/// the pane, so the user can switch it on.
pub fn ask_for_permission() {
    // SAFETY: a one-entry CFDictionary of CF constants, released when `options` drops.
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let options = Cf::new(CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::addr_of!(kCFTypeDictionaryKeyCallBacks).cast(),
            ptr::addr_of!(kCFTypeDictionaryValueCallBacks).cast(),
        ));
        if let Some(options) = options {
            let _ = AXIsProcessTrustedWithOptions(options.0);
        }
    }
    if let Err(error) = std::process::Command::new("/usr/bin/open").arg(SETTINGS_URL).status() {
        eprintln!("window portal: cannot open System Settings: {error}");
    }
}

/// Chrome's `Picture in Picture` window, cached while it answers.
#[derive(Default)]
pub struct AxWindow {
    player: Option<Cf>,
}

impl AxWindow {
    fn player(&mut self) -> Option<CFTypeRef> {
        let alive = self.player.as_ref().is_some_and(|p| attr(p.0, "AXPosition").is_some());
        if !alive {
            self.player = chrome().and_then(|app| {
                elements(app.0, "AXWindows")
                    .into_iter()
                    .find(|w| string_attr(w.0, "AXTitle").as_deref() == Some(PLAYER_TITLE))
            });
        }
        self.player.as_ref().map(|p| p.0)
    }
}

impl PlayerWindow for AxWindow {
    fn trusted(&self) -> bool {
        // SAFETY: no arguments.
        unsafe { AXIsProcessTrusted() != 0 }
    }

    fn frame(&mut self) -> Result<Option<Rect>, String> {
        let Some(player) = self.player() else { return Ok(None) };
        let position: CGPoint = value(player, "AXPosition", AX_POINT).ok_or("cannot read the player's position")?;
        let size: CGSize = value(player, "AXSize", AX_SIZE).ok_or("cannot read the player's size")?;
        Ok(Some(Rect { x: position.x, y: position.y, width: size.width, height: size.height }))
    }

    fn apply(&mut self, op: Op) -> Result<(), String> {
        let player = self.player().ok_or("the floating player closed")?;
        let (name, raw) = match op {
            Op::Move(x, y) => ("AXPosition", ax_value(AX_POINT, &CGPoint { x, y })),
            Op::Size(width, height) => ("AXSize", ax_value(AX_SIZE, &CGSize { width, height })),
        };
        set(player, name, &raw.ok_or("cannot build an AX value")?)
    }

    fn display_bounds(&self, rect: Rect) -> Rect {
        let (cx, cy) = (rect.x + rect.width / 2.0, rect.y + rect.height / 2.0);
        let mut ids = [0u32; 16];
        let mut count = 0u32;
        // SAFETY: CoreGraphics writes at most 16 ids and reports how many.
        let bounds = unsafe {
            let listed: &[u32] =
                if CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut count) == 0 { &ids[..count as usize] } else { &[] };
            listed
                .iter()
                .map(|&id| CGDisplayBounds(id))
                .find(|b| cx >= b.origin.x && cx < b.origin.x + b.size.width && cy >= b.origin.y && cy < b.origin.y + b.size.height)
                .unwrap_or_else(|| CGDisplayBounds(CGMainDisplayID()))
        };
        Rect { x: bounds.origin.x, y: bounds.origin.y, width: bounds.size.width, height: bounds.size.height }
    }
}

/// The source tab's volume slider, cached while it answers. Chrome exposes
/// only the selected tab's page (spec, probe).
#[derive(Default)]
pub struct AxSlider {
    cached: Option<(String, String, Cf)>,
    missed: Option<(Instant, String)>,
}

impl AxSlider {
    fn element(&mut self, source: &str, label: &str) -> Result<CFTypeRef, String> {
        if let Some((s, l, slider)) = &self.cached {
            if s == source && l == label && attr(slider.0, "AXValue").is_some() {
                return Ok(slider.0);
            }
        }
        self.cached = None;
        if let Some((at, reason)) = &self.missed {
            if at.elapsed() < SEARCH_COOLDOWN {
                return Err(reason.clone());
            }
        }
        match find_slider(source, label) {
            Ok(slider) => {
                let raw = slider.0;
                self.cached = Some((source.to_owned(), label.to_owned(), slider));
                self.missed = None;
                Ok(raw)
            }
            Err(reason) => {
                self.missed = Some((Instant::now(), reason.clone()));
                Err(reason)
            }
        }
    }
}

/// Breadth-first through the Chrome window whose title contains `source`,
/// for an AXSlider named `label`. The probe saw the name as its title;
/// Chrome usually maps a page's aria-label to AXDescription, so both are
/// accepted.
fn find_slider(source: &str, label: &str) -> Result<Cf, String> {
    let app = chrome().ok_or("Chrome is not running")?;
    let window = elements(app.0, "AXWindows")
        .into_iter()
        .find(|w| string_attr(w.0, "AXTitle").is_some_and(|t| t.contains(source)))
        .ok_or_else(|| format!("No Chrome window shows a tab whose title contains \u{201c}{source}\u{201d}. Select the stream's tab in its window."))?;
    let mut queue = VecDeque::from([window]);
    let mut visited = 0;
    while let Some(element) = queue.pop_front() {
        visited += 1;
        if visited > SEARCH_LIMIT {
            break;
        }
        let named = || {
            string_attr(element.0, "AXTitle").as_deref() == Some(label)
                || string_attr(element.0, "AXDescription").as_deref() == Some(label)
        };
        if string_attr(element.0, "AXRole").as_deref() == Some("AXSlider") && named() {
            return Ok(element);
        }
        queue.extend(elements(element.0, "AXChildren"));
    }
    Err(format!(
        "No \u{201c}{label}\u{201d} slider in that tab. The stream's tab must be the selected tab, and the site may have renamed the control."
    ))
}

impl VolumeSlider for AxSlider {
    fn level(&mut self, source: &str, label: &str) -> Result<u8, String> {
        let slider = self.element(source, label)?;
        let raw = attr(slider, "AXValue").ok_or("the volume slider has no value")?;
        number(raw.0)
            .map(|n| n.round().clamp(0.0, 100.0) as u8)
            .or_else(|| string(raw.0).and_then(|s| parse_percent(&s)))
            .ok_or_else(|| "the volume slider's value is not a percentage".to_string())
    }

    fn step(&mut self, source: &str, label: &str, up: bool, count: u32) -> Result<(), String> {
        let slider = self.element(source, label)?;
        let action = cfstr(if up { "AXIncrement" } else { "AXDecrement" }).ok_or("cannot build an AX action name")?;
        for _ in 0..count {
            // SAFETY: live slider element and CFString action name.
            let error = unsafe { AXUIElementPerformAction(slider, action.0) };
            if error != AX_SUCCESS {
                return Err(format!("the volume slider refused a step (error {error})"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Run by hand on a Mac with Chrome's floating player open and
    /// Accessibility granted to the terminal running cargo (Task 8):
    /// cargo test --locked window_portal::ax -- --ignored --nocapture
    #[test]
    #[ignore = "needs the real Chrome floating player and Accessibility permission"]
    fn reads_the_real_player_and_slider() {
        let mut window = AxWindow::default();
        assert!(window.trusted(), "grant Accessibility to this terminal first");
        let frame = window.frame().expect("AX read").expect("no Picture in Picture window");
        println!("player {frame:?} on display {:?}", window.display_bounds(frame));
        let mut slider = AxSlider::default();
        println!("CNBC volume: {:?}", slider.level("CNBC", "Volume Level"));
    }
}
```

- [ ] **Step 2: Declare the module**

Replace the whole of `src-tauri/src/window_portal/mod.rs` with:

```rust
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

#[allow(dead_code)]
mod logic;
#[cfg(target_os = "macos")]
#[allow(dead_code)]
mod ax;
```

- [ ] **Step 3: Compile and run the tests**

Run: `cd <worktree>/src-tauri && cargo test --locked window_portal`
Expected: it compiles, and the summary reads `test result: ok. 19 passed; 0 failed; 1 ignored`.

If `msg_send!` rejects `&*bundle`, pass `&*bundle as &NSString` instead. objc2 0.6 verifies encodings in debug builds, and `&NSString` encodes as `@`.

- [ ] **Step 4: Check the lock and commit**

```bash
cd <worktree>
git diff --stat src-tauri/Cargo.lock src-tauri/Cargo.toml   # expected: no output
bash scripts/header-check.sh                                 # expected: header-check: clean
git add src-tauri/src/window_portal/ax.rs src-tauri/src/window_portal/mod.rs
git commit -m "feat(window-portal): macOS Accessibility player and volume slider"
```

---

### Task 4: Tauri commands, the window hook and quit

**Files:**
- Modify: `src-tauri/src/window_portal/mod.rs` (replace it entirely)
- Modify: `src-tauri/src/lib.rs:169` (`generate_handler!`) and `src-tauri/src/lib.rs:232-234` (run)

**Interfaces:**
- Consumes: `logic::{Mute, MuteState, Portal, Rect, Status}` and `ax::{AxSlider, AxWindow, ask_for_permission}`.
- Produces the commands, whose argument names are the JS keys used in Task 5:
  - `window_portal_fit(card: String, rect: Rect) -> Status`
  - `window_portal_release(card: String) -> ()`
  - `window_portal_set_muted(source: String, label: String, muted: bool) -> MuteState`
  - `window_portal_mute_state(source: String, label: String) -> MuteState`
  - `window_portal_open_settings() -> ()`
  - plus `pub fn release_all()`.

The spec lists a fifth operation, "status". `fit` returns the status, and the card re-fits every three seconds, so no separate status command is added. The fifth command opens the Accessibility pane, which the "permission not granted" state needs for its button.

- [ ] **Step 1: Replace `mod.rs`**

```rust
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! Window Portal: parks Chrome's floating video player over a card (spec
//! docs/superpowers/specs/2026-11-12-window-portal-card-design.md). The
//! commands exist on every platform. Only macOS implements them; the others
//! answer "not supported", which the card reads as its placeholder.

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod logic;
#[cfg(target_os = "macos")]
mod ax;

use logic::{MuteState, Rect, Status};

#[cfg(not(target_os = "macos"))]
fn unsupported() -> MuteState {
    MuteState::Unavailable { reason: "Available in the macOS desktop app".into() }
}

#[tauri::command]
pub async fn window_portal_fit(window: tauri::WebviewWindow, card: String, rect: Rect) -> Status {
    #[cfg(target_os = "macos")]
    return native::fit(&window, &card, rect);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, card, rect);
        Status::NotSupported
    }
}

#[tauri::command]
pub async fn window_portal_release(card: String) {
    #[cfg(target_os = "macos")]
    native::release(&card);
    #[cfg(not(target_os = "macos"))]
    let _ = card;
}

#[tauri::command]
pub async fn window_portal_set_muted(source: String, label: String, muted: bool) -> MuteState {
    #[cfg(target_os = "macos")]
    return native::set_muted(&source, &label, muted);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, label, muted);
        unsupported()
    }
}

#[tauri::command]
pub async fn window_portal_mute_state(source: String, label: String) -> MuteState {
    #[cfg(target_os = "macos")]
    return native::mute_state(&source, &label);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, label);
        unsupported()
    }
}

#[tauri::command]
pub async fn window_portal_open_settings() {
    #[cfg(target_os = "macos")]
    ax::ask_for_permission();
}

/// Quit hands the player back and restores the volume (spec, Flow 4).
pub fn release_all() {
    #[cfg(target_os = "macos")]
    native::release_all();
}

#[cfg(target_os = "macos")]
mod native {
    use std::sync::{Mutex, Once, PoisonError};
    use std::time::Duration;

    use tauri::{WebviewWindow, WindowEvent};

    use super::ax::{AxSlider, AxWindow};
    use super::logic::{Mute, MuteState, Portal, Rect, Status};

    /// Only the main window parks the player (spec, States: viewer window).
    const MAIN: &str = "main";
    /// Tauri reports no minimise event. A focus loss is followed by this
    /// wait and then is_minimized().
    /// ponytail: fixed delay; switch to an NSWindow miniaturize observer if 700 ms misses the animation.
    const MINIMISE_SETTLE: Duration = Duration::from_millis(700);

    // Two locks, so the slider search (about 150 ms) never holds up a re-fit
    // during a drag. Never call a Tauri window method while holding either:
    // the window event handler runs on the main thread and takes them too.
    static PORTAL: Mutex<Option<Portal<AxWindow>>> = Mutex::new(None);
    static MUTE: Mutex<Option<Mute<AxSlider>>> = Mutex::new(None);
    static HOOKED: Once = Once::new();

    fn portal<T>(f: impl FnOnce(&mut Portal<AxWindow>) -> T) -> T {
        let mut guard = PORTAL.lock().unwrap_or_else(PoisonError::into_inner);
        f(guard.get_or_insert_with(|| Portal::new(AxWindow::default())))
    }

    fn mute<T>(f: impl FnOnce(&mut Mute<AxSlider>) -> T) -> T {
        let mut guard = MUTE.lock().unwrap_or_else(PoisonError::into_inner);
        f(guard.get_or_insert_with(|| Mute::new(AxSlider::default())))
    }

    /// The content area's top-left in global points. The webview fills it,
    /// so a CSS rectangle plus this is a screen rectangle.
    fn origin(window: &WebviewWindow) -> Option<(f64, f64)> {
        let scale = window.scale_factor().ok()?;
        let position = window.inner_position().ok()?;
        Some((f64::from(position.x) / scale, f64::from(position.y) / scale))
    }

    pub fn fit(window: &WebviewWindow, card: &str, rect: Rect) -> Status {
        if window.label() != MAIN {
            return Status::ViewerWindow;
        }
        hook(window);
        let Some(origin) = origin(window) else {
            return Status::Failed { reason: "BDOBB cannot read its own window position".into() };
        };
        portal(|p| p.fit(card, rect, origin))
    }

    pub fn release(card: &str) {
        if portal(|p| p.release(card)) {
            mute(|m| m.restore());
        }
    }

    pub fn release_all() {
        portal(|p| p.release_all());
        mute(|m| m.restore());
    }

    pub fn set_muted(source: &str, label: &str, muted: bool) -> MuteState {
        mute(|m| m.set(source, label, muted))
    }

    pub fn mute_state(source: &str, label: &str) -> MuteState {
        mute(|m| m.state(source, label))
    }

    /// Follows the main window: a move, a resize or a change of display
    /// re-fits; minimising hands the player back; closing releases it.
    fn hook(window: &WebviewWindow) {
        HOOKED.call_once(|| {
            let main = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Moved(_)
                | WindowEvent::Resized(_)
                | WindowEvent::ScaleFactorChanged { .. }
                | WindowEvent::Focused(true) => sync(&main),
                WindowEvent::Focused(false) => {
                    let main = main.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(MINIMISE_SETTLE);
                        sync(&main);
                    });
                }
                WindowEvent::Destroyed => release_all(),
                _ => {}
            });
        });
    }

    /// The window is read BEFORE either lock is taken.
    fn sync(window: &WebviewWindow) {
        if window.is_minimized().unwrap_or(false) {
            if portal(|p| p.suspend()) {
                mute(|m| m.restore());
            }
            return;
        }
        if let Some(origin) = origin(window) {
            portal(|p| p.refit(origin));
        }
    }
}
```

- [ ] **Step 2: Register the commands in `lib.rs`**

Change line 169 from:

```rust
        .invoke_handler(tauri::generate_handler![video_wrapper::video_wrapper_port, set_window_pin, save_panel::save_workspace_panel])
```

to:

```rust
        .invoke_handler(tauri::generate_handler![
            video_wrapper::video_wrapper_port,
            set_window_pin,
            save_panel::save_workspace_panel,
            window_portal::window_portal_fit,
            window_portal::window_portal_release,
            window_portal::window_portal_set_muted,
            window_portal::window_portal_mute_state,
            window_portal::window_portal_open_settings,
        ])
```

- [ ] **Step 3: Release on quit in `lib.rs`**

Change the end of `run()` from:

```rust
    builder
        .run(tauri::generate_context!())
        .expect("error while running BDOBB");
}
```

to:

```rust
    builder
        .build(tauri::generate_context!())
        .expect("error while running BDOBB")
        .run(|_app, event| {
            // Quit hands Chrome's floating player back (window_portal, spec Flow 4).
            if let tauri::RunEvent::Exit = event {
                window_portal::release_all();
            }
        });
}
```

- [ ] **Step 4: Compile and test on macOS**

```bash
cd <worktree>/src-tauri
cargo check --locked                     # expected: Finished, no error, no new warning from window_portal
cargo test --locked                      # expected: every test passes, window_portal ones included (19 passed, 1 ignored there)
```

- [ ] **Step 5: Check the iOS build of the not-supported path**

`cfg(not(target_os = "macos"))` is the same code for iOS, Windows and Linux. CI's Linux `cargo check` and `cargo test` cover Linux and Windows.

```bash
rustup target list --installed | grep -q aarch64-apple-ios || rustup target add aarch64-apple-ios
cd <worktree>/src-tauri && cargo check --locked --lib --target aarch64-apple-ios
```

Expected: `Finished`. If the build fails for a reason unrelated to `window_portal` (the toolchain), record the error in the task report and continue, since the walk builds iOS from this line. Do not change anything to make it pass.

- [ ] **Step 6: Check the lock and commit**

```bash
cd <worktree>
git diff --stat src-tauri/Cargo.lock      # expected: no output
git add src-tauri/src/lib.rs src-tauri/src/window_portal/mod.rs
git commit -m "feat(window-portal): Tauri commands, window following and release on quit"
```

---

### Task 5: The card's renderer, mute button and invoke layer (test-first)

**Files:**
- Create: `src/lib/windowPortal.ts`
- Create: `src/lib/windowPortal.test.ts`
- Create: `src/components/renderers/WindowPortalRenderer.tsx`
- Create: `src/components/renderers/WindowPortalRenderer.test.tsx`

**Interfaces:**
- Consumes: the Task 4 commands, with JSON shapes `{ state: "fitted" | "no_permission" | "no_player" | "in_use" | "too_small" | "viewer_window" | "not_supported" }`, `{ state: "failed", reason }`, and `{ state: "sound" | "muted" }` / `{ state: "unavailable", reason }`.
- Produces:
  - `src/lib/windowPortal.ts`: `DEFAULT_SOURCE = "CNBC"`, `DEFAULT_VOLUME_LABEL = "Volume Level"`, `portalPlatform(): "macos" | "ipad" | "other"`, `portalSettings(params: Record<string, string>): { source: string; label: string }`, `sameRect(a: CssRect, b: CssRect): boolean`, `fitPlayer`, `releasePlayer`, `setPlayerMuted`, `readMuteState`, `openAccessibilitySettings`, and the types `CssRect`, `PortalStatus`, `MuteState`.
  - `src/components/renderers/WindowPortalRenderer.tsx`: `WindowPortalRenderer({ cardId }: { cardId: string })` and `WindowPortalMute({ params }: { params: Record<string, string> })`.

- [ ] **Step 1: Write the failing tests for the invoke layer**

Create `src/lib/windowPortal.test.ts`:

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";

const { tauri } = vi.hoisted(() => ({ tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => tauri.on }));

import { portalPlatform, portalSettings, sameRect } from "./windowPortal";

afterEach(() => {
  vi.unstubAllEnvs();
  tauri.on = true;
});

describe("portalPlatform", () => {
  it.each([
    ["darwin", "macos"],
    ["ios", "ipad"],
    ["windows", "other"],
    ["linux", "other"],
  ])("reads TAURI_ENV_PLATFORM %s as %s", (platform, expected) => {
    vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    expect(portalPlatform()).toBe(expected);
  });

  it("is other in the browser build, whatever the env says", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "darwin");
    tauri.on = false;
    expect(portalPlatform()).toBe("other");
  });
});

describe("portalSettings", () => {
  it("falls back to CNBC and Volume Level for missing or blank values", () => {
    expect(portalSettings({})).toEqual({ source: "CNBC", label: "Volume Level" });
    expect(portalSettings({ source: "  ", volumeLabel: "" })).toEqual({ source: "CNBC", label: "Volume Level" });
    expect(portalSettings({ source: " Bloomberg ", volumeLabel: "Volume" })).toEqual({ source: "Bloomberg", label: "Volume" });
  });
});

describe("sameRect", () => {
  it("ignores sub-pixel jitter and sees a whole-pixel move", () => {
    const a = { x: 10, y: 20, width: 300, height: 200 };
    expect(sameRect(a, { x: 10.2, y: 19.8, width: 300.4, height: 200 })).toBe(true);
    expect(sameRect(a, { ...a, x: 11 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd <worktree> && pnpm vitest run src/lib/windowPortal.test.ts`
Expected: FAIL, ``Failed to resolve import "./windowPortal"``.

- [ ] **Step 3: Write `src/lib/windowPortal.ts`**

```ts
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The Window Portal card's side of the native controller (spec
 * docs/superpowers/specs/2026-11-12-window-portal-card-design.md; Rust in
 * src-tauri/src/window_portal/). Command names, argument keys and answer
 * shapes match the Rust exactly.
 */
export const DEFAULT_SOURCE = "CNBC";
export const DEFAULT_VOLUME_LABEL = "Volume Level";

export type PortalPlatform = "macos" | "ipad" | "other";

/** The macOS desktop app, the iPad app, or anything else (Windows, Linux, the web preview). */
export function portalPlatform(): PortalPlatform {
  if (!isTauri()) return "other";
  const platform = import.meta.env.TAURI_ENV_PLATFORM;
  if (platform === "darwin") return "macos";
  if (platform === "ios") return "ipad";
  return "other";
}

export type CssRect = { x: number; y: number; width: number; height: number };

export type PortalStatus =
  | { state: "fitted" | "no_permission" | "no_player" | "in_use" | "too_small" | "viewer_window" | "not_supported" }
  | { state: "failed"; reason: string };

export type MuteState = { state: "sound" | "muted" } | { state: "unavailable"; reason: string };

/** The card's two settings, with the defaults for a blank or missing value. */
export function portalSettings(params: Record<string, string>): { source: string; label: string } {
  return {
    source: params.source?.trim() || DEFAULT_SOURCE,
    label: params.volumeLabel?.trim() || DEFAULT_VOLUME_LABEL,
  };
}

/** Whole-pixel equality: sub-pixel jitter is no reason to move the player. */
export function sameRect(a: CssRect, b: CssRect): boolean {
  return (
    Math.round(a.x) === Math.round(b.x) &&
    Math.round(a.y) === Math.round(b.y) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

export const fitPlayer = (card: string, rect: CssRect) => invoke<PortalStatus>("window_portal_fit", { card, rect });
export const releasePlayer = (card: string) => invoke<void>("window_portal_release", { card });
export const setPlayerMuted = (source: string, label: string, muted: boolean) =>
  invoke<MuteState>("window_portal_set_muted", { source, label, muted });
export const readMuteState = (source: string, label: string) =>
  invoke<MuteState>("window_portal_mute_state", { source, label });
export const openAccessibilitySettings = () => invoke<void>("window_portal_open_settings");
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd <worktree> && pnpm vitest run src/lib/windowPortal.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing renderer tests**

Create `src/components/renderers/WindowPortalRenderer.test.tsx`:

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuteState, PortalStatus } from "../../lib/windowPortal";

const { invoke, tauri } = vi.hoisted(() => ({ invoke: vi.fn(), tauri: { on: true } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  isTauri: () => tauri.on,
}));

import { WindowPortalMute, WindowPortalRenderer } from "./WindowPortalRenderer";

/** Answers fit with `fit`, and the mute commands from a slider that starts at `mute`. */
function answer(fit: PortalStatus, mute: MuteState = { state: "sound" }) {
  let current = mute;
  invoke.mockImplementation(async (cmd: string, args?: { muted?: boolean }) => {
    if (cmd === "window_portal_fit") return fit;
    if (cmd === "window_portal_mute_state") return current;
    if (cmd === "window_portal_set_muted") {
      current = { state: args?.muted ? "muted" : "sound" };
      return current;
    }
    return undefined;
  });
}

const fitCall = () => expect(invoke).toHaveBeenCalledWith("window_portal_fit", expect.anything());

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  tauri.on = true;
  invoke.mockReset();
});

describe("Window Portal on the macOS desktop app", () => {
  beforeEach(() => vi.stubEnv("TAURI_ENV_PLATFORM", "darwin"));

  it.each([
    ["no_player", "Pop the video out in Chrome"],
    ["in_use", "The player is in use by another card"],
    ["too_small", "Make this card at least 284 × 160 to park the player here"],
    ["viewer_window", "Open this dashboard in the main window"],
    ["not_supported", "Available in the macOS desktop app"],
  ] as const)("shows %s as its message", async (state, text) => {
    answer({ state });
    render(<WindowPortalRenderer cardId="c1" />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("sends the body's rectangle and shows nothing once the player is parked", async () => {
    answer({ state: "fitted" });
    const { container } = render(<WindowPortalRenderer cardId="c1" />);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("window_portal_fit", { card: "c1", rect: { x: 0, y: 0, width: 0, height: 0 } }),
    );
    await waitFor(() => expect(container.querySelector(".window-portal")).toHaveAttribute("data-state", "fitted"));
    expect(container.querySelector(".empty-state")).toBeNull();
  });

  it("shows a failure with its reason", async () => {
    answer({ state: "failed", reason: "Accessibility refused AXSize (error -25200)" });
    render(<WindowPortalRenderer cardId="c1" />);
    expect(await screen.findByText("Could not move the player: Accessibility refused AXSize (error -25200)")).toBeInTheDocument();
  });

  it("explains a missing permission and opens the pane on request", async () => {
    answer({ state: "no_permission" });
    render(<WindowPortalRenderer cardId="c1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Open Accessibility settings" }));
    expect(screen.getByText(/needs Accessibility permission/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("window_portal_open_settings", undefined);
  });

  it("releases the player when the card goes away", async () => {
    answer({ state: "fitted" });
    const { unmount } = render(<WindowPortalRenderer cardId="c1" />);
    await waitFor(fitCall);
    unmount();
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("window_portal_release", { card: "c1" }));
  });

  it("never lets the release overtake a fit still in flight", async () => {
    let finish: (status: PortalStatus) => void = () => undefined;
    invoke.mockImplementation((cmd: string) =>
      cmd === "window_portal_fit" ? new Promise<PortalStatus>((resolve) => (finish = resolve)) : Promise.resolve(undefined),
    );
    const { unmount } = render(<WindowPortalRenderer cardId="c1" />);
    await waitFor(fitCall);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalledWith("window_portal_release", expect.anything());
    finish({ state: "fitted" });
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith("window_portal_release", { card: "c1" }));
  });

  it("mutes and unmutes through the card's settings", async () => {
    answer({ state: "fitted" });
    render(<WindowPortalMute params={{ source: "Bloomberg", volumeLabel: "Volume" }} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Mute"));
    expect(invoke).toHaveBeenCalledWith("window_portal_mute_state", { source: "Bloomberg", label: "Volume" });
    await userEvent.click(button);
    expect(invoke).toHaveBeenCalledWith("window_portal_set_muted", { source: "Bloomberg", label: "Volume", muted: true });
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("shows an unavailable mute with its reason and does nothing on click", async () => {
    answer({ state: "fitted" }, { state: "unavailable", reason: "Select the stream's tab in its window." });
    render(<WindowPortalMute params={{}} />);
    const button = await screen.findByRole("button", { name: "Mute" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Select the stream's tab in its window."));
    expect(button).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(button);
    expect(invoke).not.toHaveBeenCalledWith("window_portal_set_muted", expect.anything());
  });
});

describe("Window Portal on iPad", () => {
  beforeEach(() => vi.stubEnv("TAURI_ENV_PLATFORM", "ios"));

  it("is a reserved space with the hint, no controller and no mute button", () => {
    render(<WindowPortalRenderer cardId="c1" />);
    expect(screen.getByText("Park a picture-in-picture video here")).toBeInTheDocument();
    const { container } = render(<WindowPortalMute params={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Window Portal on Windows and in the web preview", () => {
  it.each([
    ["the Windows app", "windows", true],
    ["the web preview", undefined, false],
  ] as const)("shows the placeholder in %s", (_name, platform, inTauri) => {
    if (platform) vi.stubEnv("TAURI_ENV_PLATFORM", platform);
    tauri.on = inTauri;
    render(<WindowPortalRenderer cardId="c1" />);
    expect(screen.getByText("Available in the macOS desktop app")).toBeInTheDocument();
    const { container } = render(<WindowPortalMute params={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `cd <worktree> && pnpm vitest run src/components/renderers/WindowPortalRenderer.test.tsx`
Expected: FAIL, ``Failed to resolve import "./WindowPortalRenderer"``.

- [ ] **Step 7: Write `WindowPortalRenderer.tsx`**

```tsx
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef, useState } from "react";
import {
  fitPlayer,
  openAccessibilitySettings,
  portalPlatform,
  portalSettings,
  readMuteState,
  releasePlayer,
  sameRect,
  setPlayerMuted,
  type CssRect,
  type MuteState,
  type PortalStatus,
} from "../../lib/windowPortal";

/**
 * How often the card fits again (a player opened, closed or dragged away,
 * or another card let go of it) and how often the mute button re-reads the
 * slider. Spec, States: "rechecked every few seconds".
 */
const RECHECK_MS = 3000;

const MESSAGES = {
  no_player: "Pop the video out in Chrome",
  in_use: "The player is in use by another card",
  too_small: "Make this card at least 284 × 160 to park the player here",
  viewer_window: "Open this dashboard in the main window",
  not_supported: "Available in the macOS desktop app",
} as const;

/**
 * The Window Portal card's body (spec
 * docs/superpowers/specs/2026-11-12-window-portal-card-design.md). It is
 * blank on purpose: on the Mac, Chrome's floating player is moved over it.
 */
export function WindowPortalRenderer({ cardId }: { cardId: string }) {
  const platform = portalPlatform();
  if (platform === "ipad") return <p className="empty-state">Park a picture-in-picture video here</p>;
  if (platform === "other") return <p className="empty-state">{MESSAGES.not_supported}</p>;
  return <MacPortal cardId={cardId} />;
}

function MacPortal({ cardId }: { cardId: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<PortalStatus | null>(null);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let alive = true;
    let visible = true;
    let busy = false;
    let sent: CssRect | null = null;
    // One queue per card, so a release can never overtake the fit before it.
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = (op: () => Promise<unknown>) => {
      queue = queue.then(op, op);
    };
    const measure = (): CssRect => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const fit = (rect: CssRect) => {
      busy = true;
      sent = rect;
      enqueue(() =>
        fitPlayer(cardId, rect)
          .then(
            (next) => alive && setStatus(next),
            (err: unknown) => alive && setStatus({ state: "failed", reason: String(err) }),
          )
          .finally(() => {
            busy = false;
          }),
      );
    };
    const release = () => {
      sent = null;
      enqueue(() => releasePlayer(cardId).catch(() => undefined));
    };

    // Every frame, but a rectangle only goes out when it changed: this
    // catches a drag, a resize, a scroll and a maximize alike. BDOBB's own
    // window moving is the native side's to follow.
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      if (!visible || busy) return;
      const rect = measure();
      if (sent === null || !sameRect(sent, rect)) fit(rect);
    });
    const recheck = setInterval(() => {
      if (visible && !busy) fit(measure());
    }, RECHECK_MS);
    // Fully scrolled out, or on a hidden tab: hand the player back. A card
    // partly in view keeps it (spec, Fitting).
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (!visible) release();
          });
    observer?.observe(el);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      clearInterval(recheck);
      observer?.disconnect();
      release();
    };
  }, [cardId]);

  return (
    <div ref={body} className="window-portal" data-state={status?.state ?? "looking"} style={{ width: "100%", height: "100%" }}>
      <PortalMessage status={status} />
    </div>
  );
}

function PortalMessage({ status }: { status: PortalStatus | null }) {
  if (status === null) return <p className="empty-state">Looking for the floating player…</p>;
  if (status.state === "failed") return <p className="empty-state">Could not move the player: {status.reason}</p>;
  // A local, so each check below narrows it down to MESSAGES' keys.
  const { state } = status;
  if (state === "fitted") return null;
  if (state === "no_permission") {
    return (
      <div className="empty-state">
        <p>BDOBB needs Accessibility permission to move Chrome's floating player.</p>
        <button type="button" onClick={() => void openAccessibilitySettings().catch(() => undefined)}>
          Open Accessibility settings
        </button>
      </div>
    );
  }
  return <p className="empty-state">{MESSAGES[state]}</p>;
}

/** The header's mute toggle. macOS desktop only: iPadOS cannot reach another app's player. */
export function WindowPortalMute({ params }: { params: Record<string, string> }) {
  if (portalPlatform() !== "macos") return null;
  const { source, label } = portalSettings(params);
  return <MuteButton source={source} label={label} />;
}

function MuteButton({ source, label }: { source: string; label: string }) {
  const [mute, setMute] = useState<MuteState | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void readMuteState(source, label).then(
        (next) => alive && setMute(next),
        (err: unknown) => alive && setMute({ state: "unavailable", reason: String(err) }),
      );
    read();
    const timer = setInterval(read, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [source, label]);

  const muted = mute?.state === "muted";
  const reason = mute === null ? "Reading the volume…" : mute.state === "unavailable" ? mute.reason : undefined;
  return (
    <button
      type="button"
      className="card-action"
      // One name with aria-pressed, as Maximize does.
      aria-label="Mute"
      aria-pressed={muted}
      // aria-disabled, not disabled: a disabled button shows no tooltip, and the reason is the point.
      aria-disabled={reason !== undefined}
      title={reason ?? (muted ? "Unmute" : "Mute")}
      onClick={() => {
        if (reason !== undefined) return;
        void setPlayerMuted(source, label, !muted).then(setMute, (err: unknown) =>
          setMute({ state: "unavailable", reason: String(err) }),
        );
      }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `cd <worktree> && pnpm vitest run src/lib/windowPortal.test.ts src/components/renderers/WindowPortalRenderer.test.tsx`
Expected: PASS, 7 + 15 tests.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
cd <worktree>
pnpm typecheck && pnpm lint      # expected: both exit 0
git add src/lib/windowPortal.ts src/lib/windowPortal.test.ts src/components/renderers/WindowPortalRenderer.tsx src/components/renderers/WindowPortalRenderer.test.tsx
git commit -m "feat(window-portal): card body, states and mute button"
```

`pnpm knip` would flag the two new files as unused until Task 6 imports them. Run knip at the end of Task 6.

---

### Task 6: The built-in definition and the card wiring

**Files:**
- Modify: `src/lib/builtins.ts:4-5` (import) and `src/lib/builtins.ts:130` (after the Clock entry)
- Modify: `src/lib/builtins.test.ts` (one test)
- Modify: `src/components/WidgetCard.tsx:76` (import), `:1087` (body branch), `:1933` (header)
- Modify: `src/components/WidgetCard.test.tsx` (one test, after `describe("the clock built-in", …)`)

**Interfaces:**
- Consumes: `DEFAULT_SOURCE` and `DEFAULT_VOLUME_LABEL` from `src/lib/windowPortal.ts`, plus `WindowPortalRenderer` and `WindowPortalMute` from Task 5.
- Produces: the built-in `id: "window_portal"`, `type: "window_portal"`, with params `source` and `volumeLabel`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/builtins.test.ts`, inside `describe("BUILTIN_WIDGETS", …)` after the `"defines the website as an iframe with a url param"` test, add:

```ts
  it("defines the Window Portal with its two settings and no fetch", () => {
    const portal = byId("window_portal");
    expect(portal.type).toBe("window_portal");
    expect(portal.name).toBe("Window Portal");
    expect(portal.gridData).toEqual({ w: 16, h: 14 });
    expect(portal.params.map((p) => [p.paramName, p.type, p.value])).toEqual([
      ["source", "text", "CNBC"],
      ["volumeLabel", "text", "Volume Level"],
    ]);
    expect(fetchesData(portal)).toBe(false);
  });
```

In `src/components/WidgetCard.test.tsx`, after the closing `});` of `describe("the clock built-in", …)`, add:

```tsx
describe("the Window Portal built-in", () => {
  it("dispatches to its renderer, which is a placeholder outside the macOS app", () => {
    register({ id: "window_portal", backendId: "builtin", type: "window_portal", endpoint: "" });
    useWidgetData.mockReturnValue({ status: "ready", data: null, retry: vi.fn() });
    const c = { ...card, widgetId: "window_portal", backendId: "builtin", params: { source: "CNBC" } };
    useDashboardStore.setState({
      dashboards: [{ id: "d1", name: "D", tabs: [{ id: "t1", name: "Main", cards: [c] }] }],
      activeId: "d1",
      activeTabId: "t1",
    });

    render(<WidgetCard card={c} onRemove={vi.fn()} />);

    // jsdom is not Tauri, so this is the web preview's placeholder, and no mute button.
    expect(screen.getByText("Available in the macOS desktop app")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No data for these parameters/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd <worktree> && pnpm vitest run src/lib/builtins.test.ts src/components/WidgetCard.test.tsx -t "Window Portal"`
Expected: FAIL, with `no builtin window_portal` and `Unable to find an element with the text: Available in the macOS desktop app`.

- [ ] **Step 3: Add the built-in**

In `src/lib/builtins.ts`, after line 5 (`import type { WidgetDef } from "./types";`), add:

```ts
import { DEFAULT_SOURCE, DEFAULT_VOLUME_LABEL } from "./windowPortal";
```

After the Clock entry's closing `},` (line 130, directly before the `{` that opens `id: "rss"`), insert:

```ts
  {
    ...base,
    id: "window_portal",
    name: "Window Portal",
    description:
      "A parking spot for Chrome's floating video player. In the macOS app, BDOBB moves and sizes the player over this card.",
    type: "window_portal",
    // Room for the player's 284 × 160 minimum at ordinary dashboard widths;
    // WidgetDef.gridData has no minW/minH, so a smaller card says so instead.
    gridData: { w: 16, h: 14 },
    params: [
      {
        paramName: "source",
        label: "Source tab title contains",
        type: "text",
        value: DEFAULT_SOURCE,
        description: "Text in the title of the Chrome tab the video came from. Used only to find that tab's volume slider for Mute.",
      },
      {
        paramName: "volumeLabel",
        label: "Volume slider label",
        type: "text",
        value: DEFAULT_VOLUME_LABEL,
        description: "What the site calls its volume slider. Change it only if the site renames the control.",
      },
    ],
  },
```

- [ ] **Step 4: Wire the card**

In `src/components/WidgetCard.tsx`, after line 76 (`import { YouTubeRenderer } from "./renderers/YouTubeRenderer";`), add:

```tsx
import { WindowPortalMute, WindowPortalRenderer } from "./renderers/WindowPortalRenderer";
```

After the clock branch (the block ending `return <ClockRenderer params={card.params} />;` and its `}`, around line 1087), add:

```tsx
    // Same reason as the clock: no backend, data is always null.
    if (widget?.type === "window_portal") {
      return <WindowPortalRenderer cardId={card.id} />;
    }
```

Directly inside `<div className="card-controls-icons">` (around line 1933), before `{widget && DOCUMENT_TYPES.has(widget.type) ? null : (`, add:

```tsx
            {widget?.type === "window_portal" ? <WindowPortalMute params={card.params} /> : null}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd <worktree> && pnpm vitest run src/lib/builtins.test.ts src/components/WidgetCard.test.tsx src/components/WidgetCard.ios.test.tsx`
Expected: PASS, with no other test in those files changing result.

- [ ] **Step 6: Run the frontend gates**

```bash
cd <worktree>
pnpm typecheck && pnpm lint && pnpm knip   # expected: all exit 0; knip lists no new file or export from this task
pnpm test:run                              # expected: all pass
```

If a test elsewhere enumerates every built-in and fails because of the new entry, add `window_portal` to its expected list and say so in the task report. Candidates are `src/lib/agent/execute.test.ts` and `src/components/LibraryFilters.test.tsx`. Leave every other assertion as it is. If the unit suite times out because the host is loaded, re-run the failing file alone before treating it as a failure.

- [ ] **Step 7: Commit**

```bash
git add src/lib/builtins.ts src/lib/builtins.test.ts src/components/WidgetCard.tsx src/components/WidgetCard.test.tsx
git commit -m "feat(window-portal): Window Portal built-in card"
```

---

### Task 7: Help pages, and the full gate

**Files:**
- Create: `src/help/guide/window-portal.md`
- Modify: `src/help/guide/home.md:45` (one bullet after Live TV)
- Modify: `src/help/topics/built-in-widgets.md` (one section, before `## RSS feed`)
- Modify: `src/help/guide.test.ts` (count, and one new test)

**Interfaces:**
- Consumes: the card's names and texts from Tasks 5 and 6, verbatim.
- Produces: guide slug `guide/window-portal`.

The guide is vendored from the help vault (`~/Tolaria/BDOBB-V2 Help`, folder `v8.0/`) by `pnpm help:sync`. A page added only here would be deleted by the next sync. Task 8 has the human copy it into the vault.

- [ ] **Step 1: Write the failing test**

In `src/help/guide.test.ts`, change:

```ts
    // Added v4 Calendar and v5 Workspace/Statement pages, v6's three Rita/AI pages, v7's two iPad pages, and v8's News and Locked and Pinned Widgets pages, are deliberate; so is v4's Linked Widgets page.
    expect(GUIDE_PAGES).toHaveLength(44);
```

to:

```ts
    // Added v4 Calendar and v5 Workspace/Statement pages, v6's three Rita/AI pages, v7's two iPad pages, and v8's News, Locked and Pinned Widgets and Window Portal pages, are deliberate; so is v4's Linked Widgets page.
    expect(GUIDE_PAGES).toHaveLength(45);
```

At the end of the file, add:

```ts
describe("the Window Portal page", () => {
  it("is listed under Widgets and states what the card says and needs on each platform", () => {
    const widgets = GUIDE_SECTIONS.find((s) => s.title === "Widgets");
    expect(widgets?.pages.map((p) => p.slug)).toContain(`${GUIDE_PREFIX}window-portal`);
    const body = GUIDE_PAGES.find((p) => p.slug === `${GUIDE_PREFIX}window-portal`)!.body;
    for (const s of [
      "**Window Portal**",
      "`Picture in Picture`",
      "**Accessibility**",
      "**Source tab title contains**",
      "**Volume slider label**",
      "`Volume Level`",
      "*Pop the video out in Chrome*",
      "*Park a picture-in-picture video here*",
      "*Available in the macOS desktop app*",
    ]) expect(body).toContain(s);
    const manual = TOPICS.find((t) => t.slug === "built-in-widgets")!.body;
    expect(manual).toContain("## Window Portal");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd <worktree> && pnpm vitest run src/help/guide.test.ts`
Expected: FAIL. The count is 44, not 45, and the Window Portal test cannot find the page.

- [ ] **Step 3: Write the guide page**

Create `src/help/guide/window-portal.md`:

```markdown
---
type: Note
tags: [bdobb, help, widgets, built-in, window-portal, video, chrome]
---

# Window Portal

**Window Portal** is a built-in card that keeps a place on a dashboard for a live video you are watching in Chrome, such as the CNBC player. BDOBB never loads or frames the stream. Chrome plays it in its own floating `Picture in Picture` window, and on the Mac BDOBB moves and sizes that window to sit exactly over the card. The floating window stays above every other window, so the video keeps playing over the card while you work.

## On the Mac

1. Add **Window Portal** from the [[widget-library|Widget Library]]. It is under *Built-in*.
2. The first time, the card asks for **Accessibility** permission. Choose **Open Accessibility settings**, switch BDOBB on in *System Settings ▸ Privacy & Security ▸ Accessibility*, and come back. BDOBB uses the permission only to move, size and mute Chrome's floating player.
3. In Chrome, start the video and pop it out with its picture-in-picture button. Within a few seconds the player jumps onto the card.

The player follows the card when you move it, resize it, maximize it or scroll the dashboard, and when you drag BDOBB's window. It keeps the video's 16:9 shape, centred in the card, and Chrome will not make it smaller than 284 × 160. A card smaller than that says *Make this card at least 284 × 160 to park the player here*. A card partly scrolled out of view keeps the player, which may then overlap the header. A card scrolled fully out of view hands it back.

Chrome's player goes back to where it was, at its old size, when you switch dashboard, remove or minimize the card, minimize BDOBB or quit BDOBB. If BDOBB crashes, the player stays where BDOBB last put it.

## Mute

The 🔊 button in the card's header mutes the stream, and 🔇 turns it back on at the volume it had. BDOBB does this by stepping the video's own **Volume Level** slider in the Chrome tab the video came from, so the button stays right when you change the volume in the player yourself. Two settings in the card's parameters find that tab and slider:

- **Source tab title contains**: text in the tab's title. The default is `CNBC`.
- **Volume slider label**: what the site calls its slider. The default is `Volume Level`. Change it only if the site renames the control.

Chrome shows BDOBB only the selected tab of each window. If the stream's tab is not the selected tab in its window, the button is dimmed, and hovering over it says why. The player still parks either way. When BDOBB hands the player back, it also turns the volume back up if BDOBB was the one that muted it.

## What the card says

| Card says | Meaning |
| --- | --- |
| *Pop the video out in Chrome* | No floating player is open; the card checks again every few seconds |
| *The player is in use by another card* | Another Window Portal card holds it; remove that card or scroll it away |
| *Open this dashboard in the main window* | The card is in an **Open in new window** viewer, which cannot hold the player |
| *BDOBB needs Accessibility permission…* | See step 2 above |

## On iPad, Windows and the web preview

On iPad the card is an empty space with the hint *Park a picture-in-picture video here*. iPadOS gives an app no way to move another app's player, so drag the picture-in-picture video onto the card yourself. There is no mute button on iPad. The Windows app and the [[web-preview|Web Preview]] show *Available in the macOS desktop app*.

## Limits

Chrome only, and only its one floating player. The window title BDOBB looks for is the English `Picture in Picture`, so a Chrome set to another language is not yet supported. The card does not crop the video, detect commercial breaks, or pop the video out for you.

*See also: [[built-in-widgets|Built-in Widgets]] · [[widget-cards|Widget Cards]] · [[live-tv|Live TV]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
```

- [ ] **Step 4: List it on the guide's home page**

In `src/help/guide/home.md`, after line 45 (the `- [[live-tv|Live TV]] — …` bullet), add:

```markdown
- [[window-portal|Window Portal]] — a parking spot for Chrome's floating video player: on the Mac BDOBB moves it over the card and the card can mute it
```

- [ ] **Step 5: Add the reference manual section**

In `src/help/topics/built-in-widgets.md`, directly before `## RSS feed`, add:

```markdown
## Window Portal

*A parking spot for Chrome's floating video player.* The card body is blank.
In the macOS app, BDOBB moves and sizes Chrome's `Picture in Picture` window
to sit over it, follows the card and BDOBB's window, and hands the player
back to where it was when the card goes away, BDOBB is minimized or BDOBB
quits. It needs **Accessibility** permission, which the card asks for. The
🔊 header button mutes by stepping the source tab's volume slider. Its two
parameters, **Source tab title contains** (default `CNBC`) and **Volume
slider label** (default `Volume Level`), find that tab and slider. The
stream's tab must be the selected tab in its Chrome window. On iPad the card
is an empty space to drag a picture-in-picture video onto, with no mute
button. On Windows and in the web preview it reads *Available in the macOS
desktop app*.

```

- [ ] **Step 6: Run the help tests to see them pass**

Run: `cd <worktree> && pnpm vitest run src/help`
Expected: PASS. That includes `starts at home and lists every page in exactly one section`, `resolves every internal link to a page` and the new Window Portal test.

- [ ] **Step 7: Run the full gate**

```bash
cd <worktree>
pnpm typecheck
pnpm lint
pnpm knip
pnpm test:run
pnpm test:web
pnpm build:web
NODE_OPTIONS=--max-old-space-size=6144 pnpm build
(cd src-tauri && cargo check --locked && cargo test --locked)
cargo fetch --locked --manifest-path src-tauri/Cargo.toml && pnpm notices:check
pnpm scrub
git diff --stat src-tauri/Cargo.lock
```

Expected: every command exits 0, `pnpm scrub` prints `scrub-check: clean` and `header-check: clean`, and the last command prints nothing.

The Playwright jobs (`pnpm test:web:browser`, `pnpm e2e`) are heavy. Run them when the machine is free, and report whether they ran.

- [ ] **Step 8: Commit and check the tree**

```bash
git add src/help/guide/window-portal.md src/help/guide/home.md src/help/topics/built-in-widgets.md src/help/guide.test.ts
git commit -m "docs(help): Window Portal guide page and manual section"
git status --short   # expected: no output
```

---

### Task 8: Manual acceptance on the user's Mac (NEEDS THE HUMAN)

This task cannot be run by an agent. CI cannot grant Accessibility or run Chrome with a live stream (spec, Testing). The user runs the app built from this branch on their Mac, with the real CNBC popout. An agent may prepare the build and record the results; the user judges each item. The card goes into the walk only once every item here passes or is explicitly waived by the user.

**Files:**
- None, unless the user asks for the results to be recorded.

- [ ] **Step 1: Build and start the app (agent may do this)**

```bash
cd <worktree>
pnpm tauri dev
```

Accessibility trust is bound to the binary's signature. A `tauri dev` binary is a different entry in *System Settings ▸ Privacy & Security ▸ Accessibility* from the installed BDOBB.app. Grant it to the binary the user is actually testing. Do not replace the installed app without the user's say-so.

- [ ] **Step 2: Optional FFI smoke test (the user's terminal must hold Accessibility)**

With the CNBC popout open, run:

`cd <worktree>/src-tauri && cargo test --locked window_portal::ax -- --ignored --nocapture`

Expected: it prints the player's frame, a display rectangle, and `CNBC volume: Ok(…)`.

- [ ] **Step 3: The acceptance checklist (the user)**

From the spec's Testing section:

- [ ] Permission denied: the card shows the explanation and **Open Accessibility settings**. After granting, the card fits within a few seconds without a restart (or note that a restart was needed).
- [ ] Fit on first show: adding the card with the popout open puts the player centred over the card body at 16:9.
- [ ] Follows a card move (drag), a card resize, a maximize and restore, a dashboard scroll, and a BDOBB window drag.
- [ ] Card partly scrolled out: the player stays at the card's position. Fully scrolled out: the player goes back. Scrolled back in: it returns.
- [ ] A card smaller than 284 × 160 shows the "at least 284 × 160" message and the player goes back.
- [ ] A second Window Portal card says *The player is in use by another card*. Removing the first card hands the player to the second within a few seconds.
- [ ] Viewer window: in **Open in new window**, the card says *Open this dashboard in the main window*.
- [ ] Restore on dashboard switch, card removal, card minimise, BDOBB minimise (the player comes back over the card when BDOBB is restored from the Dock) and BDOBB quit (⌘Q).
- [ ] Restore of a player that started partly off the right edge of the screen: it returns to exactly that spot and size.
- [ ] Mute and unmute by ear, with the CNBC tab selected in its window.
- [ ] Mute, then change the volume in the player: the button follows. Unmute after the user muted in the player goes to 100%.
- [ ] Mute when the CNBC tab is not the selected tab: the button is dimmed and its tooltip gives the reason. The player still parks.
- [ ] Releasing after BDOBB muted (for example, switching dashboard) brings the volume back.

The spec's "Not verified" list, each checked once and the result recorded:

- [ ] 0% on the slider is audibly silent.
- [ ] Mute when the CNBC tab is not the selected tab in its window, or that window is minimised.
- [ ] BDOBB in full screen.
- [ ] A second display, with the card dragged from one display to the other, including displays with different scale factors.
- [ ] A non-English Chrome (expected: *Pop the video out in Chrome* stays up, because the title differs).
- [ ] A Mac where nothing has yet made Chrome build its accessibility tree (for example a fresh login): does mute find the slider?

This plan also adds items that it cannot verify without the hardware:

- [ ] The minimise check (700 ms after focus loss) catches minimise-to-Dock every time.
- [ ] Steps applied back to back (up to ten AXDecrement calls in a row) all land.
- [ ] Bloomberg TV with **Source tab title contains** set to `Bloomberg`: parks and mutes.

- [ ] **Step 4: Copy the guide page into the help vault (the user, or with their go-ahead)**

Copy `src/help/guide/window-portal.md` and the new bullet in `src/help/guide/home.md` into the vault's `v8.0/` snapshot (`~/Tolaria/BDOBB-V2 Help`). Then confirm that `pnpm help:sync` in the worktree produces no diff. Otherwise the next sync deletes the page.
