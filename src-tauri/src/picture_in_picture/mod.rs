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

use logic::{MuteState, Rect, Status};

#[cfg(not(target_os = "macos"))]
fn unsupported() -> MuteState {
    MuteState::Unavailable { reason: "Available in the macOS desktop app".into() }
}

#[tauri::command]
pub async fn picture_in_picture_fit(window: tauri::WebviewWindow, card: String, rect: Rect) -> Status {
    #[cfg(target_os = "macos")]
    return native::fit(&window, &card, rect);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, card, rect);
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
    use std::sync::{Mutex, Once, PoisonError};
    use std::time::Duration;

    use tauri::{WebviewWindow, WindowEvent};

    use super::ax::{AxSlider, AxWindow};
    use super::logic::{Mute, MuteState, Placement, Rect, Status};

    /// Only the main window parks the player (spec, States: viewer window).
    const MAIN: &str = "main";
    /// Tauri reports no minimise event. A focus loss is followed by this
    /// wait and then is_minimized().
    /// ponytail: fixed delay; switch to an NSWindow miniaturize observer if 700 ms misses the animation.
    const MINIMISE_SETTLE: Duration = Duration::from_millis(700);

    // Two locks, so the slider search (about 150 ms) never holds up a re-fit
    // during a drag. Never call a Tauri window method while holding either:
    // the window event handler runs on the main thread and takes them too.
    static PLACEMENT: Mutex<Option<Placement<AxWindow>>> = Mutex::new(None);
    static MUTE: Mutex<Option<Mute<AxSlider>>> = Mutex::new(None);
    static HOOKED: Once = Once::new();

    fn placement<T>(f: impl FnOnce(&mut Placement<AxWindow>) -> T) -> T {
        let mut guard = PLACEMENT.lock().unwrap_or_else(PoisonError::into_inner);
        f(guard.get_or_insert_with(|| Placement::new(AxWindow::default())))
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

    /// Runs `f` on the placement, then restores the volume if it handed the player
    /// back, whatever the path. The placement lock is dropped first.
    fn placement_and_volume<T>(f: impl FnOnce(&mut Placement<AxWindow>) -> T) -> T {
        let (result, handed_back) = placement(|p| (f(p), p.take_handed_back()));
        if handed_back {
            mute(|m| m.restore());
        }
        result
    }

    pub fn fit(window: &WebviewWindow, card: &str, rect: Rect) -> Status {
        if window.label() != MAIN {
            return Status::ViewerWindow;
        }
        hook(window);
        // A minimised window leaves the player alone; un-minimising re-takes it via the Focused(true) refit and the next recheck.
        if window.is_minimized().unwrap_or(false) {
            return Status::Fitted;
        }
        let Some(origin) = origin(window) else {
            return Status::Failed { reason: "BDOBB cannot read its own window position".into() };
        };
        placement_and_volume(|p| p.fit(card, rect, origin))
    }

    pub fn release(card: &str) {
        placement_and_volume(|p| p.release(card));
    }

    pub fn release_all() {
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
            placement_and_volume(|p| p.suspend());
            return;
        }
        if let Some(origin) = origin(window) {
            placement_and_volume(|p| p.refit(origin));
        }
    }
}
