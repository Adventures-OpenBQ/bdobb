#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
docker_repo=${1:?pass the paired Docker checkout}
image=${2:?pass the candidate image}
repro=$(cd "$(dirname "$0")" && pwd)
if [[ ! -d e2e || -L e2e ]]; then
  echo 'Run from the BDOBB checkout with its e2e directory.' >&2
  exit 1
fi
umask 077
scratch=$(mktemp -d e2e/paired-sources.XXXXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
docker run --rm --network none -i -v "$docker_repo/v9/eodhd:/check:ro" "$image" \
  python - < "$repro/extract-packaged-sources.py" > "$scratch/paired-sources.json"
cp "$repro/paired-sources.spec.ts.example" "$scratch/paired-sources.spec.ts"
PIVOT_WASM_VERIFY_ONLY=1 BDOBB_BROWSER_PORT=${BDOBB_BROWSER_PORT:-4343} BDOBB_MOCK_PORT=${BDOBB_MOCK_PORT:-4344} \
  pnpm exec playwright test "$scratch/paired-sources.spec.ts" --project=chromium --workers=1 --retries=0 \
  --reporter=list --output="$scratch/results"
