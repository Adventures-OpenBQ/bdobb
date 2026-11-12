// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! Picture in Picture: parks Chrome's floating video player over a card (spec
//! docs/superpowers/specs/2026-11-12-picture-in-picture-card-design.md). The
//! commands exist on every platform. Only macOS implements them; the others
//! answer "not supported", which the card reads as its placeholder.

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod logic;
#[cfg(target_os = "macos")]
mod ax;

use logic::{MuteState, MuteTarget, Rect, Status};

#[cfg(not(target_os = "macos"))]
fn unsupported() -> MuteState {
    MuteState::Unavailable { reason: "Available in the macOS desktop app".into() }
}

#[tauri::command]
pub async fn picture_in_picture_fit(
    window: tauri::WebviewWindow,
    card: String,
    rect: Rect,
    mute: Option<MuteTarget>,
) -> Status {
    #[cfg(target_os = "macos")]
    return native::fit(&window, &card, rect, mute);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, card, rect, mute);
        Status::NotSupported
    }
}

/// The card is hidden (`menu` false) or its own menu is open (`menu` true):
/// the player moves off screen but stays held.
#[tauri::command]
pub async fn picture_in_picture_park(card: String, menu: bool) -> Status {
    #[cfg(target_os = "macos")]
    return native::park(&card, menu);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (card, menu);
        Status::NotSupported
    }
}

#[tauri::command]
pub async fn picture_in_picture_release(card: String) {
    #[cfg(target_os = "macos")]
    native::release(&card);
    #[cfg(not(target_os = "macos"))]
    let _ = card;
}

#[tauri::command]
pub async fn picture_in_picture_set_muted(source: String, label: String, muted: bool) -> MuteState {
    #[cfg(target_os = "macos")]
    return native::set_muted(&source, &label, muted);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, label, muted);
        unsupported()
    }
}

#[tauri::command]
pub async fn picture_in_picture_mute_state(source: String, label: String) -> MuteState {
    #[cfg(target_os = "macos")]
    return native::mute_state(&source, &label);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, label);
        unsupported()
    }
}

#[tauri::command]
pub async fn picture_in_picture_open_settings() {
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
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, Once, OnceLock, PoisonError};
    use std::time::Duration;

    use tauri::{WebviewWindow, WindowEvent};

    use super::ax::{AxSlider, AxWindow};
    use super::ax::blur_inputs;
    use super::logic::{blur_result_is_current, should_park_on_blur, top_inset, Mute, MuteState, MuteTarget, Placement, Rect, Status};

    /// Only the main window parks the player (spec, States: viewer window).
    const MAIN: &str = "main";
    /// Tauri reports no minimise event. A focus loss is followed by this
    /// wait and then is_minimized() and the frontmost-app check.
    /// ponytail: fixed delay; switch to an NSWindow miniaturize observer if 700 ms misses the animation.
    const MINIMISE_SETTLE: Duration = Duration::from_millis(700);

    // Two locks, so the slider search (about 150 ms) never holds up a re-fit
    // during a drag. Never call a Tauri window method while holding either:
    // the window event handler runs on the main thread and takes them too.
    static PLACEMENT: Mutex<Option<Placement<AxWindow>>> = Mutex::new(None);
    static MUTE: Mutex<Option<Mute<AxSlider>>> = Mutex::new(None);
    static HOOKED: Once = Once::new();
    /// Bumped by every focus event; a blur decision made before the latest one is stale.
    static FOCUS_GENERATION: AtomicU64 = AtomicU64::new(0);
    /// Set at the start of the quit or window-destroy path: queued volume work then does nothing.
    static QUITTING: AtomicBool = AtomicBool::new(false);

    fn placement<T>(f: impl FnOnce(&mut Placement<AxWindow>) -> T) -> T {
        let mut guard = PLACEMENT.lock().unwrap_or_else(PoisonError::into_inner);
        f(guard.get_or_insert_with(|| Placement::new(AxWindow::default())))
    }

    fn mute<T>(f: impl FnOnce(&mut Mute<AxSlider>) -> T) -> T {
        let mut guard = MUTE.lock().unwrap_or_else(PoisonError::into_inner);
        f(guard.get_or_insert_with(|| Mute::new(AxSlider::default())))
    }

    /// Points between the window's top edge and the top of the page, as f64
    /// bits; `UNMEASURED` until the main thread has asked AppKit once.
    static TOP_INSET: AtomicU64 = AtomicU64::new(UNMEASURED);
    const UNMEASURED: u64 = u64::MAX;

    /// Asks AppKit where the page starts. Tauri reports the content area as
    /// the whole window here (inner position and size equal the outer ones),
    /// yet the page is laid out below the title bar; `contentLayoutRect` is
    /// the part of the window the title bar does not cover. MAIN THREAD ONLY.
    fn measure_inset(window: &WebviewWindow) {
        use objc2::{msg_send, runtime::AnyObject};
        use objc2_foundation::NSRect;
        let inset = window.ns_window().ok().map(|ptr| ptr.cast::<AnyObject>()).filter(|ns| !ns.is_null()).map_or(0.0, |ns| {
            // SAFETY: `ns` is this window's live NSWindow and this runs on the main thread.
            let (frame, layout): (NSRect, NSRect) = unsafe { (msg_send![ns, frame], msg_send![ns, contentLayoutRect]) };
            top_inset(frame.size.height, layout.origin.y, layout.size.height)
        });
        TOP_INSET.store(inset.to_bits(), Ordering::SeqCst);
    }

    /// The measured inset; a command thread that arrives before any window
    /// event has the main thread measure it and waits briefly for the answer.
    fn inset(window: &WebviewWindow) -> f64 {
        if TOP_INSET.load(Ordering::SeqCst) == UNMEASURED {
            let (done, wait) = channel();
            let main = window.clone();
            if window.run_on_main_thread(move || { measure_inset(&main); let _ = done.send(()); }).is_ok() {
                let _ = wait.recv_timeout(Duration::from_millis(500));
            }
        }
        match TOP_INSET.load(Ordering::SeqCst) {
            UNMEASURED => 0.0,
            bits => f64::from_bits(bits),
        }
    }

    /// The top-left of the page in global points, so a CSS rectangle plus
    /// this is a screen rectangle.
    fn origin(window: &WebviewWindow) -> Option<(f64, f64)> {
        let scale = window.scale_factor().ok()?;
        let position = window.inner_position().ok()?;
        Some((f64::from(position.x) / scale, f64::from(position.y) / scale + inset(window)))
    }

    type Job = Box<dyn FnOnce(&mut Mute<AxSlider>) + Send>;

    /// Runs `f` on the placement and returns the volume change it calls for:
    /// a restore if it handed the player back, whatever the path; a mute or
    /// its undoing if it parked or un-parked a hidden player. The placement
    /// lock is dropped before the job is returned.
    fn with_placement<T>(f: impl FnOnce(&mut Placement<AxWindow>) -> T) -> (T, Option<Job>) {
        let (result, handed_back, action) = placement(|p| (f(p), p.take_handed_back(), p.take_volume_action()));
        let job: Option<Job> = if handed_back {
            Some(Box::new(|m| m.restore()))
        } else {
            action.map(|action| -> Job { Box::new(move |m| m.apply(action)) })
        };
        (result, job)
    }

    /// For the quit path: the volume change happens before this returns, and
    /// whatever the worker still has queued is skipped (QUITTING is already set).
    fn placement_and_volume<T>(f: impl FnOnce(&mut Placement<AxWindow>) -> T) -> T {
        let (result, job) = with_placement(f);
        if let Some(job) = job {
            mute(job);
        }
        result
    }

    /// For the commands and the window-event thread, which must not wait on
    /// Chrome (a slider search takes about 150 ms, a hung Chrome a second per
    /// call): the volume change goes to one worker thread, which keeps them in
    /// order, so a hide can never land between a queued hide and its unhide.
    /// The worker checks QUITTING under the mute lock, so nothing queued runs
    /// after the quit's restore.
    fn placement_and_volume_queued<T>(f: impl FnOnce(&mut Placement<AxWindow>) -> T) -> T {
        static WORKER: OnceLock<Sender<Job>> = OnceLock::new();
        let (result, job) = with_placement(f);
        if let Some(job) = job {
            let worker = WORKER.get_or_init(|| {
                let (sender, jobs) = channel::<Job>();
                std::thread::spawn(move || {
                    for job in jobs {
                        mute(|m| {
                            if !QUITTING.load(Ordering::SeqCst) {
                                job(m);
                            }
                        });
                    }
                });
                sender
            });
            let _ = worker.send(job);
        }
        result
    }

    pub fn fit(window: &WebviewWindow, card: &str, rect: Rect, target: Option<MuteTarget>) -> Status {
        if window.label() != MAIN {
            return Status::ViewerWindow;
        }
        hook(window);
        // A minimised window has no usable origin; the hold stays parked, and un-minimising refits via Focused(true).
        if window.is_minimized().unwrap_or(false) {
            return Status::Parked;
        }
        let Some(origin) = origin(window) else {
            return Status::Failed { reason: "BDOBB cannot read its own window position".into() };
        };
        placement_and_volume_queued(|p| p.fit_with_mute(card, rect, origin, target))
    }

    pub fn park(card: &str, menu: bool) -> Status {
        placement_and_volume_queued(|p| p.park(card, menu))
    }

    pub fn release(card: &str) {
        placement_and_volume_queued(|p| p.release(card));
    }

    pub fn release_all() {
        // First, so a queued hide-mute cannot run after this restore.
        QUITTING.store(true, Ordering::SeqCst);
        placement_and_volume(|p| p.release_all());
        // Quit: restore even when no card held the player.
        mute(|m| m.restore());
    }

    pub fn set_muted(source: &str, label: &str, muted: bool) -> MuteState {
        mute(|m| m.set(source, label, muted))
    }

    pub fn mute_state(source: &str, label: &str) -> MuteState {
        mute(|m| m.state(source, label))
    }

    /// Follows the main window: a move, a resize or a change of display
    /// re-fits; minimising or losing the front parks the player; closing
    /// releases it.
    fn hook(window: &WebviewWindow) {
        HOOKED.call_once(|| {
            let main = window.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    // Window events arrive on the main thread; full screen and back changes the inset.
                    measure_inset(&main);
                    sync(&main, main.is_focused().unwrap_or(false))
                }
                WindowEvent::Focused(true) => {
                    FOCUS_GENERATION.fetch_add(1, Ordering::SeqCst);
                    sync(&main, true)
                }
                WindowEvent::Focused(false) => {
                    let recorded = FOCUS_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
                    let main = main.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(MINIMISE_SETTLE);
                        // The window is read BEFORE either lock is taken.
                        let (this, chrome, player) = blur_inputs();
                        let away = main.is_minimized().unwrap_or(false) || should_park_on_blur(this, chrome, player);
                        // Checked under the placement lock: a focus event after this
                        // point queues behind it, so a late "away" never outlives the
                        // "back" that followed it.
                        set_away(&main, away, || blur_result_is_current(recorded, FOCUS_GENERATION.load(Ordering::SeqCst)));
                    });
                }
                WindowEvent::Destroyed => release_all(),
                _ => {}
            });
        });
    }

    fn set_away(window: &WebviewWindow, away: bool, current: impl FnOnce() -> bool) {
        let origin = origin(window);
        placement_and_volume_queued(|p| {
            if current() {
                p.set_away(away, origin);
            }
        });
    }

    /// The window is read BEFORE either lock is taken.
    fn sync(window: &WebviewWindow, focused: bool) {
        if window.is_minimized().unwrap_or(false) {
            set_away(window, true, || true);
        } else if focused {
            set_away(window, false, || true);
        } else if let Some(origin) = origin(window) {
            placement_and_volume_queued(|p| p.refit(origin));
        }
    }
}
