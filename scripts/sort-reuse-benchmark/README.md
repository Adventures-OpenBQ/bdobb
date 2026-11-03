# Experimental sort-reuse probes

Run from the repository root, with dependencies and Playwright browsers installed:

```sh
node scripts/sort-reuse-benchmark/run.mjs /tmp/sort-browser.json
INDEXED_PARITY_ONLY=1 node scripts/sort-reuse-benchmark/run.mjs /tmp/sort-parity.json
node scripts/sort-reuse-benchmark/memory.mjs /tmp/sort-memory.json
```

The response/timing probe uses Chromium and WebKit. It bundles the actual worker without implementation transforms, compares default and explicit worker-name opt-in modes, and checks public responses including recursive rows and complete exports. Timed observations use fresh workers, three warmups and 20 alternating trials per mode. The optional index threshold is 512 MiB of structural reservation; it is not a heap cap. Initial apply is outside the warm-sort timer.

The memory probe uses Chromium's worker debugging target. Five fresh-worker trials per workload/mode alternate order. Each trial collects garbage before sampling `Runtime.getHeapUsage` after initial apply, 1, 25 and 100 sorts, and worker-side disposal. The disposal barrier requires a subsequent input-schema request to fail before sampling; the client then terminates the worker. Only one trial's worker is active at a time. No production module is transformed or instrumented.

These memory observations measure retained V8 heap after forced collection. They do not measure peak transient allocation, renderer/process RSS, WebKit heap or physical-device memory. The debugger and forced collection alter normal garbage-collection behavior. Timing and memory probes run separately; memory-probe timings are not performance results.

Workloads come from `scripts/matched-executors-workloads.mjs`: formula uses 500 rows and 40 formulas; fiscal uses 120 rows from the mixed-calendar fixture. Raw reports include the exact worker bundle SHA-256 so runs can be compared against the same implementation. Source manifests should also be retained for uncommitted branches.

For 500 and 2,000 distinct analytical row groups (one result formula), run:

```sh
SORT_REUSE_CARDINALITY=1 node scripts/sort-reuse-benchmark/run.mjs /tmp/sort-cardinality.json
```

This mode verifies that the baseline produces the expected group count and a complete result before comparing responses. It retains the lifecycle checks on the formula workload. Use it to detect work that grows with both group count and source row count.
