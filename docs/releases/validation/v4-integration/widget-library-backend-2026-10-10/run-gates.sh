#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# v4 #5 Widget Library backend filter 2026-10-10: runs every declared gate at HEAD, one log per gate plus
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
run web pnpm test:web
run build-web pnpm build:web
run web-browser pnpm test:web:browser
run scrub pnpm scrub
run help pnpm exec vitest run src/help scripts/help-shots.test.mjs --maxWorkers=2 --minWorkers=1 --testTimeout=60000
run diff-check git diff --check 5eda891 HEAD
echo DONE >> "$O/gates.tsv"
