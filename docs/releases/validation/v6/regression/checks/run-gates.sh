#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# Reruns the declared repo gates at the current HEAD; one log per gate plus gates.tsv.
cd "$(dirname "$0")/../../../../../.."
O=docs/releases/validation/v6/regression/checks
git rev-parse HEAD > $O/head.txt
: > $O/gates.tsv
run(){ n=$1; shift; s=$(date +%s); l=$(uptime | sed 's/.*averages: //'); "$@" > $O/$n.log 2>&1; e=$?; echo "$n|exit=$e|dur=$(( $(date +%s)-s ))s|load=$l|cmd=$*" >> $O/gates.tsv; }
run typecheck pnpm typecheck
run lint pnpm lint
run unit pnpm test:run
run build pnpm build
run e2e env BDOBB_BROWSER_PORT=4383 BDOBB_MOCK_PORT=4384 pnpm e2e
run web pnpm test:web
run web-browser pnpm test:web:browser
run cargo bash -c 'cd src-tauri && cargo check --locked --offline'
run scrub pnpm scrub
echo DONE >> $O/gates.tsv
