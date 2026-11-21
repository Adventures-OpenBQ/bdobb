// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
mod logic;
use tauri::{Emitter, Manager};

/// Only the trusted main app requests these windows. The player receives a
/// fixed loopback URL; no remote native-IPC capability is granted to it.
#[tauri::command]
pub async fn youtube_pip_open(window: tauri::WebviewWindow, card: String, id: String,
    autoplay: bool, muted: bool, focus: bool) -> Result<(), String> {
    logic::validate_owner(window.label()).map_err(String::from)?;
    let label = logic::card_label(&card).map_err(String::from)?;
    logic::player_url(1, &id, autoplay, muted).map_err(String::from)?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let port = crate::video_wrapper::video_wrapper_port().ok_or("The video wrapper is unavailable")?;
        let url = logic::player_url(port, &id, autoplay, muted).map_err(String::from)?;
        let url = url.parse().map_err(|_| "Invalid local player URL")?;
        let app = window.app_handle();
        if let Some(player) = app.get_webview_window(&label) {
            if player.url().map_err(|e|e.to_string())? != url {
                player.navigate(url).map_err(|e|e.to_string())?;
            }
            player.show().map_err(|e|e.to_string())?;
            if focus {player.set_focus().map_err(|e|e.to_string())?;}
            return Ok(());
        }
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(url))
            .title("Live TV — Picture in Picture")
            .inner_size(480.0, 270.0).min_inner_size(284.0, 160.0)
            .always_on_top(true).visible_on_all_workspaces(true)
            .resizable(true).focused(focus).build().map_err(|e|e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { let _ = (label, focus); Err("Desktop picture in picture is unavailable on this platform".into()) }
}

#[tauri::command]
pub async fn youtube_pip_close(window: tauri::WebviewWindow, card: String) -> Result<(), String> {
    logic::validate_owner(window.label()).map_err(String::from)?;
    let label = logic::card_label(&card).map_err(String::from)?;
    if let Some(player) = window.app_handle().get_webview_window(&label) {
        player.destroy().map_err(|e|e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn youtube_pip_is_open(window: tauri::WebviewWindow, card: String) -> Result<bool, String> {
    logic::validate_owner(window.label()).map_err(String::from)?;
    let label = logic::card_label(&card).map_err(String::from)?;
    Ok(window.app_handle().get_webview_window(&label).is_some())
}

pub fn close_all(app: &tauri::AppHandle) {
    for (label, player) in app.webview_windows() {
        if logic::is_owned_label(&label) {let _ = player.destroy();}
    }
}

/// Only OS/user close requests publish this event. App-requested cleanup uses
/// destroy(), which skips CloseRequested, retaining the saved floating choice.
pub fn user_close_requested(app: &tauri::AppHandle, label: &str) {
    if let Some(card) = logic::user_close_card(label) {
        let _ = app.emit_to("main", "youtube-pip-user-closed", card);
    }
}
