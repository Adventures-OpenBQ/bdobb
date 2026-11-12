// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

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
