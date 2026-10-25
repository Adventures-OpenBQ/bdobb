// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

//! One-time data migration for the rename from BDOBB2 to BDOBB.

use std::io;
use std::path::{Path, PathBuf};

pub const SOURCE: &str = "com.artcashin.bdobb.clean.v3.repair";
pub const MARKER: &str = ".migrated-from-clean-v3-repair";

/// Copies the clean-v3-repair build's data folder (`<parent>/SOURCE`) into
/// this app's (`<parent>/<target>`), once. BDOBB took over the original
/// BDOBB's identifier, so a folder already at `<target>` belongs to that app:
/// it is renamed aside to `<target>.v1-backup` (numbered when that exists),
/// never deleted, and its path is returned. The copy is built under a
/// temporary name and renamed into place, so a failure part-way leaves the
/// target untouched. The marker written into the result makes every later
/// launch a no-op; without a source there is nothing to do and no marker.
pub fn migrate_data(parent: &Path, target: &str) -> io::Result<Option<PathBuf>> {
    let dest = parent.join(target);
    let source = parent.join(SOURCE);
    if dest.join(MARKER).exists() || !source.is_dir() {
        return Ok(None);
    }
    let staging = parent.join(format!("{target}.migrating"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging)?;
    }
    copy_dir(&source, &staging)?;
    let backup = if dest.exists() {
        let mut aside = parent.join(format!("{target}.v1-backup"));
        let mut n = 2;
        while aside.exists() {
            aside = parent.join(format!("{target}.v1-backup-{n}"));
            n += 1;
        }
        std::fs::rename(&dest, &aside)?;
        Some(aside)
    } else {
        None
    };
    std::fs::rename(&staging, &dest)?;
    std::fs::write(dest.join(MARKER), format!("copied from {SOURCE}\n"))?;
    Ok(backup)
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let path = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &path)?;
        } else {
            std::fs::copy(entry.path(), path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const TARGET: &str = "com.artcashin.bdobb";

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bdobb-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: PathBuf, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn copies_the_source_and_moves_the_original_aside() {
        let parent = scratch("takeover");
        write(parent.join(SOURCE).join("settings.json"), "repair");
        write(parent.join(SOURCE).join("dashboards/d1.json"), "dash");
        write(parent.join(TARGET).join("settings.json"), "original");
        write(parent.join(TARGET).join("chat.json"), "chat");

        let backup = migrate_data(&parent, TARGET).unwrap().expect("original moved aside");

        assert_eq!(fs::read_to_string(parent.join(TARGET).join("settings.json")).unwrap(), "repair");
        assert_eq!(fs::read_to_string(parent.join(TARGET).join("dashboards/d1.json")).unwrap(), "dash");
        assert!(!parent.join(TARGET).join("chat.json").exists());
        assert_eq!(fs::read_to_string(backup.join("settings.json")).unwrap(), "original");
        assert_eq!(fs::read_to_string(backup.join("chat.json")).unwrap(), "chat");
        // The source is copied, not moved.
        assert_eq!(fs::read_to_string(parent.join(SOURCE).join("settings.json")).unwrap(), "repair");
        assert!(parent.join(TARGET).join(MARKER).exists());
    }

    #[test]
    fn runs_once() {
        let parent = scratch("once");
        write(parent.join(SOURCE).join("settings.json"), "repair");
        migrate_data(&parent, TARGET).unwrap();
        write(parent.join(TARGET).join("settings.json"), "edited after migration");
        assert_eq!(migrate_data(&parent, TARGET).unwrap(), None);
        assert_eq!(fs::read_to_string(parent.join(TARGET).join("settings.json")).unwrap(), "edited after migration");
    }

    #[test]
    fn does_nothing_without_a_source() {
        let parent = scratch("nosource");
        write(parent.join(TARGET).join("settings.json"), "original");
        assert_eq!(migrate_data(&parent, TARGET).unwrap(), None);
        assert_eq!(fs::read_to_string(parent.join(TARGET).join("settings.json")).unwrap(), "original");
        assert!(!parent.join(TARGET).join(MARKER).exists());
    }

    #[test]
    fn never_overwrites_an_earlier_backup() {
        let parent = scratch("backup");
        write(parent.join(SOURCE).join("settings.json"), "repair");
        write(parent.join(TARGET).join("settings.json"), "original");
        write(parent.join(format!("{TARGET}.v1-backup")).join("settings.json"), "older backup");
        let backup = migrate_data(&parent, TARGET).unwrap().unwrap();
        assert_ne!(backup, parent.join(format!("{TARGET}.v1-backup")));
        assert_eq!(fs::read_to_string(backup.join("settings.json")).unwrap(), "original");
        assert_eq!(fs::read_to_string(parent.join(format!("{TARGET}.v1-backup")).join("settings.json")).unwrap(), "older backup");
    }
}
