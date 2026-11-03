# Experimental analytical sort reuse

This TypeScript optimization is disabled by default. It reuses an existing complete analytical calculation when only display sorting and selection change. It restores canonical sibling and leaf order before sorting, preserving stable ties across repeated requests.

For an embedded handler, pass `{experimentalSortReuseBytes: 536870912}` as the second argument to `createWorkerHandler`. For the native module worker, set its `name` to `bdobb-experimental-sort-reuse:536870912`. Zero disables reuse. The option must be a safe integer from zero through 4294967295. No application setting enables it automatically.

The number is a conservative structural reservation threshold, not measured JavaScript heap usage or a process memory cap. The example is an experimental threshold, not a recommended device default. Admission can decline even below available device memory.

Reuse requires an enabled schema-1 analytical model, complete input and calculation, unique source row IDs, and default selection reconciliation. Statements and split-only layouts use full calculation. Changed definitions beyond sorting, changed runtime parameters, input registration or disposal, unsupported graph values, inadequate reservations, and incompatible revisions also use full calculation. Normal request/model/runtime validation remains active.

The canonical index and exact calculation-time group sort keys belong to the private result-store snapshot. Public store creation still clones caller input; the optimization sorts a private candidate and publishes it only after successful construction. Source acquisition invalidates the old store even when the input revision is unchanged. Rust/WASM execution is unchanged.

Focused tests compare repeated public ready, recursive row, total, chart and export responses against full calculation, and cover admission, invalidation, selection reconciliation, snapshot isolation and inherited-property semantics. Captured group sort keys eliminate repeated source-member scans during warm sorting; a regression verifies zero member lookups and full publication parity. The structural reservation estimates 1,024 bytes per canonical entry, and capture is bounded by the same divisor.

The current worker passed public-response parity in Chromium and WebKit for ordinary workloads, 500/2,000 distinct row groups, and nine lifecycle scenarios per browser. In exploratory desktop runs (20 observations per mode), warm formula-sort medians were 75.4→21.85 ms in Chromium and 82.5→26 ms in WebKit. At 2,000 groups, medians were 121.95→39.35 ms and 125→54 ms. Other applications were active; these are local observations, not controlled performance guarantees. Capture has an initial cost: Chromium's 2,000-group cold medians were 144→146.15 ms and WebKit's were 152→156 ms.

A separate current-bundle Chromium probe ran five fresh-worker trials per workload/mode through 100 sorts. Median V8 used heap after forced GC was 3.80 MiB full versus 3.61 MiB opt-in for formula, and 2.11 versus 1.76 MiB for fiscal. Opt-in growth between sorts 25 and 100 was about 1.0 KiB and 6.7 KiB. Disposal reduced used heap in every trial. These whole-isolate values include runtime/JIT effects; they do not isolate index size or measure transient peak/RSS/device memory. High-cardinality heap, WebKit heap and physical-device qualification remain outstanding.

Reproduce using the commands and methodology in `scripts/sort-reuse-benchmark/README.md`. Worker bundle hashes accompany raw reports to distinguish metadata revisions. Earlier benchmark reports describe the previous index representation and should not be treated as measurements of the current bundle.
