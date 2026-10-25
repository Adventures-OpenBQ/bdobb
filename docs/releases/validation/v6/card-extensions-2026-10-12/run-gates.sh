#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# v6 card extensions merge (on e0c0a0c) 2026-10-12: runs the gates at HEAD, one log per gate plus
# gates.tsv (name|exit|duration|load|command). Run from the repository root.
# Usage: run-gates.sh [OUTDIR]   (default: this script's directory)
# PW_CONFIG names the Playwright config (default playwright.config.ts); a machine whose Chromium
# build differs from the pinned one points it at a local config that only sets executablePath.
# The Workspace dashboard-sync spec is opt-in (DASHSYNC_TEST=1 and a local key-mode server);
# without them it skips, and the log says so.
set -u
O=${1:-$(cd "$(dirname "$0")" && pwd)}
PW=${PW_CONFIG:-playwright.config.ts}
ROOT=$(pwd)
mkdir -p "$O"
git rev-parse HEAD > "$O/head.txt"
: > "$O/gates.tsv"
scrub(){ sed -e "s#$ROOT#<worktree>#g" -e "s#${TMPDIR:-/tmp}/[^ ]*#<scratch>#g" -e "s#$HOME#~#g"; }
run(){ n=$1; shift; s=$(date +%s); l=$(uptime | sed 's/.*average[s]*: //'); "$@" 2>&1 | scrub > "$O/$n.log"; e=${PIPESTATUS[0]}; echo "$n|exit=$e|dur=$(( $(date +%s)-s ))s|load=$l|cmd=$*" | scrub >> "$O/gates.tsv"; }
run typecheck pnpm typecheck
run lint pnpm lint
run unit pnpm exec vitest run --maxWorkers=2 --minWorkers=1 --testTimeout=120000
run build pnpm build
run scrub pnpm scrub
run e2e-sync env BDOBB_BROWSER_PORT="${BDOBB_BROWSER_PORT:-4611}" BDOBB_MOCK_PORT="${BDOBB_MOCK_PORT:-4612}" pnpm exec playwright test -c "$PW" --reporter=list e2e/dashboard-sync.spec.ts e2e/dashboards.spec.ts e2e/workspaces.spec.ts
run diff-check git diff --check e0c0a0c HEAD -- . ':!docs/releases/validation/**/*.log'
echo DONE >> "$O/gates.tsv"
