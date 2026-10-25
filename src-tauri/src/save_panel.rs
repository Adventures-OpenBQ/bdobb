// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! The rail's single Save…: the macOS Save panel with a Format pop-up in its
//! accessory view. The dialog plugin's save() cannot report which filter the
//! user picked, so this command returns the path AND the format.
//!
//! The panel runs app-modal on the main thread, as rfd's blocking dialogs do.
//! A chosen path is admitted to the fs scope exactly as the dialog plugin's
//! save() admits it, so the page's writeTextFile can reach it.

use serde::Serialize;

/// (id, label) in pop-up order; row 0 is the default. src/lib/saveWorkspace.ts
/// lists the same ids and labels in the same order.
pub const FORMATS: [(&str, &str); 2] = [("strict", "Strict OpenBB Workspace"), ("bdobb", "BDOBB Workspace")];

/// The pop-up row the user left selected, as a format id. Anything else --
/// no selection is -1 -- is the default.
pub fn format_at(index: isize) -> &'static str {
    usize::try_from(index).ok().and_then(|i| FORMATS.get(i)).unwrap_or(&FORMATS[0]).0
}

#[derive(Serialize)]
pub struct SavedWorkspace {
    path: String,
    format: &'static str,
}

#[tauri::command]
pub async fn save_workspace_panel<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    default_name: String,
) -> Result<Option<SavedWorkspace>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(run_panel(&default_name));
    })
    .map_err(|e| e.to_string())?;
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let Some((path, format)) = picked else { return Ok(None) };
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;
    if let Some(scope) = app.try_fs_scope() {
        scope.allow_file(&path).map_err(|e| e.to_string())?;
    }
    app.state::<tauri::scope::Scopes>().allow_file(&path).map_err(|e| e.to_string())?;
    Ok(Some(SavedWorkspace { path, format }))
}

#[cfg(target_os = "macos")]
fn run_panel(default_name: &str) -> Option<(String, &'static str)> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSModalResponseOK, NSPopUpButton, NSSavePanel, NSTextField, NSView};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};

    let mtm = MainThreadMarker::new()?;
    let panel = NSSavePanel::savePanel(mtm);
    panel.setNameFieldStringValue(&NSString::from_str(default_name));

    let rect = |x, y, w, h| NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
    let accessory = NSView::initWithFrame(mtm.alloc(), rect(0.0, 0.0, 340.0, 44.0));
    let label = NSTextField::labelWithString(&NSString::from_str("Format:"), mtm);
    label.setFrame(rect(16.0, 13.0, 60.0, 17.0));
    let popup = NSPopUpButton::initWithFrame_pullsDown(mtm.alloc(), rect(80.0, 8.0, 240.0, 26.0), false);
    for (_, title) in FORMATS {
        popup.addItemWithTitle(&NSString::from_str(title));
    }
    popup.selectItemAtIndex(0);
    accessory.addSubview(&label);
    accessory.addSubview(&popup);
    panel.setAccessoryView(Some(&accessory));

    if panel.runModal() != NSModalResponseOK {
        return None;
    }
    let path = panel.URL()?.path()?.to_string();
    Some((path, format_at(popup.indexOfSelectedItem())))
}

/// The desktop app ships for macOS only; elsewhere there is no panel, which
/// the page reads as a cancel.
#[cfg(not(target_os = "macos"))]
fn run_panel(_default_name: &str) -> Option<(String, &'static str)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pop_up_lists_strict_first_and_maps_each_row_to_its_format() {
        assert_eq!(FORMATS[0], ("strict", "Strict OpenBB Workspace"));
        assert_eq!(FORMATS[1], ("bdobb", "BDOBB Workspace"));
        assert_eq!(format_at(0), "strict");
        assert_eq!(format_at(1), "bdobb");
        // No selection (-1) or anything out of range falls back to the default.
        assert_eq!(format_at(-1), "strict");
        assert_eq!(format_at(7), "strict");
    }
}
