#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

# Vercel's installCommand (vercel.json). Its build image has no Rust, and the pivot WASM
# (src/lib/tableExecution/rust/generated, gitignored) is built from source by
# `pnpm pivot:build` with the toolchain scripts/pivot-toolchain.json pins: Rust 1.98.1 for
# wasm32-unknown-unknown, and wasm-bindgen 0.2.128 at .pivot-tools/bin/wasm-bindgen.
# wasm-bindgen is the upstream release binary, checked against the SHA-256 pinned below
# (the release's own .sha256sum, verified 2026-10-19), not compiled: cargo install takes
# minutes. The buildCommand sources Cargo's env again, since PATH does not carry over.
set -euo pipefail

RUST=1.98.1
BINDGEN=0.2.128
BINDGEN_SHA256=b51f0208fdff83515a787bd8ab9ac5865ed84dabb66d0c709957bb59793c645f
BINDGEN_NAME="wasm-bindgen-${BINDGEN}-x86_64-unknown-linux-musl"

# Vercel's image keeps Cargo under CARGO_HOME (/rust), not ~/.cargo.
CARGO_ENV="${CARGO_HOME:-$HOME/.cargo}/env"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
fi
# shellcheck source=/dev/null
[ -f "$CARGO_ENV" ] && . "$CARGO_ENV"
rustup toolchain install "$RUST" --profile minimal --target wasm32-unknown-unknown

tmp="$(mktemp -d)"
curl --proto '=https' --tlsv1.2 -sSfL -o "$tmp/bindgen.tgz" \
  "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${BINDGEN}/${BINDGEN_NAME}.tar.gz"
echo "${BINDGEN_SHA256}  $tmp/bindgen.tgz" | sha256sum -c -
tar -xzf "$tmp/bindgen.tgz" -C "$tmp"
mkdir -p .pivot-tools/bin
install -m 0755 "$tmp/${BINDGEN_NAME}/wasm-bindgen" .pivot-tools/bin/wasm-bindgen
rm -rf "$tmp"

pnpm install --frozen-lockfile
