# Matched pivot performance workload descriptors

`resolvePerformanceWorkloads({tickManifest, secManifest, baselineCommit, candidateCommit})`
accepts JSON objects or external adapter JSON filenames. It returns sanitized JSON descriptors,
never source financial rows, local filenames, credentials or contact details. This is a resolver,
not another runner. Qualification runners must execute the ordered actions with selection,
inspection, facets, export and diagnostics enabled. Actions after first apply share the registered
session. Explicit empty selection and Clear retain the engine's existing meanings.

Pin full 40-character commit IDs for both engines. The checked starting tree is
`70e1152fd37aa50f3a15fd7a0163b2ecde413c32`. Its ancestry includes #25's
`e858d619`, preparation `51f5cdaa`, #23 `b20f378a`, and #22 `a812df58`.
These changes already exist in this release/v4-derived tree; never benchmark an obsolete
pre-dependency stack as the current baseline. No merge is needed.

External tick adapter:

- `inputMode: "raw-mixed-runtime-filter"`, `venueFilter: {operator:"exact",key:"Q"}`.
- `ordering: "timestamp-sequence-original-index"`, `observedVenues`: actual venue keys.
- `samples`: entries for 60000 and 300000, optionally full day with `fullDayRows` (a safe integer greater than 300000).
  Declare `fullDaySource:{rows,sha256}` with the complete normalized source row count
  and checksum; both must match the full-day sample. Each sample size appears once.
- Each sample: `rows`, `policy:"ordered-prefix"`, `observedVenues`, `sha256`,
  `modelHash` (full OHLCV model/action bundle), `countModelHash` (count-only bundle),
  `reference:{sha256,independent:true}`. Hashes are SHA-256 lowercase hex.

Compute input hashes from the exact ordered mixed-venue prefix bytes, retaining identities,
timestamps, sequence and original index. Record encoding/newline policy externally. Hash each
complete canonical JSON model/action bundle (including grouping variants and linked consumer)
with UTF-8 SHA-256, and independently generated every-bar references for that exact prefix and
all requested venues/granularities. Hashes are evidence supplied by the adapter owner: this
resolver validates schema/semantics, not the truth of the independent reference claim. Verify
those files before execution. Never use a full-day reference checksum to imply prefix parity.
The alternative exact venue is the lexically first observed non-Q key present in both sample
and acquisition evidence. Full day is explicitly conditional on unchanged admission limits.

The acquired NVDA summary reports 2,474,435 rows, 335,004 Q rows and 1,508,443 D rows.
The legacy acquisition supplies raw download SHA-256 and summary/venue counts, but no
prefix model/reference hashes. Existing 1s/1m Q/all/by-venue CSV references cover the full
day. The legacy tick case's capped runs explicitly say "smoke only". Do not reinterpret
those as independently certified prefixes. Produce independent matched prefix references
outside Git before admitting performance runs. The raw SHA identifies the download, not
its normalized CSV or either prefix. No API endpoint query strings are copied by adapters.

External SEC adapter has `workloads`: one `certifiedStatement` with `classification:"real"`,
`rows:98`, `expectedCells:110`; three `bulkAnalytical` real entries with 100000, 1000000,
and 3658551 rows. Each entry has a unique nonempty string `id` matching `[a-z0-9][a-z0-9._-]*`, `sha256`, `modelHash`, and independent
`reference:{sha256,independent:true}`. Optional `syntheticStatement` entries require
`classification:"synthetic"` and `invariantsVerified:true` for company/unit/period rules.
Bulk input is analytical/import stress and never a large certified Statement. Synthetic
entries require separately authored model and reference evidence; none are fabricated here.

The portable `sec-statements/manifest.json` binds reference.json (98 facts), expected.json
(110 cells) and trace.json. Run `verify-fixtures.mjs` before adapting it. Extract and hash the
actual model/action bundle separately; the payload checksum alone is not a model hash.
The external SEC catalog identifies 3,658,551 facts and 100k/1m CSV imports; csv-verification
confirms prefix row counts and unique identities. It does not provide whole-result analytical
reference/model checksums. Keep those missing fields blocking rather than substituting
source spot-checks for an every-result reference.

Validation: `node --test scripts/pivot-qualification/performance-workloads.node.mjs`.
No builds, profiles, timing samples, resource-limit changes or real data are committed.

A read-only CSV scan of the first 60k and 300k rows observed the same venue keys:
24EQ, A, B, C, D, H, J, K, L, M, N, P, Q, TXSE, U, V, X, Y, Z.
Under the deterministic rule above the recorded alternative is **24EQ**, not an
assumed venue. Exact member selection is essential because a substring Q could
also match 24EQ. Acquisition summary independently reports both keys.

Follow-up read-only validation generated independent 60k/300k every-venue 1s/1m prefix
references outside Git using the same direct-CSV independent reduction method demonstrated
in the existing preparation integration proof. Those fingerprints are available in the
external `p1-matched-fingerprints.json`; exact tick runner model/action bundles and bulk
Task7 whole-result references remain required. The certified SEC dataset, definition and
expected-cell bundles were independently hashed from the committed corpus as well.
