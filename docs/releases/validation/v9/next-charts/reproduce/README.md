# Reproduce the installed source and geometry checks

Run from the BDOBB checkout. The installed route extraction uses the paired Docker checkout, its built v3 image and fictional upstream data. It calls each mirror with and without opt-in, and reuses an original cache stamp. The JSON stays local. The opt-in browser case normalizes the actual generated widget, makes the corresponding request through BDOBB and checks its source callback, row selection and source family.

```bash
set -euo pipefail
repro=docs/releases/validation/v9/next-charts/reproduce
docker_repo=/path/to/paired/openbq-docker
image=openbq-next-eight-candidate
docker run --rm --network none -i -v "$docker_repo/v9/eodhd:/check:ro" "$image" \
  python - /check/source.json < "$repro/compare-installed.py"
bash "$repro/run-paired-sources.sh" "$docker_repo" "$image"
```

The runner creates a private directory under `e2e` for the capture, spec and Playwright output. Each invocation removes its own directory on exit. To run two independent browser servers, assign each a distinct `BDOBB_BROWSER_PORT` and `BDOBB_MOCK_PORT` pair. Run `python3 "$repro/test-paired-scratch.py"` to exercise file and symlink preservation, concurrent invocations and cleanup after a failing command.

The installed-geometry probes require the pinned dependencies and Playwright browsers. Start one local Vite server from the BDOBB root. The scripts resolve their fixture files relative to the checkout. Set `PROBE_URL` to use another server or `CAPTURE_DIR` to choose an existing output directory.

```bash
PIVOT_WASM_VERIFY_ONLY=1 pnpm exec vite --host 127.0.0.1 --port 4718 --strictPort
```

From a second shell in the same checkout run the individual cases.

```bash
repro=docs/releases/validation/v9/next-charts/reproduce
node "$repro/etf-2-native-fill-comparison.mjs"
node "$repro/etf-2-rounded-midpoint-probe.mjs"
node "$repro/etf-2-native-worker-probe.mjs"
node "$repro/overlay-2-renderer.mjs"
node "$repro/revision-2-renderer.mjs"
node "$repro/market-map-2-renderer.mjs"
```

The ETF fill comparison records native canvas versus SVG hit answers in Chromium and WebKit. The midpoint sweep replays the older analytical proposal. The worker probe checks native availability and measures a 3,452-holding input. The overlay, revision and market renderer probes exercise installed geometry, original-value hovers, extreme values and minimum surfaces. The historical `overlay-2-native-probe.mjs` evaluates the original Plotly-native tick strategy. Its assertions demonstrate the earlier behavior and are separate from the passing release gates. The tracked `e2e/*-geometry.spec.ts` files retain the news, return, ownership, KPI and ETF acceptance oracles.
