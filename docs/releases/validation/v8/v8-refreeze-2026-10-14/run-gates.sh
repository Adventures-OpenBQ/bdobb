#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# v8.0.0 re-freeze gate (cloud half) after merging the v7 rebuild ba935b5 (merge base 4a464c9e) 2026-10-14:
# runs every declared gate at HEAD, one log per gate plus gates.tsv (name|exit|duration|load|command).
# Run from the repository root. Usage: run-gates.sh [OUTDIR]   (default: this script's directory)
# The v8 freeze script's gates, plus the v7 rebuild's that run on Linux: smoke, the build's 6 GB heap
# (CI), and the Pivot gates (pivot-test, pivot-verify, pivot-packaging, pivot-browser on Chromium).
# PW_CONFIG names the Playwright config (default playwright.config.ts), PW_PIVOT_CONFIG the Pivot one
# (default playwright.pivot.config.ts), and PW_NODE_OPTIONS any NODE_OPTIONS for the Chromium gates. A
# machine whose Chromium build differs from the pinned one points them at local files that only set
# executablePath (and leave out WebKit specs and projects there).
# Not run here: dashsync (needs the local key-mode server container), cargo and cargo-test
# (the Tauri crate needs GTK/WebKitGTK system libraries on Linux; the Mac builds it natively).
set -u
O=${1:-$(cd "$(dirname "$0")" && pwd)}
PW=${PW_CONFIG:-playwright.config.ts}
PWP=${PW_PIVOT_CONFIG:-playwright.pivot.config.ts}
ROOT=$(pwd)
mkdir -p "$O"
git rev-parse HEAD > "$O/head.txt"
: > "$O/gates.tsv"
scrub(){ sed -e "s#$ROOT#<worktree>#g" -e "s#/tmp/[^ ]*#<scratch>#g" -e "s#$HOME#~#g"; }
run(){ n=$1; shift; s=$(date +%s); l=$(uptime | sed 's/.*average[s]*: //'); "$@" 2>&1 | scrub > "$O/$n.log"; e=${PIPESTATUS[0]}; echo "$n|exit=$e|dur=$(( $(date +%s)-s ))s|load=$l|cmd=$*" | scrub >> "$O/gates.tsv"; }
run typecheck pnpm typecheck
run lint pnpm lint
run unit pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=120000
run revision-test pnpm exec vitest run src/stores/dashboardRevision.test.ts
run build env NODE_OPTIONS=--max-old-space-size=6144 pnpm build
run smoke env NODE_OPTIONS="${PW_NODE_OPTIONS:-}" pnpm smoke
run e2e env NODE_OPTIONS="${PW_NODE_OPTIONS:-}" BDOBB_BROWSER_PORT="${BDOBB_BROWSER_PORT:-4651}" BDOBB_MOCK_PORT="${BDOBB_MOCK_PORT:-4652}" pnpm exec playwright test -c "$PW" --reporter=list
run web pnpm test:web
run build-web pnpm build:web
run web-browser env NODE_OPTIONS="${PW_NODE_OPTIONS:-}" pnpm test:web:browser
run scrub pnpm scrub
run help pnpm exec vitest run src/help scripts/help-shots.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=120000
run notices-check pnpm notices:check
run pivot-test pnpm pivot:test
run pivot-verify pnpm pivot:verify
run pivot-packaging pnpm test:pivot:packaging
run pivot-browser env NODE_OPTIONS="${PW_NODE_OPTIONS:-}" pnpm exec playwright test -c "$PWP"
run diff-check git diff --check 4a464c9e HEAD -- . ':!docs/releases/validation/**/*.log'
echo DONE >> "$O/gates.tsv"
