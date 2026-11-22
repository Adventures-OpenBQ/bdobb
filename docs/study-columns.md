# Shared study columns

A live-grid widget advertises `extra_metadata.study_columns_v1: true` when its
shared study service is configured. The grid reads `study_catalog` and generates
its Add/Edit Study Column controls from each registered definition's
`param_schema`: integer, number, string, boolean, nullable defaults, bounds, steps
and enum choices. Registered output names are selectable without frontend study
formulas. Definitions requiring additional chart time/ticker/session context or
unsupported parameter metadata remain listed with an unavailable reason; they do
not prevent other definitions from being used.

Each `TableCardState.studyColumns` entry stores its own ID, study/output,
parameters, interval, session, price basis, provider, definition version,
presentation and point count. Editing one entry does not alter registry defaults
or other columns. RSI14/latest and explicit stochastic14/3/3/slow-K/sparkline60
are convenience presets. Sparkline points are presentation history, separate from
indicator lookback. The RSI latest/both view retains the original centered
reading and outward 30/70 band meter; the supplied result remains full precision
for sorting, filtering and accessibility.

The grid sends one batched `study_results` request per second, with no overlapping
requests or per-cell fetching. Column, symbol or connection changes cancel/ignore
old work. Presentation-only changes reuse the current calculation. Quote updates
continue on their existing WebSocket. Results retain server parameters, context,
version, revision, as-of time and input cursor; warmup/null/error values are not
replaced with zero. Removed definitions or old versions can be edited/repaired or
removed. The server remains authoritative for parameter/context validation.

The wire is bounded to50symbols,16columns,256points/column,64KiB requests and2MiB
responses. New study HTTP helpers use header/cookie authentication; no credential
is placed in a request URL. Browser preview relays only exact authenticated
GET `/grid/study_catalog` and POST `/grid/study_results` targets, with bounded JSON
and a5s upstream deadline. No upstream URL comes from the browser payload.

Native dashboard saves and compatible workspace import/export validate and retain
study specs independently of sorting, widths, pins and other table state. Strict
OpenBB export retains its existing portable subset. This slice adds no study
socket, does not modify anchor controls, and does not migrate the embedded Arts
accepted-candle/anchor renderer. The Arts parameter editor uses the same server
catalog through its separately vendored client. No v12 rollout is implied.

Validation includes the real43-definition catalog, a custom decorated study,
nullable metadata and256-choice enums, independent edits/reload/removal, numeric
sort/filter/null handling, request cancellation and authorization changes. Run
`pnpm test:study-layout` for the real Chromium regression covering the RSI meter's
width and centered reading (separate from the DOM/unit suite).
