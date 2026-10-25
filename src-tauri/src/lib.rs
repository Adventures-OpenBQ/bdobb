// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

mod migrate;
mod save_panel;
mod video_wrapper;

use tauri::Manager;

// The one name the Rust menu item and the frontend listener agree on. Kept in
// sync by hand with MENU_NEW_WORKSPACE in src/components/LeftRail.tsx -- there
// is no shared type between the two sides for a bare event name.
#[cfg(desktop)]
const NEW_WORKSPACE_MENU_ID: &str = "file-new-workspace";
#[cfg(desktop)]
const NEW_WORKSPACE_MENU_EVENT: &str = "menu://new-workspace";

// Window ▸ Keep Sidebar Open. Kept in sync by hand with SIDEBAR_PIN in
// src/hooks/useWindowMenuPins.ts.
#[cfg(desktop)]
const KEEP_SIDEBAR_OPEN_ID: &str = "window-keep-sidebar-open";
#[cfg(desktop)]
const KEEP_SIDEBAR_OPEN_EVENT: &str = "menu://toggle-sidebar-pin";

/// The Window menu's check items, so `set_window_pin` can reach them:
/// `Menu::get` searches the top level only, never a submenu.
#[cfg(desktop)]
struct WindowPins(Vec<tauri::menu::CheckMenuItem<tauri::Wry>>);

/// Edits the stock menu bar: "New Workspace…" at the top of File, and the
/// pin toggles at the bottom of Window, below its own Minimize/Zoom items.
///
/// `#[cfg(desktop)]` because `tauri::menu` exists only on desktop targets.
/// This line builds none other, so the attribute changes nothing here; it is
/// kept so this code is main's and v7.0.0's, where the iPad build needs it.
#[cfg(desktop)]
fn install_menu_items(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
    use tauri::Manager;

    let menu = Menu::default(app)?;
    let new_workspace =
        MenuItem::with_id(app, NEW_WORKSPACE_MENU_ID, "New Workspace…", true, None::<&str>)?;
    // Disabled and unchecked until the UI reports the active workspace's
    // pin (useWindowMenuPins): no workspace is open at launch.
    let keep_sidebar_open = CheckMenuItem::with_id(
        app, KEEP_SIDEBAR_OPEN_ID, "Keep Sidebar Open", false, false, None::<&str>,
    )?;

    // Start from the default menu and edit it, rather than rebuilding the bar:
    // App/Edit/View/Window/Help all carry platform behaviour we would have to
    // reproduce by hand, and silently lose if we got it wrong.
    for kind in menu.items()? {
        if let Some(submenu) = kind.as_submenu() {
            match submenu.text()?.as_str() {
                "File" => submenu.insert(&new_workspace, 0)?,
                "Window" => {
                    submenu.append(&PredefinedMenuItem::separator(app)?)?;
                    submenu.append(&keep_sidebar_open)?;
                }
                _ => {}
            }
        }
    }

    app.manage(WindowPins(vec![keep_sidebar_open]));
    app.set_menu(menu)?;
    Ok(())
}

/// Sets a Window-menu pin's checkmark and whether it can be chosen. The UI
/// owns the pin and calls this whenever it changes, from any source.
#[tauri::command]
fn set_window_pin(app: tauri::AppHandle, id: String, checked: bool, enabled: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(pins) = app.try_state::<WindowPins>() {
            if let Some(item) = pins.0.iter().find(|item| item.id().0 == id) {
                item.set_checked(checked).map_err(|e| e.to_string())?;
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
        }
    }
    #[cfg(not(desktop))]
    let _ = (app, id, checked, enabled);
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![video_wrapper::video_wrapper_port, set_window_pin, save_panel::save_workspace_panel])
        .setup(|app| {
            // Restore the baseline storage fix from 4ac9cd071 (issue #316).
            // Root-level settings seed before nested stores create directories.
            match app.path().app_data_dir() {
                Ok(dir) => {
                    // Before the window exists, so the app never reads a
                    // folder mid-migration. A failure leaves the folder as it
                    // was and the app still starts.
                    if let (Some(parent), Some(name)) = (dir.parent(), dir.file_name().and_then(|n| n.to_str())) {
                        match migrate::migrate_data(parent, name) {
                            Ok(Some(backup)) => eprintln!("migrated {}; the previous folder is now {}", migrate::SOURCE, backup.display()),
                            Ok(None) => {}
                            Err(error) => eprintln!("data migration from {} failed: {error}", migrate::SOURCE),
                        }
                    }
                    if let Err(error) = std::fs::create_dir_all(&dir) {
                        eprintln!("cannot create {}: {error}", dir.display());
                    }
                }
                Err(error) => eprintln!("no app-data directory: {error}"),
            }
            // A missing menu item must not make the application unusable.
            #[cfg(desktop)]
            if let Err(error) = install_menu_items(app.handle()) {
                eprintln!("menu: cannot edit the menu bar: {error}");
            }
            // tauri.conf.json marks the main window "create": false, so it is
            // built only now, after the migration above.
            if let Some(config) = app.config().app.windows.first() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder
        .on_menu_event(|app, event| {
            use tauri::{Emitter, Manager};
            if event.id() == NEW_WORKSPACE_MENU_ID {
                // The menu bar is the app's, so a viewer window may be the
                // focused one; only the main window has a rail to open the
                // dialog, so it comes forward first, or the dialog would open
                // behind the viewer (review m70).
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.set_focus();
                }
                // Fire-and-forget: the rail opens the dialog, and the dialog
                // reports its own failures.
                let _ = app.emit(NEW_WORKSPACE_MENU_EVENT, ());
            } else if event.id() == KEEP_SIDEBAR_OPEN_ID {
                // The UI flips the active workspace's pin and sends the
                // checkmark back through set_window_pin.
                let _ = app.emit(KEEP_SIDEBAR_OPEN_EVENT, ());
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running BDOBB");
}
