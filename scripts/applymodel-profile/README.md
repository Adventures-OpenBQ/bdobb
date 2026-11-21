# applyModel profiling

Benchmark-only instrumentation for the 10,000-row legacy pivot workload. Product
sources, generated WASM and the production execution protocol remain unchanged.
The build copies three Rust crates to a disposable directory and adds nested
clock spans. Do not publish this instrumented artifact as the application artifact.

```sh
cargo +1.98.1 install wasm-bindgen-cli --version 0.2.128 --locked --root /tmp/openbq-profile-tools
node --test scripts/applymodel-profile/instrument.test.mjs
node scripts/build-pivot-wasm.mjs --verify
node scripts/applymodel-profile/build.mjs /tmp/openbq-applymodel-instrumented
node scripts/applymodel-profile/run.mjs /tmp/openbq-applymodel-instrumented /tmp/applymodel-spans.json
node scripts/applymodel-profile/report.mjs /tmp/applymodel-spans.json /tmp/applymodel-report.md
```

Use a fresh build directory. `PIVOT_WASM_BINDGEN` can select another pinned 0.2.128
binary. The repository's pnpm dependencies and Playwright Chromium must be installed.
Build before measurement; do not run other CPU-intensive work concurrently.

The browser uses the real worker handler, runtime and client, bundled with esbuild.
Stock artifact is the latency control; the temporary artifact adds instrumentation.
TypeScript is a third timing control and exact correctness oracle for this dataset.
Every action checks full export/columns/metadata/rows/totals before timing. Source
input is fixed; baseline reapply, search-only, sort-only and combined edits restore
the same initial grouped model. Each mode has 3 warmups and 20 observations.

Spans report inclusive and exclusive time. Inclusive spans overlap and recursive
preparation totals can exceed wall time. Do not add these totals. JS callback time
is nested within Rust host.order. Worker boundary overhead is parent round trip
minus same-realm worker duration; it includes clone, trace payload and scheduling.
One-way timings are not qualified because realm clock origins can differ slightly.

This covers legacy pivots only, not the separate analytical/formula path, native
service, UI paint or network transport. No automatic optimization is performed.

For a same-run before/after comparison, save the original stock `pivot_wasm.js` and
`pivot_wasm_bg.wasm` in a separate directory **before** rebuilding the stock artifact.
Pass that directory as the third argument to `run.mjs` (after build dir and output).
The extra `before` mode participates in parity checks and alternating observations.
Use `compare.mjs measurements.json report.md` to summarize this four-mode run.

Export attribution (temporary Rust probes; production artifacts are unchanged):

```sh
node scripts/applymodel-profile/build.mjs /tmp/openbq-export-profile
CODEC_PROFILE_WASM=/tmp/openbq-export-profile/generated node scripts/applymodel-profile/codec.mjs /tmp/openbq-export-phases.json
```

`rustSpans` are recorded separately for each dispatch. `export.next` includes
`rows.project` and `budget.wire_size`; `wire.serialize` is a sibling under
`wasm.dispatch`. Compare inclusive/exclusive costs without adding nested times.
These emitted-WASM Node diagnostics include probe overhead and are not browser
speedup measurements. The default codec command still uses the stock WASM.

Generate a per-complete-export attribution table:

```sh
node scripts/applymodel-profile/export-report.mjs /tmp/openbq-export-phases.json
```

For a stock emitted-WASM comparison, `CODEC_WASM=/path/to/generated` selects a
module without enabling Rust probes. `PROFILE_ACTIONS=rawExport` uses the fixed
10k-row dataset with a raw model and times its complete pulled export through
the browser worker; preflight compares rows and every batch's metadata as well
as the view/block/totals snapshot. Pass the saved pre-change stock module as the
fourth argument to run.mjs for alternating before/after observations.

Unbounded-export accounting regression (run against traced codec diagnostics):

```sh
node scripts/applymodel-profile/check-export-accounting.mjs /tmp/openbq-export-phases.json
```

This requires actual export execution and rejects resource wire counting or
retained-state scans inside default/unbounded export dispatches. Configured
ceiling correctness is covered separately by the core resource tests.

Direct plain-continuation serializer regression:

```sh
node scripts/applymodel-profile/check-direct-subset.mjs /tmp/openbq-export-phases.json
```

For the raw fixture's nextSubset commands, this requires the direct serializer
span and rejects legacy payload/envelope tree spans. First batches and annotated
rows intentionally continue through the general response encoder.

For JS wire-decoder comparisons, CODEC_CONTROL_WIRE=/path/to/old-wireCodec.ts
substitutes a frozen codec only in the Node preflight control bundle.
PROFILE_BEFORE_WIRE=/path/to/old-wireCodec.ts substitutes it only in the browser
before-worker bundle. The browser comparison still requires a before artifact
directory; use the same stock WASM for both when isolating JS changes. Reports
record frozen/current codec hashes independently of protocol.ts hashes.

Formula attribution uses formula.* spans around compilation/source evaluation,
eligibility, scope construction, scoped-total cache requests, actual aggregate
evaluation, projection and hierarchy. Cache-request counts differ from aggregate
evaluation counts; nested inclusive times must not be added. No per-AST-node
probes are installed.

PROFILE_WORKLOAD=formula loads the exact matched-executor workload through tagged
wire into the profile page and forwards its runtime parameters. Use
PROFILE_ACTIONS=baseline to time a fresh-revision reapply after initial apply,
outside acquisition/initial calculation. This is a warmed reapply comparison.
