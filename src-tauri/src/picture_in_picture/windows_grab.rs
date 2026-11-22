// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! Physical-pixel Windows placement. The OS boundary validates a per-window
//! generation token on every read/write; a reused HWND is a different player.
use super::logic::{Rect, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlayerKey {
    pub handle: usize,
    pub pid: u32,
    pub started: u64,
    pub token: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct Player {
    pub key: PlayerKey,
    pub frame: Rect,
}
pub trait Windows {
    fn select(&mut self) -> Result<Option<Player>, String>;
    fn frame(&self, key: PlayerKey) -> Option<Rect>;
    fn place(&mut self, key: PlayerKey, frame: Rect) -> Result<Rect, String>;
    fn displays(&self) -> Vec<Rect>;
    fn relinquish(&mut self, key: PlayerKey);
}
struct Hold {
    card: String,
    player: PlayerKey,
    saved: Rect,
    target: Rect,
    hidden: bool,
    menu: bool,
    away: bool,
    releasing: bool,
}
pub struct Grab<W> {
    pub windows: W,
    hold: Option<Hold>,
}
fn target(area: Rect, scale: f64) -> Result<Option<Rect>, String> {
    if ![area.x, area.y, area.width, area.height, scale]
        .iter()
        .all(|n| n.is_finite())
        || scale <= 0.
        || area.width < 0.
        || area.height < 0.
    {
        return Err("Invalid player geometry".into());
    }
    let css = Rect {
        x: 0.,
        y: 0.,
        width: area.width / scale,
        height: area.height / scale,
    };
    Ok(super::logic::fit_16x9(css).map(|r| Rect {
        x: area.x + r.x * scale,
        y: area.y,
        width: r.width * scale,
        height: r.height * scale,
    }))
}
fn near(a: Rect, b: Rect) -> bool {
    [
        (a.x, b.x),
        (a.y, b.y),
        (a.width, b.width),
        (a.height, b.height),
    ]
    .iter()
    .all(|(x, y)| (x - y).abs() <= 1.)
}
/// Preserve a usable original physical frame; after undocking, return it
/// wholly to the nearest remaining display rather than an absent monitor.
fn restore_target(saved: Rect, displays: &[Rect]) -> Rect {
    if displays.is_empty() || displays.iter().any(|d|
        saved.x < d.x + d.width && saved.x + saved.width > d.x &&
        saved.y < d.y + d.height && saved.y + saved.height > d.y) {
        return saved;
    }
    let distance = |d: &&Rect| {
        let dx = saved.x + saved.width / 2. - (d.x + d.width / 2.);
        let dy = saved.y + saved.height / 2. - (d.y + d.height / 2.);
        dx * dx + dy * dy
    };
    let Some(display) = displays.iter().filter(|d| d.width > 0. && d.height > 0.)
        .min_by(|a,b| distance(a).total_cmp(&distance(b))) else { return saved };
    let scale = (display.width / saved.width).min(display.height / saved.height).min(1.);
    let (width,height) = (saved.width * scale, saved.height * scale);
    Rect {
        x: saved.x.max(display.x).min(display.x + display.width - width),
        y: saved.y.max(display.y).min(display.y + display.height - height),
        width, height,
    }
}
impl<W: Windows> Grab<W> {
    pub fn new(windows: W) -> Self {
        Self {
            windows,
            hold: None,
        }
    }
    fn forget(&mut self) {
        if let Some(h) = self.hold.take() {
            self.windows.relinquish(h.player);
        }
    }
    fn check(&mut self) {
        if self
            .hold
            .as_ref()
            .is_some_and(|h| self.windows.frame(h.player).is_none())
        {
            self.forget();
        }
    }
    pub fn player_key(&self) -> Option<PlayerKey> {
        self.hold.as_ref().map(|h| h.player)
    }
    /// Never expose another card's player or a window that has lost its claim.
    pub fn active_player(&mut self, card: &str) -> Option<PlayerKey> {
        self.check();
        let h = self.hold.as_ref()?;
        (h.card == card && !h.hidden && !h.menu && !h.away && !h.releasing)
            .then_some(h.player)
    }
    pub fn fit(&mut self, card: &str, area: Rect, scale: f64, away: bool) -> Status {
        let goal = match target(area, scale) {
            Ok(Some(r)) => r,
            Ok(None) => {
                self.release(card);
                return Status::TooSmall;
            }
            Err(reason) => return Status::Failed { reason },
        };
        self.check();
        if self.hold.as_ref().is_some_and(|h| h.releasing) {
            self.release_all();
            if self.hold.is_some() {
                return Status::Failed {
                    reason: "Could not restore Chrome's player; retrying".into(),
                };
            }
        }
        if self
            .hold
            .as_ref()
            .is_some_and(|h| h.card != card && !h.hidden)
        {
            return Status::InUse;
        }
        if self.hold.is_none() {
            if away {
                return Status::Parked;
            }
            match self.windows.select() {
                Ok(Some(p)) => {
                    self.hold = Some(Hold {
                        card: card.into(),
                        player: p.key,
                        saved: p.frame,
                        target: goal,
                        hidden: false,
                        menu: false,
                        away,
                        releasing: false,
                    })
                }
                Ok(None) => return Status::NoPlayer,
                Err(reason) => return Status::Failed { reason },
            }
        }
        let h = self.hold.as_mut().expect("claimed player");
        h.card = card.into();
        h.target = goal;
        h.hidden = false;
        h.menu = false;
        h.away = away;
        self.settle()
    }
    pub fn park(&mut self, card: &str, menu: bool) -> Status {
        self.check();
        if let Some(h) = self.hold.as_mut().filter(|h| h.card == card) {
            if menu {
                h.menu = true;
            } else {
                h.hidden = true;
            }
            self.settle()
        } else {
            Status::Parked
        }
    }
    pub fn sync(&mut self, area: Rect, scale: f64, away: bool) -> Status {
        self.check();
        let Some(h) = self.hold.as_mut() else {
            return Status::NoPlayer;
        };
        h.away = away;
        match target(area, scale) {
            Ok(Some(r)) => h.target = r,
            Ok(None) => {
                self.release_all();
                return Status::TooSmall;
            }
            Err(reason) => return Status::Failed { reason },
        }
        self.settle()
    }
    fn settle(&mut self) -> Status {
        let Some(h) = self.hold.as_ref() else {
            return Status::NoPlayer;
        };
        if h.releasing {
            self.release_all();
            return if self.hold.is_none() {
                Status::NoPlayer
            } else {
                Status::Failed {
                    reason: "Could not restore Chrome's player; retrying".into(),
                }
            };
        }
        let parked = h.hidden || h.menu || h.away;
        let key = h.player;
        let mut goal = h.target;
        if parked {
            let Some(frame) = self.windows.frame(key) else {
                self.forget();
                return Status::NoPlayer;
            };
            let (x, y) = super::logic::park_point(&self.windows.displays());
            goal = Rect { x, y, ..frame };
        }
        if self.windows.frame(key).is_some_and(|r| near(r, goal)) {
            return if parked {
                Status::Parked
            } else {
                Status::Fitted
            };
        }
        match self.windows.place(key, goal) {
            Ok(mut actual) => {
                if !parked && (actual.width > goal.width + 1. || actual.height > goal.height + 1.) {
                    self.release_all();
                    return Status::TooSmall;
                }
                let expected = if parked {
                    goal
                } else {
                    Rect {
                        x: goal.x + (goal.width - actual.width) / 2.,
                        y: goal.y,
                        ..actual
                    }
                };
                if !parked && !near(actual, expected) {
                    actual = match self.windows.place(key, expected) {
                        Ok(frame) => frame,
                        Err(reason) => return self.failed_move(reason),
                    };
                }
                if !near(actual, expected) {
                    return self.failed_move("Chrome did not accept the requested player position".into());
                }
                if parked {
                    Status::Parked
                } else {
                    Status::Fitted
                }
            }
            Err(reason) => self.failed_move(reason),
        }
    }
    fn failed_move(&mut self, reason: String) -> Status {
        self.release_all();
        Status::Failed { reason }
    }
    pub fn release(&mut self, card: &str) {
        if self.hold.as_ref().is_some_and(|h| h.card == card) {
            self.release_all();
        }
    }
    pub fn release_all(&mut self) {
        self.check();
        let Some(h) = self.hold.as_mut() else {
            return;
        };
        h.releasing = true;
        let restore = restore_target(h.saved, &self.windows.displays());
        if self
            .windows
            .place(h.player, restore)
            .is_ok_and(|r| near(r, restore))
        {
            self.forget();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn r(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect {
            x,
            y,
            width: w,
            height: h,
        }
    }
    const KEY: PlayerKey = PlayerKey {
        handle: 7,
        pid: 11,
        started: 13,
        token: 17,
    };
    #[test]
    fn captured_audio_never_uses_a_hidden_or_replaced_player() {
        let mut g = Grab::new(Desktop::default());
        assert_eq!(g.active_player("a"), None);
        let area = r(100., 100., 640., 400.);
        g.fit("a", area, 1., false);
        assert_eq!(g.active_player("a"), Some(KEY));
        assert_eq!(g.active_player("other"), None);
        g.park("a", true);
        assert_eq!(g.active_player("a"), None);
        g.fit("a", area, 1., false);
        g.park("a", false);
        assert_eq!(g.active_player("a"), None);
        g.fit("a", area, 1., true);
        assert_eq!(g.active_player("a"), None);
        g.fit("a", area, 1., false);
        g.hold.as_mut().unwrap().releasing = true;
        assert_eq!(g.active_player("a"), None);
        g.hold.as_mut().unwrap().releasing = false;
        g.windows.player.as_mut().unwrap().key.token += 1;
        assert_eq!(g.active_player("a"), None);
    }
    struct Desktop {
        player: Option<Player>,
        writes: Vec<(PlayerKey, Rect)>,
        relinquished: Vec<PlayerKey>,
        fail: bool,
        ignore: bool,
        partial_failure: bool,
        displays: Vec<Rect>,
    }
    impl Default for Desktop {
        fn default() -> Self {
            Self {
                player: Some(Player {
                    key: KEY,
                    frame: r(-800., 50., 320., 180.),
                }),
                writes: vec![],
                relinquished: vec![],
                fail: false,
                ignore: false,
                partial_failure: false,
                displays: vec![r(-1920., 0., 1920., 1080.), r(0., 0., 2560., 1440.)],
            }
        }
    }
    impl Windows for Desktop {
        fn select(&mut self) -> Result<Option<Player>, String> {
            Ok(self.player)
        }
        fn frame(&self, key: PlayerKey) -> Option<Rect> {
            self.player.filter(|p| p.key == key).map(|p| p.frame)
        }
        fn place(&mut self, key: PlayerKey, frame: Rect) -> Result<Rect, String> {
            if self.partial_failure {
                self.partial_failure = false;
                self.player.as_mut().unwrap().frame = r(frame.x + 20., frame.y + 10., frame.width, frame.height);
                return Err("partially moved".into());
            }
            if self.fail {
                return Err("refused".into());
            }
            let p = self
                .player
                .as_mut()
                .filter(|p| p.key == key)
                .ok_or("stale player")?;
            if self.ignore {
                return Ok(p.frame);
            }
            p.frame = frame;
            self.writes.push((key, frame));
            Ok(frame)
        }
        fn displays(&self) -> Vec<Rect> {
            self.displays.clone()
        }
        fn relinquish(&mut self, key: PlayerKey) {
            self.relinquished.push(key)
        }
    }
    #[test]
    fn fits_css_size_in_physical_pixels_on_negative_display_at_125_percent() {
        let mut g = Grab::new(Desktop::default());
        assert_eq!(
            g.fit("a", r(-1800., 100., 800., 500.), 1.25, false),
            Status::Fitted
        );
        assert_eq!(g.windows.player.unwrap().frame, r(-1800., 100., 800., 450.));
        g.release("a");
        assert_eq!(g.windows.player.unwrap().frame, r(-800., 50., 320., 180.));
    }
    #[test]
    fn minimum_is_scaled_before_claiming_the_player() {
        let mut g = Grab::new(Desktop::default());
        assert_eq!(
            g.fit("a", r(0., 0., 300., 200.), 1.25, false),
            Status::TooSmall
        );
        assert!(g.windows.writes.is_empty());
        assert!(g.player_key().is_none());
    }
    #[test]
    fn maximum_is_scaled_and_centered_in_the_physical_card() {
        let mut g = Grab::new(Desktop::default());
        assert_eq!(
            g.fit("a", r(100., 200., 4000., 2400.), 2., false),
            Status::Fitted
        );
        assert_eq!(
            g.windows.player.unwrap().frame,
            r(712., 200., 2776., 1561.5)
        );
    }
    #[test]
    fn another_visible_card_cannot_steal_the_player_but_hidden_owner_can_yield() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        assert_eq!(
            g.fit("b", r(500., 200., 640., 400.), 1., false),
            Status::InUse
        );
        assert_eq!(g.park("a", false), Status::Parked);
        assert_eq!(g.windows.player.unwrap().frame.x, 2760.);
        assert_eq!(
            g.fit("b", r(500., 200., 640., 400.), 1., false),
            Status::Fitted
        );
        g.release("a");
        assert_eq!(g.windows.player.unwrap().frame.x, 500.);
        g.release("b");
        assert_eq!(g.windows.player.unwrap().frame, r(-800., 50., 320., 180.));
    }
    #[test]
    fn menu_and_background_parking_dont_yield_or_get_undone_by_geometry_sync() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.park("a", true);
        g.sync(r(200., 300., 640., 400.), 1., false);
        assert_eq!(g.windows.player.unwrap().frame.x, 2760.);
        assert_eq!(g.fit("b", r(0., 0., 640., 400.), 1., false), Status::InUse);
        g.fit("a", r(200., 300., 640., 400.), 1., false);
        assert_eq!(g.windows.player.unwrap().frame, r(200., 300., 640., 360.));
        g.sync(r(200., 300., 640., 400.), 1., true);
        assert_eq!(g.windows.player.unwrap().frame.x, 2760.);
        g.sync(r(200., 300., 640., 400.), 1., false);
        assert_eq!(g.windows.player.unwrap().frame.x, 200.);
    }
    #[test]
    fn dpi_change_keeps_original_physical_geometry_for_restore() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 800., 500.), 1.25, false);
        g.sync(r(-1800., 100., 1280., 800.), 2., false);
        assert_eq!(
            g.windows.player.unwrap().frame,
            r(-1800., 100., 1280., 720.)
        );
        g.release_all();
        assert_eq!(g.windows.player.unwrap().frame, r(-800., 50., 320., 180.));
    }
    #[test]
    fn hwnd_reused_by_same_process_never_gets_a_stale_restore() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.windows.player = Some(Player {
            key: PlayerKey { token: 99, ..KEY },
            frame: r(10., 20., 400., 225.),
        });
        let writes = g.windows.writes.len();
        g.release_all();
        assert_eq!(g.windows.writes.len(), writes);
        assert_eq!(g.windows.player.unwrap().frame, r(10., 20., 400., 225.));
        assert_eq!(
            g.fit("a", r(100., 200., 640., 400.), 1., false),
            Status::Fitted
        );
        g.release_all();
        assert_eq!(g.windows.player.unwrap().frame, r(10., 20., 400., 225.));
    }
    #[test]
    fn failed_restore_keeps_the_original_and_retries_without_recapture() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.windows.fail = true;
        g.release_all();
        assert_eq!(g.player_key(), Some(KEY));
        assert!(matches!(
            g.fit("a", r(0., 0., 640., 400.), 1., false),
            Status::Failed { .. }
        ));
        g.windows.fail = false;
        g.release_all();
        assert_eq!(g.windows.player.unwrap().frame, r(-800., 50., 320., 180.));
        assert_eq!(g.player_key(), None);
        assert_eq!(g.windows.relinquished, vec![KEY]);
    }
    #[test]
    fn invalid_geometry_or_background_does_not_acquire_a_foreign_window() {
        let mut g = Grab::new(Desktop::default());
        assert!(matches!(
            g.fit("a", r(f64::NAN, 0., 640., 400.), 1., false),
            Status::Failed { .. }
        ));
        assert!(matches!(
            g.fit("a", r(0., 0., 640., 400.), 0., false),
            Status::Failed { .. }
        ));
        assert_eq!(g.fit("a", r(0., 0., 640., 400.), 1., true), Status::Parked);
        assert!(g.windows.writes.is_empty());
        assert!(g.player_key().is_none());
    }
    #[test]
    fn ignored_os_position_change_is_never_reported_as_fitted_or_parked() {
        let mut g = Grab::new(Desktop::default());
        g.windows.ignore = true;
        assert!(matches!(
            g.fit("a", r(100., 200., 640., 400.), 1., false),
            Status::Failed { .. }
        ));
        g.windows.ignore = false;
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.windows.ignore = true;
        assert!(matches!(g.park("a", false), Status::Failed { .. }));
    }
    #[test]
    fn successful_os_call_with_wrong_restore_frame_keeps_the_hold() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.windows.ignore = true;
        g.release_all();
        assert_eq!(g.player_key(), Some(KEY));
        g.windows.ignore = false;
        g.release_all();
        assert_eq!(g.player_key(), None);
        assert_eq!(g.windows.player.unwrap().frame, r(-800., 50., 320., 180.));
    }
    #[test]
    fn a_partly_failed_fit_restores_the_original_and_frees_the_owner() {
        let mut g = Grab::new(Desktop::default());
        g.windows.partial_failure = true;
        assert!(matches!(g.fit("a", r(100., 200., 640., 400.), 1., false), Status::Failed { .. }));
        assert_eq!(g.windows.player.unwrap().frame, r(-800., 50., 320., 180.));
        assert_eq!(g.player_key(), None);
        assert_eq!(g.fit("b", r(300., 100., 640., 400.), 1., false), Status::Fitted);
    }
    #[test]
    fn restore_after_display_removal_places_the_player_on_a_remaining_display() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.windows.displays = vec![r(0., 0., 2560., 1440.)];
        g.release_all();
        assert_eq!(g.windows.player.unwrap().frame, r(0., 50., 320., 180.));
        assert_eq!(g.player_key(), None);
    }
    #[test]
    fn restore_to_a_smaller_remaining_display_keeps_the_player_accessible() {
        let mut g = Grab::new(Desktop::default());
        g.fit("a", r(100., 200., 640., 400.), 1., false);
        g.windows.displays = vec![r(0., 0., 160., 90.)];
        g.release_all();
        assert_eq!(g.windows.player.unwrap().frame, r(0., 0., 160., 90.));
        assert_eq!(g.player_key(), None);
    }

}
