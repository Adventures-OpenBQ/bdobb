#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
# BDOBB as host, against openbq-org/agents-for-openbb examples 30-42 (MIT) on loopback, each
# behind scripts/stub-openai.mjs. The examples are cloned per run into .superpowers/ (gitignored);
# nothing of theirs is committed. A skip counts as not run, so it fails (rita-live-check.sh rule).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHA=aa1073d2b098ae6cf597dabf0635822aa808dd81
WORK="$ROOT/.superpowers/agent-conformance"
CLONE="$WORK/agents"
UV="${UV:-$(command -v uv || echo "$HOME/.local/bin/uv")}"
STUB_PORT=17799
pids=(); out=""
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; [ -z "$out" ] || rm -f "$out"; }
trap cleanup EXIT
mkdir -p "$WORK"
if [ "$(git -C "$CLONE" rev-parse HEAD 2>/dev/null)" != "$SHA" ]; then
  rm -rf "$CLONE" && git init -q "$CLONE"
  git -C "$CLONE" fetch -q --depth 1 https://github.com/openbq-org/agents-for-openbb.git "$SHA"
  git -C "$CLONE" checkout -q FETCH_HEAD
fi
git -C "$CLONE" checkout -q -- .   # example 42 appends to its feedback.json: start from the pinned file
[ -x "$WORK/venv/bin/python" ] || "$UV" venv -q --python 3.12 "$WORK/venv"
VIRTUAL_ENV="$WORK/venv" "$UV" pip install -q openbb-ai==2.2.0 fastapi==0.118.3 uvicorn==0.27.1 \
  sse-starlette==2.4.1 pdfplumber==0.11.10 httpx==0.28.1 openai==2.54.0
node "$ROOT/scripts/stub-openai.mjs" "$STUB_PORT" & pids+=($!)
agents=()
for n in $(seq 30 42); do
  dir=$(echo "$CLONE"/"$n"-*/); main=$(echo "$dir"*/main.py); mod=$(basename "$(dirname "$main")")
  port=$((17730 + n))
  # -I ignores the cwd and PYTHONPATH, so uvicorn's --app-dir is what puts the example on sys.path.
  OPENAI_BASE_URL="http://127.0.0.1:$STUB_PORT/v1" OPENAI_API_KEY=stub \
    "$WORK/venv/bin/python" -I -m uvicorn --app-dir "$dir" "$mod.main:app" --host 127.0.0.1 --port "$port" --log-level warning & pids+=($!)
  agents+=("$n=http://127.0.0.1:$port")
done
for a in "${agents[@]}"; do
  for _ in $(seq 50); do curl -fs -o /dev/null "${a#*=}/agents.json" && continue 2; sleep 0.2; done
  echo "agent-conformance: example ${a%%=*} did not start" >&2; exit 3
done
export OPENBB_EXAMPLE_AGENTS="$(IFS=,; echo "${agents[*]}")"
export OPENBB_EXAMPLE_FEEDBACK_FILE="$(echo "$CLONE"/42-*/)feedback.json"
out="$(mktemp)"
pnpm exec vitest run src/test/integration/agent-conformance-live.test.ts --testTimeout=60000 \
  --reporter=default --reporter=json --outputFile="$out" || true
node -e 'const r=JSON.parse(process.argv[1]);const bad=r.numFailedTests+r.numPendingTests+(r.numTodoTests||0)+(r.numFailedTestSuites||0);if(r.numTotalTests===0||bad>0){console.error(`conformance: ${r.numPassedTests}/${r.numTotalTests} passed, ${r.numPendingTests} skipped, ${r.numFailedTests} failed`);process.exit(1)}console.error(`conformance: ${r.numPassedTests}/${r.numTotalTests} passed, 0 skipped, 0 failed`)' "$(cat "$out")"
