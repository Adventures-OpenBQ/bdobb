// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! The Picture in Picture's platform-neutral half (spec
//! docs/superpowers/specs/2026-11-12-picture-in-picture-card-design.md): the
//! geometry, the placement state machine and the mute bookkeeping. Nothing
//! here names macOS. `ax.rs` implements `PlayerWindow` and `VolumeSlider` on
//! macOS, and a later Windows design can implement them there.

use serde::{Deserialize, Serialize};

/// Chrome's floating player, measured 2026-11-12 on a 1736 × 1133 display
/// (spec, "What the probe measured"). The maximum may scale with the display
/// (1388 is 80% of 1736), so `Placement::place` centres on the size Chrome
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
    /// The player is held but moved off screen (the card is hidden, its menu is open, or BDOBB is in the background).
    Parked,
    TooSmall,
    ViewerWindow,
    /// Built only by the commands off macOS.
    #[allow(dead_code)]
    NotSupported,
    Failed { reason: String },
}

/// Where to find the page's volume slider; present when "Mute while hidden" is on.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct MuteTarget {
    pub source: String,
    pub label: String,
}

/// What the volume needs after a change of the placement.
#[derive(Clone, Debug, PartialEq)]
pub enum VolumeAction {
    /// Step the volume to 0 because the player was hidden.
    Hide(MuteTarget),
    /// Undo the hide's mute, if it was the hide that muted.
    Unhide,
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

/// The largest 16:9 rectangle inside `area`, centred horizontally, against
/// its top edge and no wider than MAX_SIZE; None when even MIN_SIZE does not fit.
pub fn fit_16x9(area: Rect) -> Option<Rect> {
    let width = area.width.min(area.height * 16.0 / 9.0).min(MAX_SIZE.0);
    if width < MIN_SIZE.0 {
        return None;
    }
    let height = width * 9.0 / 16.0;
    Some(Rect {
        x: area.x + (area.width - width) / 2.0,
        y: area.y,
        width,
        height,
    })
}

/// The probe's restore order: macOS clamps a resize to the screen at the
/// player's current position, so first move to where `saved` fits wholly on
/// `display`, then size, then put it back exactly.
pub fn restore_ops(saved: Rect, display: Rect) -> [Op; 3] {
    let (x, y) = clamp_into(saved, display);
    [Op::Move(x, y), Op::Size(saved.width, saved.height), Op::Move(saved.x, saved.y)]
}

/// The top-left that puts `rect` wholly on `display`, as close to where it is as possible.
fn clamp_into(rect: Rect, display: Rect) -> (f64, f64) {
    (
        rect.x.min(display.x + display.width - rect.width).max(display.x),
        rect.y.min(display.y + display.height - rect.height).max(display.y),
    )
}

/// True when any part of `frame` is on a display; also when no display can be listed (nothing to judge by).
fn on_a_display(frame: Rect, displays: &[Rect]) -> bool {
    displays.is_empty()
        || displays.iter().any(|d| frame.x < d.x + d.width && frame.x + frame.width > d.x && frame.y < d.y + d.height && frame.y + frame.height > d.y)
}

/// A blur decision is worked out after a delay and some Accessibility calls.
/// Any focus event since it began (`recorded` is the focus generation then,
/// `now` the generation now) makes it stale: it must not park a BDOBB that is in front.
pub fn blur_result_is_current(recorded: u64, now: u64) -> bool {
    recorded == now
}

/// kAXErrorCannotComplete: what Accessibility answers when the app does not
/// reply within the messaging timeout (a hung Chrome).
pub const AX_CANNOT_COMPLETE: i32 = -25204;

/// The user-facing reason for an Accessibility error code that means "Chrome
/// did not answer"; None for every other code.
pub fn ax_failure_reason(code: i32) -> Option<&'static str> {
    (code == AX_CANNOT_COMPLETE).then_some("Chrome is not responding; try again in a moment")
}

/// The reason an Accessibility call failed: Chrome's timeout reads as "not
/// responding", any other code is named after what was being done.
pub fn ax_error_text(code: i32, what: &str) -> String {
    ax_failure_reason(code).map_or_else(|| format!("{what} (error {code})"), str::to_owned)
}

/// What the slider lookup answers on the call that switches Chrome's page tree on.
/// How far below the window's top edge the page starts, in points: the
/// window's height less the top of the area its title bar leaves free
/// (AppKit's `contentLayoutRect`, measured from the window's bottom edge).
/// Never negative, and 0 for a measurement that makes no sense.
pub fn top_inset(window_height: f64, free_y: f64, free_height: f64) -> f64 {
    let inset = window_height - (free_y + free_height);
    if inset.is_finite() && inset > 0.0 { inset } else { 0.0 }
}

pub const PREPARING_REASON: &str = "Chrome is preparing the page; try again";

/// Chrome builds a tab's accessibility tree only when asked. A window with no
/// web area at all means it was not asked, so ask once per Chrome process
/// (AXManualAccessibility); `asked_pid` is the process last asked, 0 for none.
/// A page that has a web area but no slider is a different problem and is
/// never "fixed" this way.
pub fn should_request_manual_accessibility(saw_web_area: bool, asked_pid: i32, pid: i32) -> bool {
    !saw_web_area && asked_pid != pid
}

/// Where a parked player sits: just beyond the right-most display (the
/// first of equals), at that display's top edge. The probe moved the player
/// off every screen this way and it came back exactly (spec, Hiding).
pub fn park_point(displays: &[Rect]) -> (f64, f64) {
    displays
        .iter()
        .reduce(|best, d| if d.x + d.width > best.x + best.width { d } else { best })
        .map_or((FALLBACK_PARK.0, FALLBACK_PARK.1), |d| (d.x + d.width + PARK_MARGIN, d.y))
}

/// How far past the right-most display's edge a parked player sits.
const PARK_MARGIN: f64 = 200.0;
/// Where it goes when no display can be listed.
const FALLBACK_PARK: (f64, f64) = (4000.0, 0.0);

/// What to do when BDOBB loses focus: park, unless another BDOBB window took
/// the focus, or the user clicked the floating player's own controls.
pub fn should_park_on_blur(frontmost_is_self: bool, frontmost_is_chrome: bool, chrome_focused_window_is_player: bool) -> bool {
    !(frontmost_is_self || (frontmost_is_chrome && chrome_focused_window_is_player))
}

/// The floating player, behind whatever reaches it on this platform.
pub trait PlayerWindow {
    fn trusted(&self) -> bool;
    /// None while no floating player is open.
    fn frame(&mut self) -> Result<Option<Rect>, String>;
    fn apply(&mut self, op: Op) -> Result<(), String>;
    /// The display holding the centre of `rect`, else the main display.
    fn display_bounds(&self, rect: Rect) -> Rect;
    /// Every active display, global points.
    fn displays(&self) -> Vec<Rect>;
}

/// Which card holds the player, where the player was before, and the
/// card's last rectangle for re-fits after a window move.
///
/// A held player is either over its card or parked off screen. It is parked
/// while any of three things holds: the card is hidden (scrolled out, or on
/// another dashboard or tab), the card's menu is open, or BDOBB is away
/// (minimised or not in front). Only a removed card, a quit or a card too
/// small give it back to where it was.
pub struct Placement<W> {
    window: W,
    holder: Option<String>,
    saved: Option<Rect>,
    last: Option<Rect>,
    hidden: bool,
    menu: bool,
    away: bool,
    /// A restore failed part-way: the card is gone and every settle retries the restore, never parks.
    releasing: bool,
    /// The player is physically off screen.
    parked: bool,
    /// "Mute while hidden", from the last fit.
    mute: Option<MuteTarget>,
    /// The volume has been told to hide-mute and not yet to undo it.
    hide_muted: bool,
    /// Set whenever a held player is given back, for whatever reason; read by `take_handed_back`.
    handed_back: bool,
}

impl<W: PlayerWindow> Placement<W> {
    pub fn new(window: W) -> Self {
        Self { window, holder: None, saved: None, last: None, hidden: false, menu: false, away: false, releasing: false, parked: false, mute: None, hide_muted: false, handed_back: false }
    }

    /// True once since the last call if a held player was handed back (a release, a
    /// card too small, a vanished player). The caller restores the volume
    /// then, so "player handed back" and "mute restored" cannot drift apart.
    pub fn take_handed_back(&mut self) -> bool {
        std::mem::take(&mut self.handed_back)
    }

    /// The volume change the placement now calls for, once. Hidden (scrolled
    /// out, another dashboard or tab) and away (minimised, not in front)
    /// mute; the card's own menu does not.
    pub fn take_volume_action(&mut self) -> Option<VolumeAction> {
        let want = self.parked && (self.hidden || self.away) && !self.releasing;
        let target = self.mute.clone().filter(|_| want);
        if target.is_some() == self.hide_muted {
            return None;
        }
        self.hide_muted = target.is_some();
        Some(target.map_or(VolumeAction::Unhide, VolumeAction::Hide))
    }

    /// Parked for a reason that is the holder's own business: a reason to stay
    /// out of the way, not to give up the player.
    fn parks(&self) -> bool {
        self.hidden || self.menu || self.away
    }

    /// Another card asking to fit may take the hold over only when its card is
    /// hidden; not while BDOBB is away, and not while the holder's menu is open.
    fn yields(&self) -> bool {
        self.hidden
    }

    /// Where a frame just read from the player is saved as the original: as it
    /// is, unless it lies on no display, then clamped onto one (the player is
    /// never "restored" to an off-screen spot).
    fn original_from(&self, frame: Rect) -> Rect {
        if on_a_display(frame, &self.window.displays()) {
            return frame;
        }
        let (x, y) = clamp_into(frame, self.window.display_bounds(frame));
        Rect { x, y, ..frame }
    }

    /// The card is on screen and wants the player over it. Clears the card's
    /// own reasons to be parked; BDOBB being away still keeps it parked.
    /// `mute` is the card's "Mute while hidden" setting, None when it is off;
    /// it is taken only if the fit is accepted.
    pub fn fit_with_mute(&mut self, card: &str, css: Rect, origin: (f64, f64), mute: Option<MuteTarget>) -> Status {
        if !self.window.trusted() {
            return Status::NoPermission;
        }
        if self.holder.as_deref().is_some_and(|holder| holder != card) && !self.yields() {
            return Status::InUse;
        }
        if fit_16x9(to_screen(css, origin)).is_none() {
            self.release(card);
            return Status::TooSmall;
        }
        // A BDOBB in the background does not grab a player it does not hold.
        if self.holder.is_none() && self.away {
            return Status::Parked;
        }
        let frame = match self.window.frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => {
                self.forget();
                return Status::NoPlayer;
            }
            Err(reason) => return Status::Failed { reason },
        };
        if self.holder.is_none() {
            self.saved = Some(self.original_from(frame));
        }
        self.mute = mute;
        self.holder = Some(card.to_owned());
        self.last = Some(css);
        self.hidden = false;
        self.menu = false;
        // A fit takes the hold over (keeping `saved`): the failed restore is no longer wanted.
        self.releasing = false;
        self.settle(Some(origin))
    }

    /// The card is hidden (`menu` false) or its menu is open (`menu` true).
    /// Only the holder can park; a card never takes the player in order to park it.
    pub fn park(&mut self, card: &str, menu: bool) -> Status {
        if self.holder.as_deref() == Some(card) {
            if menu {
                self.menu = true;
            } else {
                self.hidden = true;
            }
            return self.settle(None);
        }
        Status::Parked
    }

    /// BDOBB went away (minimised, or not in front) or came back. Coming back
    /// fits the holder again unless its card still has a reason to be parked.
    pub fn set_away(&mut self, away: bool, origin: Option<(f64, f64)>) {
        self.away = away;
        if self.holder.is_some() {
            let _ = self.settle(origin);
        }
    }

    /// Parks or places the holder according to the current reasons.
    fn settle(&mut self, origin: Option<(f64, f64)>) -> Status {
        if self.releasing {
            self.release_all();
            return match self.holder {
                Some(_) => Status::Failed { reason: "BDOBB could not put the player back; trying again".into() },
                None => Status::NoPlayer,
            };
        }
        if self.parks() {
            return match self.park_now() {
                Ok(()) => Status::Parked,
                Err(reason) => Status::Failed { reason },
            };
        }
        let Some(origin) = origin else {
            return Status::Failed { reason: "BDOBB cannot read its own window position".into() };
        };
        let Some(css) = self.last else { return Status::NoPlayer };
        let Some(target) = fit_16x9(to_screen(css, origin)) else {
            self.release_all();
            return Status::TooSmall;
        };
        self.parked = false;
        match self.place(target) {
            Ok(()) => Status::Fitted,
            Err(reason) => Status::Failed { reason },
        }
    }

    fn park_now(&mut self) -> Result<(), String> {
        if self.parked {
            return Ok(());
        }
        let (x, y) = park_point(&self.window.displays());
        self.window.apply(Op::Move(x, y))?;
        self.parked = true;
        Ok(())
    }

    /// Top-left first, so the resize is not clamped where the player was,
    /// then the size, then centred horizontally on what Chrome actually allowed.
    fn place(&mut self, target: Rect) -> Result<(), String> {
        self.window.apply(Op::Move(target.x, target.y))?;
        self.window.apply(Op::Size(target.width, target.height))?;
        let actual = self.window.frame()?.unwrap_or(target);
        self.window.apply(Op::Move(target.x + (target.width - actual.width) / 2.0, target.y))
    }

    /// Re-fits the holder with its last rectangle (BDOBB's window moved or
    /// resized). None when no card holds it. A parked player stays parked.
    pub fn refit(&mut self, origin: (f64, f64)) -> Option<Status> {
        self.holder.as_ref()?;
        self.last?;
        Some(self.settle(Some(origin)))
    }

    /// True when `card` held the player and the hold has been forgotten (a
    /// failed restore keeps the hold, and returns false).
    pub fn release(&mut self, card: &str) -> bool {
        if self.holder.as_deref() != Some(card) {
            return false;
        }
        self.release_all();
        self.holder.is_none()
    }

    /// Gives the player back. If that fails the hold stays, with the original
    /// frame, and counts as hidden so that a later fit, release or quit tries again.
    pub fn release_all(&mut self) {
        match self.restore() {
            Restored::Done => self.forget(),
            Restored::Failed { moved } => {
                self.hidden = true;
                self.releasing = true;
                // A restore that got as far as moving the player on screen left it there.
                self.parked &= !moved;
            }
        }
    }

    fn forget(&mut self) {
        self.handed_back |= self.holder.is_some();
        self.holder = None;
        self.saved = None;
        self.last = None;
        self.hidden = false;
        self.menu = false;
        self.releasing = false;
        self.parked = false;
    }

    fn restore(&mut self) -> Restored {
        let Some(saved) = self.saved else { return Restored::Done };
        for (done, op) in restore_ops(saved, self.window.display_bounds(saved)).into_iter().enumerate() {
            if let Err(error) = self.window.apply(op) {
                // A player that has gone has nothing left to restore.
                if matches!(self.window.frame(), Ok(None)) {
                    return Restored::Done;
                }
                eprintln!("picture in picture: cannot restore the player: {error}");
                return Restored::Failed { moved: done > 0 };
            }
        }
        Restored::Done
    }
}

enum Restored {
    /// Restored, or the player is gone.
    Done,
    /// Some step was refused; `moved` is true if the player had already been moved on screen.
    Failed { moved: bool },
}

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
    let digits = text.trim().strip_suffix('%').unwrap_or(text.trim()).trim();
    // Digits and one optional point only: no sign, exponent, NaN or second %.
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return None;
    }
    let value: f64 = digits.parse().ok()?;
    Some(value.round().clamp(0.0, 100.0) as u8)
}

/// The volume slider in the stream's tab, behind whatever reaches it.
pub trait VolumeSlider {
    fn level(&mut self, source: &str, label: &str) -> Result<u8, String>;
    fn step(&mut self, source: &str, label: &str, up: bool, count: u32) -> Result<(), String>;
    /// Returns once the slider reads `target`, or a short timeout has passed, so
    /// that a read straight after a step never sees a half-applied volume.
    fn settle(&mut self, source: &str, label: &str, target: u8);
}

/// Where `count` whole steps from `level` land.
fn landing(level: u8, up: bool, count: u32) -> u8 {
    let moved = u32::from(STEP_PERCENT) * count;
    let level = u32::from(level);
    (if up { (level + moved).min(100) } else { level.saturating_sub(moved) }) as u8
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
    /// BDOBB's hide, not the user, muted it, and has not yet undone that.
    hide_muted: bool,
}

impl<V: VolumeSlider> Mute<V> {
    pub fn new(slider: V) -> Self {
        Self { slider, recorded: None, hide_muted: false }
    }

    /// A level recorded for another tab or slider must never be replayed here.
    fn forget_other(&mut self, source: &str, label: &str) {
        if self.recorded.as_ref().is_some_and(|r| r.source != source || r.label != label) {
            self.recorded = None;
        }
    }

    /// One step run, then the wait for the slider to land.
    fn step_and_settle(&mut self, source: &str, label: &str, level: u8, up: bool, count: u32) -> Result<(), String> {
        self.slider.step(source, label, up, count)?;
        self.slider.settle(source, label, landing(level, up, count));
        Ok(())
    }

    pub fn state(&mut self, source: &str, label: &str) -> MuteState {
        self.forget_other(source, label);
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
        self.forget_other(source, label);
        let level = match self.slider.level(source, label) {
            Ok(level) => level,
            Err(reason) => return MuteState::Unavailable { reason },
        };
        let stepped = if muted {
            if level == 0 {
                Ok(())
            } else {
                // Recorded only once the step-down has worked.
                let done = self.step_and_settle(source, label, level, false, steps(level, 0));
                if done.is_ok() {
                    self.recorded = Some(Recorded { source: source.to_owned(), label: label.to_owned(), level });
                }
                done
            }
        } else {
            // Already audible: the user raised it in the player since BDOBB muted, so
            // the recorded level is stale and there is nothing to step.
            let recorded = self.recorded.take();
            if level > 0 {
                Ok(())
            } else {
                let to = recorded.map_or(FULL_VOLUME, |r| r.level);
                self.step_and_settle(source, label, level, true, steps(level, to))
            }
        };
        match stepped {
            Ok(()) if muted => MuteState::Muted,
            Ok(()) => MuteState::Sound,
            Err(reason) => MuteState::Unavailable { reason },
        }
    }

    pub fn apply(&mut self, action: VolumeAction) {
        match action {
            VolumeAction::Hide(target) => self.hide(&target.source, &target.label),
            VolumeAction::Unhide => self.unhide(),
        }
    }

    /// Mutes for a hidden player, unless it is already silent: a player the
    /// user muted stays muted when it comes back.
    fn hide(&mut self, source: &str, label: &str) {
        if self.hide_muted {
            return;
        }
        self.forget_other(source, label);
        if self.slider.level(source, label).is_ok_and(|level| level > 0) && self.set(source, label, true) == MuteState::Muted {
            self.hide_muted = true;
        }
    }

    /// Undoes the hide's mute, and only that.
    fn unhide(&mut self) {
        if std::mem::take(&mut self.hide_muted) {
            self.restore();
        }
    }

    /// Steps back to the recorded level if BDOBB muted it (spec, Flow 4).
    pub fn restore(&mut self) {
        self.hide_muted = false;
        let Some(recorded) = &self.recorded else { return };
        let (source, label, to) = (recorded.source.clone(), recorded.label.clone(), recorded.level);
        // A slider that cannot be read right now keeps the recorded level for the next restore.
        let Ok(level) = self.slider.level(&source, &label) else { return };
        self.recorded = None;
        // Only a slider still at 0 is BDOBB's mute; anything else was moved by the user.
        if level == 0 {
            let _ = self.step_and_settle(&source, &label, level, true, steps(level, to));
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
    /// settable, 16:9 locked with the width winning, a width it refuses past
    /// `max_width`, and a resize clamped to the screen at its current position
    /// (width at most the display's right edge minus x).
    struct FakeWindow {
        trusted: bool,
        frame: Option<Rect>,
        ops: Vec<Op>,
        max_width: f64,
        /// The next this-many calls to `apply` fail and change nothing.
        fail_next: u32,
    }

    impl FakeWindow {
        fn with_player() -> Self {
            Self { trusted: true, frame: Some(ORIGINAL), ops: Vec::new(), max_width: f64::INFINITY, fail_next: 0 }
        }
    }

    /// The test-only face of `fit_with_mute`: the target already set is kept.
    impl<W: PlayerWindow> Placement<W> {
        fn fit(&mut self, card: &str, css: Rect, origin: (f64, f64)) -> Status {
            let mute = self.mute.clone();
            self.fit_with_mute(card, css, origin, mute)
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
            if self.fail_next > 0 {
                self.fail_next -= 1;
                return Err("refused".into());
            }
            let frame = self.frame.as_mut().ok_or_else(|| "no player".to_string())?;
            match op {
                Op::Move(x, y) => {
                    frame.x = x;
                    frame.y = y;
                }
                Op::Size(width, _) => {
                    frame.width = width.min(self.max_width).min(DISPLAY.x + DISPLAY.width - frame.x);
                    frame.height = frame.width * 9.0 / 16.0;
                }
            }
            Ok(())
        }
        fn display_bounds(&self, _rect: Rect) -> Rect {
            DISPLAY
        }
        fn displays(&self) -> Vec<Rect> {
            vec![DISPLAY]
        }
    }

    #[test]
    fn a_timed_out_accessibility_call_has_a_reason_and_other_codes_do_not() {
        assert_eq!(ax_failure_reason(-25204), Some("Chrome is not responding; try again in a moment"));
        assert_eq!(ax_failure_reason(0), None);
        assert_eq!(ax_failure_reason(-25200), None);
    }

    #[test]
    fn the_page_tree_is_requested_only_when_no_web_area_was_seen_and_once_per_chrome_process() {
        // Nothing asked yet (pid 0).
        assert!(should_request_manual_accessibility(false, 0, 412));
        assert!(!should_request_manual_accessibility(true, 0, 412));
        // Already asked this Chrome process.
        assert!(!should_request_manual_accessibility(false, 412, 412));
        assert!(!should_request_manual_accessibility(true, 412, 412));
        // Chrome was restarted: a new process builds no page trees until asked again.
        assert!(should_request_manual_accessibility(false, 412, 977));
    }

    #[test]
    fn an_accessibility_error_is_a_reason_for_a_timeout_and_a_code_otherwise() {
        assert_eq!(ax_error_text(-25204, "the volume slider refused a step"), "Chrome is not responding; try again in a moment");
        assert_eq!(ax_error_text(-25200, "the volume slider refused a step"), "the volume slider refused a step (error -25200)");
        assert_eq!(ax_error_text(-25205, "Accessibility refused AXSize"), "Accessibility refused AXSize (error -25205)");
    }

    #[test]
    fn to_screen_adds_the_window_origin() {
        assert_eq!(to_screen(r(10.0, 20.0, 300.0, 200.0), (100.0, 50.0)), r(110.0, 70.0, 300.0, 200.0));
    }

    #[test]
    fn fit_16x9_takes_the_largest_centred_16x9_rectangle() {
        let wide = fit_16x9(r(0.0, 0.0, 1000.0, 400.0)).unwrap();
        assert!(close(wide.width, 711.11) && close(wide.height, 400.0) && close(wide.x, 144.44) && close(wide.y, 0.0));
        assert_eq!(fit_16x9(r(0.0, 0.0, 400.0, 1000.0)), Some(r(0.0, 0.0, 400.0, 225.0)));
    }

    #[test]
    fn fit_16x9_stays_within_the_measured_limits() {
        assert_eq!(fit_16x9(r(0.0, 0.0, 3000.0, 2000.0)), Some(r(806.0, 0.0, 1388.0, 780.75)));
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
    fn fit_moves_then_sizes_then_aligns_to_the_top_in_screen_points() {
        let mut placement = Placement::new(FakeWindow::with_player());
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::Fitted);
        // Card at (110, 70) 640 × 400 on screen; 640 × 360 against its top edge.
        assert_eq!(placement.window.ops, vec![Op::Move(110.0, 70.0), Op::Size(640.0, 360.0), Op::Move(110.0, 70.0)]);
        assert_eq!(placement.window.frame, Some(r(110.0, 70.0, 640.0, 360.0)));
    }

    #[test]
    fn fit_centres_horizontally_on_the_size_chrome_actually_allowed() {
        let mut window = FakeWindow::with_player();
        window.max_width = 500.0;
        let mut placement = Placement::new(window);
        assert_eq!(placement.fit("a", r(0.0, 0.0, 1200.0, 800.0), (0.0, 0.0)), Status::Fitted);
        assert_eq!(placement.window.ops.last(), Some(&Op::Move(350.0, 0.0)));
    }

    #[test]
    fn release_by_the_holder_restores_a_player_that_was_partly_off_screen() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        assert!(placement.release("a"));
        assert_eq!(placement.window.ops[3..], [Op::Move(1336.0, 100.0), Op::Size(400.0, 225.0), Op::Move(1600.0, 100.0)]);
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn a_second_card_neither_steals_nor_releases_the_player() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        let before = placement.window.ops.len();
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::InUse);
        assert!(!placement.release("b"));
        assert_eq!(placement.window.ops.len(), before);
        assert!(placement.release("a"));
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn no_permission_and_no_player_touch_nothing() {
        let mut window = FakeWindow::with_player();
        window.trusted = false;
        let mut placement = Placement::new(window);
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::NoPermission);
        assert!(placement.window.ops.is_empty());

        let mut window = FakeWindow::with_player();
        window.frame = None;
        let mut placement = Placement::new(window);
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::NoPlayer);
        assert_eq!(placement.refit(ORIGIN), None);
    }

    #[test]
    fn a_card_too_small_for_the_player_hands_it_back() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        assert_eq!(placement.fit("a", r(0.0, 0.0, 200.0, 100.0), ORIGIN), Status::TooSmall);
        assert_eq!(placement.window.frame, Some(ORIGINAL));
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn every_way_of_handing_the_player_back_is_reported_once() {
        // Too small after holding.
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        assert!(!placement.take_handed_back());
        assert_eq!(placement.fit("a", r(0.0, 0.0, 200.0, 100.0), ORIGIN), Status::TooSmall);
        assert!(placement.take_handed_back());
        assert!(!placement.take_handed_back());

        // No player any more after holding.
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.window.frame = None;
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::NoPlayer);
        assert!(placement.take_handed_back());

        // Release by the holder, release_all.
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        assert!(placement.release("a"));
        assert!(placement.take_handed_back());
        placement.fit("a", CARD, ORIGIN);
        placement.release_all();
        assert!(placement.take_handed_back());

        // Parking keeps the player, so it hands nothing back.
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.set_away(true, Some(ORIGIN));
        assert!(!placement.take_handed_back());
    }

    #[test]
    fn nothing_is_reported_when_nothing_was_held() {
        let mut placement = Placement::new(FakeWindow::with_player());
        assert_eq!(placement.fit("a", r(0.0, 0.0, 200.0, 100.0), ORIGIN), Status::TooSmall);
        assert!(!placement.release("a"));
        placement.release_all();
        let mut window = FakeWindow::with_player();
        window.frame = None;
        let mut placement = Placement::new(window);
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::NoPlayer);
        assert!(!placement.take_handed_back());
        // A second card turned away with InUse hands nothing back.
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.fit("b", CARD, ORIGIN);
        assert!(!placement.take_handed_back());
    }

    const SIDE_BY_SIDE: [Rect; 2] = [Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0 }, Rect { x: 1920.0, y: 0.0, width: 1920.0, height: 1080.0 }];
    const STACKED: [Rect; 2] = [Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0 }, Rect { x: 0.0, y: -1080.0, width: 1920.0, height: 1080.0 }];

    #[test]
    fn the_parking_point_is_beyond_every_display() {
        assert_eq!(park_point(&[DISPLAY]), (1936.0, 0.0));
        assert_eq!(park_point(&SIDE_BY_SIDE), (4040.0, 0.0));
        // Equal right edges: the first of them, and its top edge is the y.
        assert_eq!(park_point(&STACKED), (2120.0, 0.0));
        // The right-most display decides, wherever it sits vertically.
        assert_eq!(park_point(&[r(0.0, 0.0, 1000.0, 800.0), r(1000.0, -300.0, 500.0, 600.0)]), (1700.0, -300.0));
        assert_eq!(park_point(&[]), (4000.0, 0.0));
    }

    fn off_screen(frame: Option<Rect>, displays: &[Rect]) -> bool {
        let f = frame.unwrap();
        displays.iter().all(|d| f.x >= d.x + d.width || f.x + f.width <= d.x || f.y >= d.y + d.height || f.y + f.height <= d.y)
    }

    #[test]
    fn parking_moves_the_player_off_screen_and_keeps_the_hold() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        assert_eq!(placement.park("a", false), Status::Parked);
        assert_eq!(placement.window.ops.last(), Some(&Op::Move(1936.0, 0.0)));
        assert!(off_screen(placement.window.frame, &[DISPLAY]));
        assert!(!placement.take_handed_back());
        // The same call again moves nothing.
        let ops = placement.window.ops.len();
        placement.park("a", false);
        assert_eq!(placement.window.ops.len(), ops);
        // Release gives back the ORIGINAL place, not the card's.
        assert!(placement.release("a"));
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn a_fit_brings_a_parked_player_back_over_the_card() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", true);
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::Fitted);
        assert_eq!(placement.window.frame, Some(r(110.0, 70.0, 640.0, 360.0)));
        placement.release("a");
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn only_the_holder_can_park_and_nothing_is_taken_to_park() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.park("a", false);
        assert!(placement.window.ops.is_empty());
        placement.fit("a", CARD, ORIGIN);
        let ops = placement.window.ops.len();
        placement.park("b", false);
        assert_eq!(placement.window.ops.len(), ops);
        assert_eq!(placement.window.frame, Some(r(110.0, 70.0, 640.0, 360.0)));
    }

    #[test]
    fn a_window_move_does_not_bring_a_hidden_player_back() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        let ops = placement.window.ops.len();
        assert_eq!(placement.refit((300.0, 300.0)), Some(Status::Parked));
        assert_eq!(placement.window.ops.len(), ops);
    }

    #[test]
    fn a_parked_hold_yields_to_another_card_and_keeps_the_original_frame() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
        assert_eq!(placement.window.frame, Some(r(110.0, 70.0, 640.0, 360.0)));
        // B is visibly fitted now, so A is turned away and does not release B's hold.
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::InUse);
        assert!(!placement.release("a"));
        assert!(placement.release("b"));
        assert_eq!(placement.window.frame, Some(ORIGINAL));
        assert!(placement.take_handed_back());
    }

    #[test]
    fn a_card_too_small_does_not_take_a_parked_hold() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        assert_eq!(placement.fit("b", r(0.0, 0.0, 200.0, 100.0), ORIGIN), Status::TooSmall);
        assert!(placement.release("a"));
    }

    #[test]
    fn the_app_going_away_parks_and_coming_back_fits_again() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.set_away(true, Some(ORIGIN));
        assert!(off_screen(placement.window.frame, &[DISPLAY]));
        // A recheck while away stays parked.
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::Parked);
        assert!(off_screen(placement.window.frame, &[DISPLAY]));
        placement.set_away(false, Some(ORIGIN));
        assert_eq!(placement.window.frame, Some(r(110.0, 70.0, 640.0, 360.0)));
        placement.release("a");
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn coming_back_does_not_unpark_a_card_that_is_still_hidden() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.set_away(true, Some(ORIGIN));
        placement.set_away(false, Some(ORIGIN));
        assert!(off_screen(placement.window.frame, &[DISPLAY]));
        placement.park("a", true);
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn an_app_in_the_background_does_not_take_a_player_it_does_not_hold() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.set_away(true, Some(ORIGIN));
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::Parked);
        assert!(placement.window.ops.is_empty());
        placement.set_away(false, Some(ORIGIN));
        assert_eq!(placement.fit("a", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn a_card_shrunk_while_parked_hands_the_original_back() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        assert_eq!(placement.fit("a", r(0.0, 0.0, 200.0, 100.0), ORIGIN), Status::TooSmall);
        assert_eq!(placement.window.frame, Some(ORIGINAL));
        assert!(placement.take_handed_back());
    }

    #[test]
    fn a_release_from_the_parked_state_ends_at_the_exact_original_frame() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        assert!(off_screen(placement.window.frame, &[DISPLAY]));
        assert!(placement.release("a"));
        assert_eq!(placement.window.frame, Some(ORIGINAL));
        // Sizing before moving on screen would be clamped to the space left of x = 1936.
        let tail = &placement.window.ops[placement.window.ops.len() - 3..];
        assert_eq!(tail, [Op::Move(1336.0, 100.0), Op::Size(400.0, 225.0), Op::Move(1600.0, 100.0)]);
    }

    #[test]
    fn a_failed_restore_keeps_the_saved_frame_and_a_later_release_restores_it() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.window.fail_next = 1;
        placement.release_all();
        // Nothing moved, the hold is kept and nothing was handed back.
        assert!(off_screen(placement.window.frame, &[DISPLAY]));
        assert!(!placement.take_handed_back());
        placement.release_all();
        assert_eq!(placement.window.frame, Some(ORIGINAL));
        assert!(placement.take_handed_back());
    }

    /// A player whose `n`th call on the window (counted from `calls = 0`) is refused.
    struct RefusesNth {
        inner: FakeWindow,
        calls: u32,
        nth: u32,
    }

    impl PlayerWindow for RefusesNth {
        fn trusted(&self) -> bool {
            true
        }
        fn frame(&mut self) -> Result<Option<Rect>, String> {
            self.inner.frame()
        }
        fn apply(&mut self, op: Op) -> Result<(), String> {
            self.calls += 1;
            if self.calls == self.nth {
                return Err("refused".into());
            }
            self.inner.apply(op)
        }
        fn display_bounds(&self, rect: Rect) -> Rect {
            self.inner.display_bounds(rect)
        }
        fn displays(&self) -> Vec<Rect> {
            self.inner.displays()
        }
    }

    #[test]
    fn a_restore_that_fails_part_way_is_retried_by_the_next_settle_not_parked_again() {
        let mut placement = Placement::new(RefusesNth { inner: FakeWindow::with_player(), calls: 0, nth: 0 });
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        // The move on screen works, the resize is refused.
        placement.window.calls = 0;
        placement.window.nth = 2;
        placement.release_all();
        assert!(!placement.take_handed_back());
        assert!(!off_screen(placement.window.inner.frame, &[DISPLAY]));
        // The next window event retries the restore instead of parking the player for a card that is gone.
        assert_eq!(placement.refit(ORIGIN), Some(Status::NoPlayer));
        assert_eq!(placement.window.inner.frame, Some(ORIGINAL));
        assert!(placement.take_handed_back());
        // Nothing is held now, so there is nothing left to retry.
        assert_eq!(placement.refit(ORIGIN), None);
    }

    #[test]
    fn a_release_that_fails_does_not_report_the_hold_forgotten() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.window.fail_next = 1;
        assert!(!placement.release("a"));
        assert!(placement.release("a"));
    }

    #[test]
    fn no_hide_mute_is_requested_while_a_restore_is_being_retried() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 0);
        placement.window.fail_next = 1;
        placement.release_all();
        // Not asked to hide again, and the hide-mute is undone: the player is on its way back.
        placement.set_away(true, Some(ORIGIN));
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 70);
        assert_eq!(mute.slider.steps, vec![(false, 7), (true, 7)]);
    }

    #[test]
    fn a_fit_from_another_card_takes_over_a_failed_restore_and_ends_the_retrying() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.window.fail_next = 1;
        placement.release_all();
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
        // b holds the player over its card: a window move places it, and nothing restores it.
        assert_eq!(placement.refit(ORIGIN), Some(Status::Fitted));
        assert!(!placement.take_handed_back());
        assert!(placement.release("b"));
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn a_restore_when_the_player_is_gone_forgets_the_hold() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.window.frame = None;
        placement.release_all();
        assert!(placement.take_handed_back());
        // The next player is a fresh take: its frame is the new original.
        let fresh = r(300.0, 300.0, 400.0, 225.0);
        placement.window.frame = Some(fresh);
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
        placement.release("b");
        assert_eq!(placement.window.frame, Some(fresh));
    }

    #[test]
    fn the_next_card_after_a_failed_restore_does_not_record_the_parked_spot_as_the_original() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", false);
        placement.window.fail_next = 1;
        placement.release_all();
        // The failed hold counts as hidden, so b takes it over.
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
        assert!(placement.release("b"));
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn a_player_found_off_every_display_is_saved_at_a_clamped_on_screen_position() {
        let mut window = FakeWindow::with_player();
        window.frame = Some(r(4000.0, 100.0, 400.0, 225.0));
        let mut placement = Placement::new(window);
        placement.fit("a", CARD, ORIGIN);
        assert!(placement.release("a"));
        assert_eq!(placement.window.frame, Some(r(1336.0, 100.0, 400.0, 225.0)));
        // A frame partly on a display is kept as it is (ORIGINAL sticks out to the right).
        placement.window.frame = Some(ORIGINAL);
        placement.fit("a", CARD, ORIGIN);
        placement.release("a");
        assert_eq!(placement.window.frame, Some(ORIGINAL));
    }

    #[test]
    fn a_hold_parked_because_the_app_is_away_or_the_menu_is_open_is_not_taken_over() {
        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.set_away(true, Some(ORIGIN));
        let ops = placement.window.ops.len();
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::InUse);
        assert_eq!(placement.window.ops.len(), ops);

        let mut placement = Placement::new(FakeWindow::with_player());
        placement.fit("a", CARD, ORIGIN);
        placement.park("a", true);
        let ops = placement.window.ops.len();
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::InUse);
        assert_eq!(placement.window.ops.len(), ops);
        // Only the card's own hiding yields (a_parked_hold_yields_to_another_card...).
        placement.park("a", false);
        assert_eq!(placement.fit("b", CARD, ORIGIN), Status::Fitted);
    }

    #[test]
    fn only_an_accepted_fit_moves_the_mute_target() {
        let other = MuteTarget { source: "Other".into(), label: "Vol".into() };
        let mut placement = Placement::new(FakeWindow::with_player());
        assert_eq!(placement.fit_with_mute("a", CARD, ORIGIN, Some(target())), Status::Fitted);
        assert_eq!(placement.mute, Some(target()));
        // Refused: in use.
        assert_eq!(placement.fit_with_mute("b", CARD, ORIGIN, Some(other.clone())), Status::InUse);
        assert_eq!(placement.mute, Some(target()));
        // Refused: too small, from the holder itself.
        let small = r(0.0, 0.0, 200.0, 100.0);
        assert_eq!(placement.fit_with_mute("a", small, ORIGIN, Some(other.clone())), Status::TooSmall);
        assert_eq!(placement.mute, Some(target()));
        // Refused: no permission, no player.
        let mut denied = Placement::new(FakeWindow { trusted: false, ..FakeWindow::with_player() });
        denied.mute = Some(target());
        assert_eq!(denied.fit_with_mute("b", CARD, ORIGIN, Some(other.clone())), Status::NoPermission);
        assert_eq!(denied.mute, Some(target()));
        // Refused: BDOBB is away and holds nothing.
        let mut away = Placement::new(FakeWindow::with_player());
        away.mute = Some(target());
        away.set_away(true, Some(ORIGIN));
        assert_eq!(away.fit_with_mute("b", CARD, ORIGIN, Some(other.clone())), Status::Parked);
        assert_eq!(away.mute, Some(target()));
        // Accepted: the next fit by the new holder sets it.
        away.set_away(false, Some(ORIGIN));
        assert_eq!(away.fit_with_mute("b", CARD, ORIGIN, Some(other.clone())), Status::Fitted);
        assert_eq!(away.mute, Some(other));
    }

    #[test]
    fn a_blur_decision_is_dropped_when_the_focus_changed_since_it_was_recorded() {
        assert!(blur_result_is_current(7, 7));
        assert!(!blur_result_is_current(7, 8));
    }

    #[test]
    fn a_focus_loss_parks_unless_another_bdobb_window_or_the_player_has_it() {
        // (frontmost is BDOBB, frontmost is Chrome, Chrome's focused window is the player)
        assert!(!should_park_on_blur(true, false, false));
        assert!(!should_park_on_blur(false, true, true));
        assert!(should_park_on_blur(false, true, false));
        assert!(should_park_on_blur(false, false, false));
        // The player's focus only counts when Chrome is in front.
        assert!(should_park_on_blur(false, false, true));
    }

    /// The page's Volume Level slider: AXDecrement / AXIncrement move it 10%
    /// per step and stop at 0 and 100.
    struct FakeSlider {
        level: u8,
        broken: Option<String>,
        steps: Vec<(bool, u32)>,
        settles: Vec<u8>,
        log: Vec<&'static str>,
        step_fails: bool,
    }

    impl FakeSlider {
        fn at(level: u8) -> Self {
            Self { level, broken: None, steps: Vec::new(), settles: Vec::new(), log: Vec::new(), step_fails: false }
        }
    }

    impl VolumeSlider for FakeSlider {
        fn level(&mut self, _source: &str, _label: &str) -> Result<u8, String> {
            self.broken.clone().map_or(Ok(self.level), Err)
        }
        fn step(&mut self, _source: &str, _label: &str, up: bool, count: u32) -> Result<(), String> {
            if self.step_fails {
                return Err("refused".into());
            }
            self.log.push("step");
            self.steps.push((up, count));
            let moved = u32::from(STEP_PERCENT) * count;
            let level = u32::from(self.level);
            let next = if up { (level + moved).min(100) } else { level.saturating_sub(moved) };
            self.level = next as u8;
            Ok(())
        }
        fn settle(&mut self, _source: &str, _label: &str, target: u8) {
            self.log.push("settle");
            self.settles.push(target);
        }
    }

    #[test]
    fn the_page_starts_below_the_title_bar_by_the_measured_inset() {
        assert_eq!(top_inset(900.0, 0.0, 868.0), 32.0);
        assert_eq!(top_inset(900.0, 0.0, 900.0), 0.0, "full screen: no title bar");
        assert_eq!(top_inset(900.0, 10.0, 900.0), 0.0, "never negative");
        assert_eq!(top_inset(f64::NAN, 0.0, 868.0), 0.0);
    }

    const SRC: &str = "Live TV";
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
        assert_eq!(parse_percent("-5%"), None);
        assert_eq!(parse_percent("5%%"), None);
        assert_eq!(parse_percent("1e2%"), None);
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
    fn mute_waits_for_the_slider_to_reach_the_level_it_stepped_to() {
        let mut mute = Mute::new(FakeSlider::at(70));
        mute.set(SRC, LABEL, true);
        assert_eq!(mute.slider.settles, vec![0]);
        assert_eq!(mute.slider.log, vec!["step", "settle"]);
        mute.set(SRC, LABEL, false);
        assert_eq!(mute.slider.settles, vec![0, 70]);
        assert_eq!(mute.slider.log, vec!["step", "settle", "step", "settle"]);
    }

    #[test]
    fn the_settle_target_is_where_whole_steps_land() {
        let mut mute = Mute::new(FakeSlider::at(95));
        mute.set(SRC, LABEL, true);
        mute.set(SRC, LABEL, false);
        assert_eq!(mute.slider.settles, vec![0, 100]);
    }

    #[test]
    fn nothing_is_settled_when_nothing_was_stepped() {
        let mut mute = Mute::new(FakeSlider::at(0));
        mute.set(SRC, LABEL, true);
        let mut mute2 = Mute::new(FakeSlider::at(40));
        mute2.set(SRC, LABEL, false);
        assert!(mute.slider.settles.is_empty() && mute2.slider.settles.is_empty());
    }

    #[test]
    fn restore_also_waits_for_the_slider() {
        let mut mute = Mute::new(FakeSlider::at(60));
        mute.set(SRC, LABEL, true);
        mute.restore();
        assert_eq!(mute.slider.settles, vec![0, 60]);
    }

    fn target() -> MuteTarget {
        MuteTarget { source: SRC.into(), label: LABEL.into() }
    }

    /// What the native side does after every change: carries out the volume action the placement asks for.
    fn drive(placement: &mut Placement<FakeWindow>, mute: &mut Mute<FakeSlider>) {
        if let Some(action) = placement.take_volume_action() {
            mute.apply(action);
        }
    }

    fn held_with_mute(level: u8, on: bool) -> (Placement<FakeWindow>, Mute<FakeSlider>) {
        let mut placement = Placement::new(FakeWindow::with_player());
        let mut mute = Mute::new(FakeSlider::at(level));
        placement.fit_with_mute("a", CARD, ORIGIN, on.then(target));
        drive(&mut placement, &mut mute);
        (placement, mute)
    }

    #[test]
    fn hiding_mutes_and_coming_back_restores_the_level() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        assert_eq!(mute.slider.level, 70);
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 0);
        placement.fit("a", CARD, ORIGIN);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 70);
        assert_eq!(mute.slider.steps, vec![(false, 7), (true, 7)]);
    }

    #[test]
    fn hiding_again_while_hidden_mutes_once() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        placement.park("a", false);
        placement.set_away(true, Some(ORIGIN));
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.steps, vec![(false, 7)]);
    }

    #[test]
    fn a_player_the_user_already_muted_stays_muted_on_return() {
        let (mut placement, mut mute) = held_with_mute(0, true);
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        placement.fit("a", CARD, ORIGIN);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 0);
        assert!(mute.slider.steps.is_empty());
    }

    #[test]
    fn a_volume_the_user_raised_while_hidden_is_left_alone_on_return() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        mute.slider.level = 40;
        placement.fit("a", CARD, ORIGIN);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 40);
    }

    #[test]
    fn the_cards_menu_parks_without_muting() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        placement.park("a", true);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 70);
        assert!(mute.slider.steps.is_empty());
        // Hiding on top of the menu does mute, and closing the menu alone does not unmute.
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 0);
    }

    #[test]
    fn with_the_setting_off_nothing_is_muted() {
        let (mut placement, mut mute) = held_with_mute(70, false);
        placement.park("a", false);
        placement.set_away(true, Some(ORIGIN));
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 70);
        assert!(mute.slider.steps.is_empty());
    }

    #[test]
    fn the_app_going_away_mutes_and_coming_back_restores() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        placement.set_away(true, Some(ORIGIN));
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 0);
        placement.set_away(false, Some(ORIGIN));
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 70);
    }

    #[test]
    fn handing_the_player_back_while_hidden_also_hands_back_the_volume() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        placement.release("a");
        assert!(placement.take_handed_back());
        // The native side restores on a hand-back; the hide bookkeeping then has nothing left to undo.
        mute.restore();
        assert_eq!(placement.take_volume_action(), Some(VolumeAction::Unhide));
        mute.apply(VolumeAction::Unhide);
        assert_eq!(mute.slider.level, 70);
        assert_eq!(mute.slider.steps, vec![(false, 7), (true, 7)]);
    }

    #[test]
    fn a_slider_that_cannot_be_read_when_hiding_leaves_nothing_to_restore() {
        let (mut placement, mut mute) = held_with_mute(70, true);
        mute.slider.broken = Some("No slider".into());
        placement.park("a", false);
        drive(&mut placement, &mut mute);
        mute.slider.broken = None;
        placement.fit("a", CARD, ORIGIN);
        drive(&mut placement, &mut mute);
        assert_eq!(mute.slider.level, 70);
        assert!(mute.slider.steps.is_empty());
    }

    #[test]
    fn a_failed_step_down_records_no_level() {
        let mut slider = FakeSlider::at(70);
        slider.step_fails = true;
        let mut mute = Mute::new(slider);
        assert_eq!(mute.set(SRC, LABEL, true), MuteState::Unavailable { reason: "refused".into() });
        assert!(mute.slider.settles.is_empty());
        // The user silences it themselves; Unmute must not replay the 70.
        mute.slider.step_fails = false;
        mute.slider.level = 0;
        mute.set(SRC, LABEL, false);
        assert_eq!(mute.slider.steps, vec![(true, 10)]);
    }

    #[test]
    fn a_changed_source_or_label_forgets_the_recorded_level() {
        for (source, label) in [("Other Stream", LABEL), (SRC, "Volume")] {
            let mut mute = Mute::new(FakeSlider::at(70));
            mute.set(SRC, LABEL, true);
            assert_eq!(mute.state(source, label), MuteState::Muted);
            mute.set(source, label, false);
            assert_eq!(mute.slider.steps.last(), Some(&(true, 10)), "{source}/{label}");
        }
        let mut mute = Mute::new(FakeSlider::at(70));
        mute.set(SRC, LABEL, true);
        mute.set("Other Stream", LABEL, false);
        assert_eq!(mute.slider.steps.last(), Some(&(true, 10)));
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

    #[test]
    fn unmute_after_the_user_raised_the_volume_leaves_it_alone() {
        let mut mute = Mute::new(FakeSlider::at(70));
        mute.set(SRC, LABEL, true);
        mute.slider.level = 40;
        assert_eq!(mute.set(SRC, LABEL, false), MuteState::Sound);
        assert_eq!(mute.slider.level, 40);
        assert_eq!(mute.slider.steps, vec![(false, 7)]);
    }

    #[test]
    fn a_restore_that_cannot_read_the_slider_keeps_the_recorded_level() {
        let mut mute = Mute::new(FakeSlider::at(60));
        mute.set(SRC, LABEL, true);
        mute.slider.broken = Some("Chrome is not responding".into());
        mute.restore();
        assert_eq!(mute.slider.level, 0);
        mute.slider.broken = None;
        mute.restore();
        assert_eq!(mute.slider.level, 60);
    }

    #[test]
    fn restore_after_the_user_raised_the_volume_leaves_it_alone() {
        let mut mute = Mute::new(FakeSlider::at(70));
        mute.set(SRC, LABEL, true);
        mute.slider.level = 40;
        mute.restore();
        assert_eq!(mute.slider.level, 40);
        assert_eq!(mute.slider.steps, vec![(false, 7)]);
    }
}
