// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
use std::{env, path::PathBuf, process::Command};
fn pkg(args: &[&str]) -> std::process::Output {
    let mut command = Command::new("pkg-config");
    command.args(args).args(["icu-i18n", "icu-uc"]);
    if env::var_os("PKG_CONFIG_PATH").is_none() && cfg!(target_os = "macos") {
        command.env(
            "PKG_CONFIG_PATH",
            "/opt/homebrew/opt/icu4c/lib/pkgconfig:/usr/local/opt/icu4c/lib/pkgconfig",
        );
    }
    command
        .output()
        .expect("pivot-native requires pkg-config and ICU4C 78.3 development files; see README.md")
}
fn main() {
    for name in [
        "PKG_CONFIG_PATH",
        "PKG_CONFIG_LIBDIR",
        "CC",
        "AR",
        "MACOSX_DEPLOYMENT_TARGET",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-changed=src/icu_shim.c");
    let version = pkg(&["--modversion"]);
    assert!(version.status.success() && String::from_utf8_lossy(&version.stdout).lines().collect::<Vec<_>>() == ["78.3", "78.3"], "pivot-native requires ICU4C exactly 78.3 (matching the Node oracle). Install its development libraries and set PKG_CONFIG_PATH; found: {} {}", String::from_utf8_lossy(&version.stdout),String::from_utf8_lossy(&version.stderr));
    let cflags = pkg(&["--cflags"]);
    let libs = pkg(&["--libs"]);
    assert!(
        cflags.status.success() && libs.status.success(),
        "ICU4C pkg-config failed"
    );
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let object = out.join("icu_shim.o");
    let status = Command::new(env::var_os("CC").unwrap_or_else(|| "cc".into()))
        .args(["-std=c11", "-O2", "-fPIC", "-c", "src/icu_shim.c", "-o"])
        .arg(&object)
        .args(String::from_utf8_lossy(&cflags.stdout).split_whitespace())
        .status()
        .expect("C compiler required for ICU shim");
    assert!(status.success(), "ICU shim compilation failed");
    assert!(
        Command::new(env::var_os("AR").unwrap_or_else(|| "ar".into()))
            .arg("crs")
            .arg(out.join("libpivot_icu.a"))
            .arg(object)
            .status()
            .expect("ar required")
            .success()
    );
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=pivot_icu");
    for flag in String::from_utf8_lossy(&libs.stdout).split_whitespace() {
        if let Some(path) = flag.strip_prefix("-L") {
            println!("cargo:rustc-link-search=native={path}");
        } else if let Some(lib) = flag.strip_prefix("-l") {
            println!("cargo:rustc-link-lib={lib}");
        } else {
            println!("cargo:rustc-link-arg={flag}");
        }
    }
}
