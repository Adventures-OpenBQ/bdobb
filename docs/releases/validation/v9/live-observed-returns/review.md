# Live observed returns qualification review

Tasks 1–6 completed independent task review against the approved design.
The first independent whole-change review then found two Important admission
errors. The consolidated fix completed implementation and independent scoped re-review.
Both Important findings are addressed; no new Critical or Important breakage was found.
[Whole-change review](independent-whole-change-review.md) · [Final fix review](independent-final-fix-review.md).

| Task | Reviewed change |
| --- | --- |
| Provider acquisition | Reviewed the per-listing SDK call count, plain routes, exact repeats and unsafe receipts at `8c06e57e`. |
| Client admission | `709be6af` requires an original observation before a safe receipt can account for a duplicate. Follow-up review verified rejection of an orphan duplicate count. |
| Sample admission and lineage | `e0adcc4c` uses the acquired adjusted-close origin when display aliases would otherwise fail worker preflight. Follow-up review checked both engines and both views. |
| Controls and source lifecycle | `dcd25413` checks the delivered Rita tool result for each configured and pinned turn, including the new bounds after Run. Follow-up review verified the controlled failures and passing four-mode replay. |
| Paired image and live capture | `ce39607e` records the canonical runtime's declared dependency bounds and the full qualification run history. Follow-up review verified both documentation corrections. |

The release checks verified all three source identities, vendor parity,
compiled artifact fingerprints and the production bundles. The earlier
test results are attributed to their exact inputs. The first independent
whole-change review examined receipt contents, backend authority, both kinds
of coordinate loss, caller order, ordinary routes and source replacement races. [Approved design](../../../../superpowers/specs/2026-11-20-v9-live-observed-returns-design.md) · [Execution plan](../../../../superpowers/plans/2026-11-20-v9-live-observed-returns.md)

- Re-vendoring copied each tracked file from the canonical Git object. The
  installed wheel comparison checks its package inventory and every packaged
  file against that same pin. The dependency-consistent `pip check` pass
  covers the Docker image with the two EODHD history mirrors. A separate
  canonical runtime exercised the standard aliases with a stubbed SDK and
  OpenBB Core 2.0.1. Its `openbb-equity==1.6.2`, `openbb-etf==1.6.2`
  and `openbb-platform-api==1.3.6` each declare
  `openbb-core>=1.6.10,<2.0.0`.
- The earlier selector capture queried the widget's top-level `dataKey`.
  The generated definition already declares `data.dataKey = "results"`.
  The installed regression checks that nested key directly. Two exploratory
  cases requiring an explicit widget override failed and the expectation was
  withdrawn after confirming the generated default.
- The certifi lock change and its Requests trust gate are in a separate
  Docker commit. The gate loads the effective CA file with TLS verification
  enabled and checks DER fingerprints. Its first version matched every
  emSign name. Certifi intentionally restored the unaffected G1 root in its
  compatibility release. The final gate checks the removed G3, C1, C3 and
  cross-signing AAA roots. [Certifi advisory](https://github.com/certifi/python-certifi/security/advisories/GHSA-6q48-6c7w-9gw2) · [G1 restoration](https://github.com/certifi/python-certifi/commit/662df63) · [Mozilla incident](https://bugzilla.mozilla.org/show_bug.cgi?id=2083449) · [C1/C3 removal](https://bugzilla.mozilla.org/show_bug.cgi?id=2083709)
- SDK counts are measured at the call boundary. The deterministic captures
  exercise both exact-repeat collapse and a known missing adjusted value.
  The public examples independently verify the source dates and adjusted
  prices. Scope remains observed quote-to-quote returns. Entitlement and
  exchange-session completeness remain unknown outside these acquisitions.
- The ordinary route retains its prior table behavior. Opted-in responses
  use adjusted-price rows and may report an unsafe basis or an empty
  counted result. The client requires a safe reconciled receipt to qualify
  the history for a return summary.
- The public capture received HTTP 200, verified the data and wrote the
  fixture before an aiohttp shutdown callback raised an ignored
  cross-event-loop `RuntimeError`. The earlier provider full-suite result was
  inherited from Task 1, with 948 passes and one optional ArcticDB cache
  skip.
- The existing narrow-touch median hover failed once concurrently in
  Chromium TypeScript and passed unchanged in the serial matrix. The exact
  cause remains open. The current Knip warning, build notices and optional
  integration skips are recorded with their scope in verification.

See [paired verification](verification.md) for exact identities, results and
fixture paths.

## Findings from the whole-change review

- A daily request could certify observations explicitly marked weekly in either OpenBB `interval` or SDK `period`. The canonical fetcher now checks every raw bar before date, price or normalizer loss. The client checks every selected row and each worker input using acquired field origins. Unlabelled sparse dates and explicit daily declarations remain eligible.
- One listing could switch from dollars at 100 to cents at 10,000 and yield a spurious +9,900% return, or switch currencies mid-history. The provider and client now compare explicit currency and unit strings within each listing. A contradiction disables the whole receipt. Undeclared dimensions and independent listings with different stable denominations remain eligible. Neither acquisition nor projection converts prices.
- Four observed returns now produce observed-quote guidance and the live scope sentence. The exact four-return local snapshot guidance is preserved. The portable verification history now identifies the successful build's separate shutdown warning and the baseline Knip invocation.
- Mixed paging and message wrappers can report the generic invalid-response reason. Fully filtered sources can prioritize insufficiency over invalid binding guidance. Both continue to refuse. The earlier narrow-touch hover failure and all environment limits remain open as described above.

The implementation and its requalification are recorded in [paired verification](verification.md#final-declaration-fix-and-requalification). The controller owns the independent scoped re-review.

## Final independent verdict

The reviewer checked client `bfb38a8f154a8bcfb23bc56023d432dfeba2928c`, canonical provider `adb2e2e410552863bcbfbd5584e3e7c9720d0cbc` and Docker `52436dd8a1a6a13eaf142a8486a7f0bda7f1db5b`. The final local arm64 image is `openbq-v9-live-observed-returns:final-adb2e2e-20261120`, OCI index `sha256:068944e7bded0471cb222399db083ffeb6306ae30fe14954907fa0dd8dfc2acc`. Subsequent bookkeeping changes only the plan and these review records.

Explicit weekly interval/period declarations and within-listing currency/unit contradictions now invalidate evidence before normalization or filtering can hide them. Missing declarations, sparse observed data and different stable denominations on separate listings remain eligible. The reviewer recomputed all five final capture variants and both public 29-quote/28-return series. The recorded 26 focused browser checks passed.

Ready for integration review. Known diagnostic-priority and transient touch-hover qualifications remain documented in verification; this verdict does not authorize publication, merging or deployment. All worktrees and raw evidence are preserved.
