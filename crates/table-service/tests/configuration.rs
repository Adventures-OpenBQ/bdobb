// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
#[test]
fn operator_config_is_private_bounded_and_unknown_fields_refuse() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, b"{}").unwrap();
    assert!(table_service::server_config::ServerConfig::load(&path).is_err());
    std::fs::write(&path, vec![b' '; 1024 * 1024 + 1]).unwrap();
    assert!(table_service::server_config::ServerConfig::load(&path).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&path, dir.path().join("link")).unwrap();
        assert!(
            table_service::server_config::ServerConfig::load(&dir.path().join("link")).is_err()
        );
    }
}
