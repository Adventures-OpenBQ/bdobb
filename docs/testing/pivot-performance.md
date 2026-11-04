# Advisory pivot measurements

Run sequentially from the repository, with existing dependencies and generated WASM. Do not build or benchmark concurrently. Leave `NODE_OPTIONS` unset and do not raise the default Node heap.

```sh
node --test scripts/pivot-qualification/report.node.mjs
node scripts/pivot-qualification/benchmark.mjs --manifest "$EXTERNAL/statement.json" --engine typescript --workload statement --output "$RESULTS/ts"
node scripts/pivot-qualification/benchmark.mjs --manifest "$EXTERNAL/statement.json" --engine rust --workload statement --output "$RESULTS/rust"
```

The runner builds its Node adapter externally using existing esbuild, then launches five alternating baseline/candidate fresh processes. Each process records cold and warm same-session work separately. Both labels currently use identical source/artifacts: these are calibration observations, never evidence of optimization or speedup. Each session executes apply, complete presented transfer, chart-data delivery, then five explicit-empty/clear cycles, validating empty and restored row counts. Retained RSS/heap readings are observations without forced GC; growth alone is not a leak, and WASM memory need not shrink.

The `runBenchmark(manifest, options)` interface is shared with follow-on profiling orchestration; `samples` (1–5) and `timeoutMs` (at most 60000) may be specified programmatically. Each child has an external wall-clock kill deadline. Fewer than five successful observations are exploratory. `report.mjs` exports `STAGES`, `hashJSON`, `validateRun`, and `summarizeRun`. Summaries report median and range, never p95 from five samples. `run-schema.json` is the interchange schema; use the semantic validator as well.

External manifest version 1 contains `id`, `kind` (`bulk` or `statement`), `rows`, `format`, `sampling`, `classification` and four `{path, sha256}` entries: `input`, `reference`, `model`, `actions`. Paths resolve against the manifest directory. Each file is streamed through SHA-256 before admission. Source identity includes tracked source files and runner helpers; artifact identity includes the emitted bundle, WASM and generated JS. Environment records Node, OS, hardware, locale and default heap. Large results and manifests remain external.

For the certified control, use `format: certified-json`, the committed `src/test/fixtures/sec-statements/reference.json` as input, and `expected.json` as independent reference. The model file maps each company symbol to its actual `definition` from the input. Exactly 98 facts and 110 original-filing numeric cells are checked; this does not represent a large real Statement. Run the fixture verifier separately before measurement. Synthetic Statement cardinality workloads and larger certified corpora are not implemented or implied.

The actions file must contain exactly:

```json
[{"kind":"apply"},{"kind":"presented"},{"kind":"chartData"},{"kind":"empty-clear","cycles":5}]
```

For bulk SEC use the existing acquired CSV prefixes at 100000 and 1000000 rows and canonical 3658551-row Parquet source, with `sampling: ordered-prefix` or `complete-source`. CSV uses the production local importer; a model `{ "table": {}, "search": "" }` measures ordinary raw projection. Independent reference supplies `rows` and `uniqueIds` from acquisition verification. This is structural analytical validation, never a sum across currencies/concepts and never certified financial truth. Input retains all original columns (including unit, accession, decimal text, duplicate-key identity); there is no lossy projection. Parquet has no in-process adapter and is not materialized. A representative stable-hash sample is a distinct dataset requiring its own checksum and reference; none is silently substituted for a prefix.

The fixed experimental runner safety profile is 300000 rows, 268435456 input bytes, 2147483648 state bytes, 10000 pivot columns, 33554432 batch bytes, 67108864 cached-block bytes and 2 concurrent transfers. These are **not measured product-supported device defaults**. Before parsing, the runner reserves 128 times file size against the input ceiling; this intentionally conservative heuristic may refuse feasible product inputs. After parsing it uses the production structural graph estimator. Rust passes the unchanged profile to the actual production worker handler/runtime. TS has runner admission only, not equivalent engine enforcement. Preflight refusals are not product unsupported claims. No refusal contributes successful timing.

This adapter uses production worker handlers with in-process transport in isolated Node processes. It does not establish browser-worker, native-device, transfer-copy, rendering, input responsiveness, or end-to-end usable-view performance. Those stages remain `not-run`; a Node compute duration never substitutes for them. Memory is the process `resourceUsage().maxRSS` high-water mark (converted from KiB), not a process-tree sampler. Exported WASM buffer bytes are separate and null when unavailable. Browser evidence must add platform sampler interval, process-tree scope and actual rendering/input events before those claims can be made. All measurements remain advisory.

## Tick adapter

`--workload ticks` additionally accepts `format: ticks-csv`, the normalized five-column `ts,seq,mkt,price,shares` CSV and `tick: {granularity: "1s" | "1m", venue: "Q" | "24EQ", countOnly: boolean}`. Build the model file from exported `tickModel(tick)` in `ticks.mjs`; it includes both the actual analytical definition and runtime parameters. The adapter verifies equality with this model before execution. The same core action bundle is used; P3 can orchestrate separate cases for minute/second and venue changes without introducing another compute runner. Extended P1 sort/facet/inspection actions are not claimed by this core contract and are rejected if supplied.

The raw input remains mixed-venue. Rows retain sequence and original index, sorted by timestamp, sequence and original index. Runtime membership uses typed exact Q or 24EQ identity. The independent reference is an array of `{bucket, bucketMilliseconds, venue, open, high, low, close, volume, ticks}`; every selected venue/bucket bar is checked. OHLC selects original values/min/max and therefore uses exact binary64 equality. Shares and tick counts must be safe integers and exact. Count-only models independently check all counts, not OHLCV performance relabeled as count-only.

The matched 60000/300000 prefixes must retain their original CSV-byte checksums and references. A smaller 15000-row real prefix may be used as an explicitly exploratory adapter control (it includes observed Q and 24EQ), but cannot substitute for qualification of either planned scale. Full-day source has 2474435 rows and exceeds this runner profile. Its admission is recorded without reading it into an in-memory dataset. The available prototype is not browser-worker or native-app performance evidence.

A representative control may select canonical SEC facts whose SHA-256 of UTF-8 `fact_id` begins with `000` (inclusion probability 1/4096), restoring `source_ordinal` order afterward. Record the full population size, realized sample row count, input checksum and independent identity-count reference. This is a hash sample, not a 100k/1m/full-scale completion. Preserve original source fields or explicitly identify the projection; retain concept, unit, accession, taxonomy version and source decimal strings. The initial external full-population sample contains 898 of 3658551 rows.
