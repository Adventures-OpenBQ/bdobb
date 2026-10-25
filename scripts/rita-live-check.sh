#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
# Live Rita/MCP gate: a skip counts as not run, so it fails.
set -euo pipefail
export OPENBB_RITA_URL="${OPENBB_RITA_URL:-http://127.0.0.1:18012}"
export OPENBB_MCP_URLS="${OPENBB_MCP_URLS:-http://127.0.0.1:16911/mcp}"
export OPENBB_LIVE=1
check_report() { node -e 'const r=JSON.parse(process.argv[1]);const bad=r.numFailedTests+r.numPendingTests+(r.numTodoTests||0)+(r.numFailedTestSuites||0);if(r.numTotalTests===0||bad>0){console.error(`live gate: ${r.numPassedTests}/${r.numTotalTests} passed, ${r.numPendingTests} skipped, ${r.numFailedTests} failed, ${r.numFailedTestSuites||0} files failed to load`);process.exit(1)}console.error(`live gate: ${r.numPassedTests}/${r.numTotalTests} passed, 0 skipped, 0 failed`)' "$1"; }
if [ -n "${RITA_LIVE_REPORT_FIXTURE:-}" ]; then check_report "$RITA_LIVE_REPORT_FIXTURE"; exit 0; fi
[ -n "${OPENBB_BACKEND_URL:-}" ] || { echo "live gate: OPENBB_BACKEND_URL is required" >&2; exit 2; }
export OPENBB_NAS_URL="${OPENBB_NAS_URL:-$OPENBB_BACKEND_URL}"
# Basic auth built the way real-endpoints.test.ts builds it (OPENBB_NAS_AUTH is user:pass). The header goes to curl through a 0600 file, never argv.
hdr="$(mktemp)"; out=""; trap 'rm -f "$hdr" "$out"' EXIT
[ -z "${OPENBB_NAS_AUTH:-}" ] || printf 'Authorization: Basic %s\n' "$(printf %s "$OPENBB_NAS_AUTH" | base64 | tr -d '\n')" > "$hdr"
probe() { curl -sS -o /dev/null --max-time 10 ${2:+-H "@$2"} "$1" || { echo "live gate: unreachable $1" >&2; exit 3; }; }
# OPENBB_MCP_URLS entries are `id=url` (real-endpoints.test.ts); a bare url also works. Strip a leading `id=` only when the id is [A-Za-z0-9_-]+ and the rest is http(s)://.
strip_id() { if [[ "$1" == *=* && "${1%%=*}" =~ ^[A-Za-z0-9_-]+$ && "${1#*=}" =~ ^https?:// ]]; then printf %s "${1#*=}"; else printf %s "$1"; fi; }
probe "${OPENBB_RITA_URL%/}/agents.json"
IFS=, read -ra mcps <<< "$OPENBB_MCP_URLS"; for u in "${mcps[@]}"; do probe "$(strip_id "$u")"; done
probe "${OPENBB_BACKEND_URL%/}/widgets.json" "${OPENBB_NAS_AUTH:+$hdr}"
[ "${1:-}" = "--self-check" ] && exit 0
out="$(mktemp)"
files=("$@"); [ ${#files[@]} -gt 0 ] || files=(src/test/integration/rita-live.test.ts src/test/integration/rita-authoring-live.test.ts src/test/integration/real-endpoints.test.ts src/test/integration/rita-table-model-live.test.ts)
pnpm exec vitest run "${files[@]}" --maxWorkers=1 --minWorkers=1 --testTimeout=300000 --reporter=default --reporter=json --outputFile="$out" || true
check_report "$(cat "$out")"
