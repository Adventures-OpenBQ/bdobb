# Final whole-PR review fix wave

Base: `7ef3390232ddf6747a697ec6d55bb35622fd4552`. One implementation wave, no subagents, reviewers, push, production-default change, fixture regeneration, dependency change, or CSP widening. Physical-device evidence is coordinated separately by the controller. This report describes the commit containing it; use the final returned commit SHA for scoped re-review.

## Correctness changes

- Protocol decoding follows response-schema positions. Structural maps named `tag` (aggregations, buckets, periodicity and other definition maps) remain ordinary objects; explicitly tagged source values, metadata, provenance, filters and inspection payload values still use the strict wire decoder. Malformed true wire values refuse. Native and real worker tests cover arbitrary nested metadata as well as structural maps.
- Every legacy leaf carries a private source ordinal through grouping/sorting. Legacy row construction indexes the original source to retain equal-valued rows' distinct IDs, cell errors and formats. Public low-level metadata retains the frozen optional `sourceIndex` shape. Native and actual-worker tests traverse nested groups and reversed block offsets.
- String coercion is fallible at consuming unique-count, key/label, source filter/search and facet paths, including nested arrays with an own noncallable `toString`. Unused bad objects remain admissible. Search respects the baseline declared-column order and short-circuits after the first matching field. Boolean filters stringify the cell before comparing filter type. Candidate refusal preserves the prior rows, totals and pulled export. No blanket eager rejection or source-object-property reordering was added.
- Cell error and warning projection uses a 1,000-UTF16-unit prefix. Six hundred emoji become five hundred; a cutoff splitting a scalar refuses under the existing scalar-boundary policy. Warning validation runs after projection, before publication, because projection can append warnings.
- The TS oracle and actual-Wasm session consumers assert all 41 fixture wrappers have `formatVersion: 1` and baseline revision `74cc3f6c4c718cd76044722b954a7bc0761c8866`. No fixture was changed.
- Native inspection now enforces collection-specific optional selectors and bounded offset/limit/string fields, matching the JS guard. No new API was introduced.

## Measured local performance changes

`scope_errors` builds one borrowed first-row-by-ID BTreeMap per invocation, preserving first-universe-row identity, missing-ID behavior and diagnostic order. Aggregate evaluation reuses scope errors per exact scope. The operation regression changes the old 5,150 visits for 100 rows to 200 index visits/lookups; N=100/1,000/5,000 all produce 2N. This removes the quadratic universe scan; BTreeMap operations still have logarithmic cost and scope matching retains its own work.

One `calculate_view` preparation owns a result vector keyed by complete typed `CalculationScope` equality (including ordered IDs, constraints, context slices, fiscal evidence and Statement members, with float-bit comparison where values occur). It preserves original evaluation/projection order and reuses nonadjacent A/B/A/B column scopes. Original/pre-filter and retained scopes only share results when fully equal. Source/formula cells are borrowed during aggregation. The F=1/5/20 min-formula test requires exactly 5F comparisons for overall+two group scopes, including split-only interleaved columns. Scope construction, exact-key comparison and linear memo lookup remain; this is not cross-revision caching.

Sorts return early for zero keys and apply validated permutations by swaps, without cloning owned payloads. Invalid permutations still refuse. Numeric comparisons still use the existing host bridge; callback counts in every matched workload are identical before/after.

### Temporary memo resource estimate

The existing pre-calculation admission adds two conservative source-sized workspace slots, changing 16 to 18 (+12.5% of the workspace term). In the supported bounded state profile:

`workspace = (estimated(input) + estimated(definition) + extra) × (rows+1) × width × depth × (categories+formulas+1) × 18`.

The two added slots reserve retained aggregate results/typed scope keys plus error/index scratch across the complete scope/output combination bound; result/formula/category multiplicities are already included by the factors. The check still adds existing retained bytes, host reservation and `estimated(definition) × 12,288` before accepting preparation. Checked arithmetic refuses overflow. Unsupported Statement/MEMBER context-expansion profiles remain refused when a state cap cannot conservatively bound them. No cap is disabled or postponed until after allocation. The memo is local, so `resource_usage` retained bytes do not include it after preparation. This is a conservative reservation, not actual allocator/process peak accounting; the larger reservation can refuse a candidate that previously fit a finely chosen cap.

### Matched timings

Artifacts were measured quietly and serially on Apple M1 Max, Darwin 27 arm64, 64 GiB, Node 26.10.0, Rust 1.98.1, wasm-bindgen 0.2.128. Baseline source was extracted directly from the immutable base with `git archive` and built with the same release target/toolchain/empty Rust flags. Both artifacts used the same current host protocol/oracle and benchmark script, isolating the Rust artifact comparison. Script SHA256: `15f9ba295da6fd335293c7b73c2735da71c18a9788b437f0055492c6a5bd07e7`. Every paired encoded workload SHA256 is equal.

- Baseline Wasm: `f9631a0b31d448b342010c2b76d32f187159eab6eca4775854eaf7af0964c8ea`.
- Final Wasm: `ca5a13b7d96d06f7840d241b3c8a4c715a2a766a31219b980b29aee2c67acd75`.
- Final build source fingerprint: `9591797bd6f88b95049148e012520cef898dba2bdeec2bc261703fb2825c87f0`.

Fresh child/Wasm instance per workload; three samples and five successive edits per sample. Grouped1k/5k/10k use distinct revenue values to exercise identity reconstruction. Formula workloads use 500 rows, F=1/5/20 aggregate formulas and 20 source formulas. All projected chart rows, totals and exports are checked against the independent TS oracle with only its documented floating tolerance. Table values are milliseconds; apply is actual Wasm dispatch (parse+calculation+publication+serialization), edit is end-to-end Node request/dispatch/decode. These are observations from three samples, not confidence intervals or TS-vs-Rust speedups.

| Workload | Base apply | Final apply | Signed change | Base → final edit median |
|---|---:|---:|---:|---:|
| grouped1000 | 13.542 | 4.458 | -9.084 (-67.1%) | 28.543 → 19.591 |
| grouped5000 | 237.393 | 19.138 | -218.255 (-91.9%) | 275.781 → 49.846 |
| grouped10000 | 916.822 | 39.747 | -877.075 (-95.7%) | 988.937 → 85.241 |
| formula1 | 37.112 | 29.615 | -7.497 (-20.2%) | 46.895 → 34.770 |
| formula5 | 220.058 | 43.220 | -176.838 (-80.4%) | 231.517 → 52.543 |
| formula20 | 2827.756 | 107.106 | -2720.650 (-96.2%) | 2802.745 → 120.061 |
| largeRaw | 33.089 | 25.865 | -7.224 (-21.8%) | 233.814 → 226.476 |

Wasm linear-memory high-water is unchanged for grouped workloads, F20 and raw; F1 changes 38,141,952→37,748,736 bytes, F5 changes 39,845,888→39,518,208 bytes. Retained estimates are unchanged for grouped/raw and modestly lower for formulas. Node RSS/heap are stage-boundary samples including the TS oracle; Wasm pages include free capacity. Neither establishes peak live allocations, browser process memory, or physical iPad acceptance. Large raw's smaller observed change is not independently attributed to one optimization.

Tracked evidence: `docs/releases/validation/rust-pivot/final-fix-before.json`, `final-fix-after.json`, `final-measurements.json`. The original `measurements.json` is unchanged and copied verbatim as `measurements-initial-8dd.json`; it represents authored 8dd implementation before subsequent JS admission repairs, not this matched baseline. The final standard seven-workload refresh records three Node samples and one browser run with five edits per workload in Chromium 151.0.7922.34 and WebKit 26.5.

## RED/GREEN evidence

Meaningful failures preceded fixes: `final-fix-red-native.log` (bad uniqueCount accepted), `final-fix-red-worker2.log` (equal-leaf identity and coercion publication), initial worker log (structural tag decoding), `final-fix-red-perf.log` (UTF16 prefix), `final-fix-red-perf2.log` (8 instead of 5 comparisons at F1), `final-fix-red-lookup.log` (5,150 instead of200 visits), `final-fix-red-sort.log` (6 clones instead of0), `final-fix-red-inspect.log` (unrelated selector accepted), and `final-fix-red-boolean.log` (non-string filter bypassed required cell coercion). Logs are under `/private/tmp`; initial setup/compiler failures were corrected before counting a meaningful RED. Final source is verified against actual rebuilt Wasm, not only native tests.

## Final sealed-source gates

- Rust 1.98.1 locked/offline core: 161 tests, 0 failures; native Wasm crate: 0 tests (no assertion credit), successful compilation. Core and Wasm clippy `--all-targets -- -D warnings` pass.
- Pinned release Rust 1.98.1/wasm-bindgen 0.2.128 rebuild and real emitted web-module initialization/protocol/unshared-memory smoke pass. Final artifact fingerprint verification passes after packaging/build gates.
- `pnpm typecheck` and plain `pnpm lint`: pass.
- Escalated local-listener `LOOPBACK=1 pnpm test:run`: 333 files / 6,185 tests pass; 2 files / 7 tests skipped; 50.76s. Includes actual generated-Wasm session fixtures and added worker/protocol/coercion/Unicode regressions.
- Final dedicated Chromium/WebKit built/dev/nested/authenticated-private worker suite: 16 pass, 44.9s, including all 41 frozen traces on built/dev paths, resource/refusal/worker-replacement and review regressions.
- Existing Pivot drawer/frame/viewer/runtime/Page-runtime suite: 36 pass, 1.2m.
- Web server tests: 33 pass. Packaging tests: 3 pass. Production build and private-web build: pass (existing chunk-size warnings only).
- HTTPS private-web browser smoke: pass, no external requests. Unshimmed app smoke: React mounted without console errors.
- Original pnpm store notices: up to date; scrub/header checks clean; diff whitespace check clean.
- Isolated native Tauri custom-protocol probe: pass, release build 1m17s, exact resources/replacement/unshared memory/disposal/review regression assertions. Hidden incognito independent bundle identifier, unchanged source CSP, no normal startup/migration. Temporary entry removed. Evidence: `final-fix-native-evidence/` beside this report; first temporary setup attempt failed on a flat-versus-nested copied-asset path before building, then was corrected.

All listener/browser tests used sandbox escalation rather than an unauthorized sandbox loopback attempt. Logs `/private/tmp/final-fix-*-sealed.log`, `final-fix-existing-pivot.log`, `final-fix-web.log`, `final-fix-packaging.log`, `final-fix-vite-build.log`, `final-fix-web-build.log`, `final-fix-web-browser.log`, `final-fix-app-smoke.log`, `final-fix-notices.log`, and `final-fix-scrub.log` preserve gate outputs.

Separate controller-delegated secondary physical evidence was read at `/private/tmp/bdobb-physical-ipad-evidence/README.md` and `summary.json`:physical iPad Pro 11-inch M5 / iOS 27.0.1 Safari 27.0.1 passed all 41 frozen traces plus resources, replacement, review regression, 1,001-row export and disposal, on exact final Wasm hash. The synthetic LAN HTTP harness was not a secure context; it used the approved source CSP and unshared memory. No actual touch/background or budget acceptance is inferred. The bounded server was stopped. The controller owns preservation of that separate device evidence.

## Deferred and remaining acceptance

Broad ownership/arena changes, persistent stage reuse, cross-revision caching and native numeric host-crossing shortcuts remain deferred: they require separate identity, NaN/mixed comparator, failed-candidate and resource-accounting work. The local owner-preserving changes here have measured benefit without changing those contracts. The host callback bottleneck in sorted raw edits remains measurable (920,679 raw crossings across this benchmark).

TypeScript remains production default. Regular physical midrange iPad memory/performance, actual React touch/background behavior, operational budget calibration, installer and controller final-head CI/review remain open. The separate physical Pro smoke adds secondary compatibility evidence only. No simulator or desktop result closes these device/default-activation gates.

## Controller-identified final JS alias boundary

After the native gates, the controller identified programmatic rows sharing the
same top-level `values` object. Baseline structuredClone preserves this alias and
legacy `Map(values,row)` reconstruction returns the last row for both leaves.
The previous wire conversion silently de-aliased it. A WeakSet acquisition guard
now refuses this representation with existing `INVALID_REQUEST`, before tagged
conversion, after existing resource and Unicode/plain-data validation. The guard
is outside native-dispatch trap handling, so it remains a recoverable request
error. Distinct equal values and nested aliases remain accepted; callers can
clone values per row. No session state, wire enum, native artifact or saved model
changes were added. Spec appendix and public acceptance notes document the
uniform acquisition restriction. Actual worker and actual-Wasm facade tests
assert old source/model/rows/totals/export retention and ordinary A/B identities.

`final-fix-red-alias2.log` records both meaningful RED failures: direct encoder
accepted the alias, and actual worker registered the candidate. The initial
baseline test accidentally inspected selection-eligible groups; it was corrected
to inspect leaf logical rows before recording that RED. Post-guard focused encoder/worker/wire/client/host checks: 84 pass; actual-Wasm facade plus runtime checks: 27 pass. Post-guard typecheck and lint pass. Full unit: 333 files / 6,188 tests pass, 2 files / 7 tests skipped, 50.31s. Rebuilt Chromium/WebKit conformance: 16 pass, 46.1s. Pinned-artifact verification and scrub/header checks pass. Logs: `/private/tmp/final-fix-alias-focused.log`, `final-fix-alias-facade.log`, and `final-fix-*-post-alias.log`. The 36 existing UI, web/packaging/build/native checks were not unnecessarily repeated for this isolated JS acquisition guard.

All timing, native WKWebView and secondary physical Pro snapshots described above
precede this final JS guard. Their Wasm bytes remain exact; neither guard overhead
nor a post-guard physical/native JavaScript snapshot is claimed. The final unit
and browser status below explicitly identifies post-guard checks.

Final commit staging excludes temporary native entry/assets and all generated Wasm outputs. The frozen fixture tree and original measurement file are unchanged.
