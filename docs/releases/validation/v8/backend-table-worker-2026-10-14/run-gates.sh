#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# v8 after the release/v7 merge (5faf68c) 2026-10-14, on macOS: every declared gate at HEAD,
# one log per gate plus gates.tsv (name|exit|duration|load|command). Run from the repository root.
# Usage: run-gates.sh [OUTDIR]   (default: this script's directory)
# PIVOT_WASM_BINDGEN may name an existing wasm-bindgen 0.2.128 for the Rust pivot build.
# Not run: dashsync (needs the local key-mode server container, stopped by the user).
set -u
O=${1:-$(cd "$(dirname "$0")" && pwd)}
ROOT=$(pwd)
mkdir -p "$O"
git rev-parse HEAD > "$O/head.txt"
: > "$O/gates.tsv"
scrub(){ sed -e "s#$ROOT#<worktree>#g" -e "s#/tmp/[^ ]*#<scratch>#g" -e "s#$HOME#~#g"; }
run(){ n=$1; shift; s=$(date +%s); l=$(uptime | sed 's/.*average[s]*: //'); "$@" 2>&1 | scrub > "$O/$n.log"; e=${PIPESTATUS[0]}; echo "$n|exit=$e|dur=$(( $(date +%s)-s ))s|load=$l|cmd=$*" | scrub >> "$O/gates.tsv"; }
run pivot-build pnpm pivot:build
run typecheck pnpm typecheck
run lint pnpm lint
run unit pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=120000
run revision-test pnpm exec vitest run src/stores/dashboardRevision.test.ts
run build pnpm build
run smoke pnpm smoke
run e2e env BDOBB_BROWSER_PORT="${BDOBB_BROWSER_PORT:-4651}" BDOBB_MOCK_PORT="${BDOBB_MOCK_PORT:-4652}" pnpm exec playwright test --reporter=list
run web pnpm test:web
run build-web pnpm build:web
run web-browser pnpm test:web:browser
run pivot-test pnpm pivot:test
run pivot-packaging pnpm test:pivot:packaging
run cargo cargo check --manifest-path src-tauri/Cargo.toml --locked -j 2
run scrub pnpm scrub
run help pnpm exec vitest run src/help scripts/help-shots.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=120000
run cargo-test cargo test --manifest-path src-tauri/Cargo.toml --lib --locked -j 2
run notices-check pnpm notices:check
run diff-check git diff --check d2c3dce HEAD -- . ':!docs/releases/validation/**/*.log'
echo DONE >> "$O/gates.tsv"
