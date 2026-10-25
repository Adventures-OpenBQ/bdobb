# Physical iPad Pro matched executor comparison (partial)

On the connected physical iPad Pro 11-inch (M5), iOS/Safari 27.0.1, the current Rust path was slower than TypeScript across the four completed synthetic workloads. This is secondary Pro evidence; it does not establish regular-iPad, UI paint/touch, or memory gates. TypeScript remains the default.

Each complete case passed the independent baseline and cross-engine preflight, then ran three discarded warmup pairs and 20 sequential alternating timed pairs using fresh production workers. Both paths include their real client validation, transport, worker startup and publication costs. HTTP asset-cache logs show one fetch per compiled entry/worker/Wasm asset and no postwarm refetch. Tagged JSON inputs were parsed before harness timing. Median and nearest-rank p95 were independently recomputed from individual observations.

Values below are median / p95 in milliseconds. Full phase components and individual observations are in [physical-ipad-matched.json](physical-ipad-matched.json). Safari timer resolution constrains interpretation of 0/1 ms values.

| Workload | Engine | Load ready | Pivot edit | Sort/filter | Full pulled export |
| --- | --- | ---: | ---: | ---: | ---: |
| Small 100 | TypeScript | 10 / 11 | 2 / 2 | 2 / 3 | 1 / 1 |
| Small 100 | Rust | 61 / 63 | 27 / 27 | 77 / 78 | 5 / 6 |
| Grouped 10k | TypeScript | 136.5 / 142 | 72 / 79 | 192.5 / 212 | 1 / 1 |
| Grouped 10k | Rust | 2209.5 / 2261 | 698.5 / 710 | 3059.5 / 3156 | 56 / 57 |
| Representative 20k | TypeScript | 252 / 269 | 137 / 155 | 379 / 423 | 1 / 1 |
| Representative 20k | Rust | 4450.5 / 4520 | 1411 / 1419 | 6891.5 / 6920 | 109 / 110 |
| Raw 10k | TypeScript | 112 / 118 | 74 / 78 | 195.5 / 203 | 40.5 / 45 |
| Raw 10k | Rust | 2123 / 2152 | 838.5 / 847 | 7878.5 / 7957 | 1975 / 1991 |

The first bounded run completed small, grouped and representative cases, then expired during raw. Its 13 partial raw observations were excluded. A fresh-token 30-minute bounded continuation reused identical compiled assets, reran raw with three fresh warmup pairs, and completed all 20 pairs. Raw guarded foreground visibility before/after observations and disposed workers on visibilitychange. First-run cases recorded visible at page start; continuous foreground was not verified.

Formula preflight passed and four timed observations completed; the run then disposed the active executor. The archived stack location aligns with the visibilitychange abort handler, supporting a hidden-page inference; an explicit stop reason was absent in that run. Formula partial timing is excluded, and wide/fiscal never started. All further measurements stopped, both owned servers exited, and remaining formula/wide/fiscal work awaits foreground readiness. Known mixed 12-row and 1000-row cases remain excluded from comparisons.

The build comes from revision `0e6bd687d5929de4058f14e90ad00d48b76644e4`. Exact artifact/workload/source hashes are in JSON. The temporary common active-executor reference assignment is included in factory/cold-load timing; its disposal hook handles fatal deadlines. This fresh isolated Vite composition is not byte-identical to desktop JavaScript. Final Wasm SHA256 is `ca5a13b7d96d06f7840d241b3c8a4c715a2a766a31219b980b29aee2c67acd75`.

Parity uses exact schema-directed structures, row IDs/order, values/errors/formats, columns/totals and export metadata. The parity normalizer strips envelope requestId and exported.batches; transfer IDs never enter the accumulated export snapshot, and are not removed recursively. Only helper-approved mean/division computed output values permit 1e-12 relative/absolute tolerance; no blanket numeric tolerance.

Synthetic LAN HTTP used secureContext false with the approved source CSP including wasm-unsafe-eval. No JavaScript unsafe-eval, profiles, certificates, installs or default changes. Battery/thermal conditions and worker/process peaks were not observed; the gap has no established causal attribution. Local evidence remains under a private temporary evidence directory and is omitted from public artifacts.

Hash naming: `built/index.html` records pre-runner-injection HTML. `served-index.html` is a digest alias for the actual served HTML response bytes, not a separate disk file.
