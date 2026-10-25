#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# v3 manual-test fixes 2026-10-12 (Save…, headerName exports, date filter, Apps backend filter, connections shot): runs every declared gate at HEAD, one log per gate plus
# gates.tsv (name|exit|duration|load|command). Run from the repository root.
# Usage: run-gates.sh [OUTDIR]   (default: this script's directory)
set -u
O=${1:-$(cd "$(dirname "$0")" && pwd)}
mkdir -p "$O"
git rev-parse HEAD > "$O/head.txt"
: > "$O/gates.tsv"
run(){ n=$1; shift; s=$(date +%s); l=$(uptime | sed 's/.*averages: //'); "$@" > "$O/$n.log" 2>&1; e=$?; echo "$n|exit=$e|dur=$(( $(date +%s)-s ))s|load=$l|cmd=$*" >> "$O/gates.tsv"; }
run typecheck pnpm typecheck
run lint pnpm lint
run unit pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=60000
run build pnpm build
run smoke pnpm smoke
run e2e env BDOBB_BROWSER_PORT="${BDOBB_BROWSER_PORT:-4483}" BDOBB_MOCK_PORT="${BDOBB_MOCK_PORT:-4484}" pnpm e2e
run web pnpm test:web
run build-web pnpm build:web
run web-browser pnpm test:web:browser
run cargo cargo check --manifest-path src-tauri/Cargo.toml --locked --offline -j 2
run scrub pnpm scrub
run help pnpm exec vitest run src/help scripts/help-shots.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=60000
run cargo-test cargo test --manifest-path src-tauri/Cargo.toml --lib --locked --offline -j 2
run notices-check pnpm notices:check
run diff-check git diff --check bcc11c7 HEAD
echo DONE >> "$O/gates.tsv"
