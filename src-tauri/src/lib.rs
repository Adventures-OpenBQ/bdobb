// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

mod migrate;
mod save_panel;
mod video_wrapper;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Restore baseline storage fix 4ac9cd071 (issue #316): the first
            // settings seed needs the root before nested stores initialize.
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
            // tauri.conf.json marks the main window "create": false, so it is
            // built only now, after the migration above.
            if let Some(config) = app.config().app.windows.first() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?.build()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![video_wrapper::video_wrapper_port, save_panel::save_workspace_panel])
        .run(tauri::generate_context!())
        .expect("error while running BDOBB");
}
