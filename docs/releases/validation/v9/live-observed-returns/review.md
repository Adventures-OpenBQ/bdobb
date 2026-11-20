# Live observed returns qualification review

The provider and Docker source pin were reviewed against the approved fixed
window, receipt transport and SDK request contract. The independent Task 5
review identified two documentation corrections reflected below. Follow-up
review and the final release-readiness review are pending.

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
- The public capture received HTTP 200, verified the data and wrote the
  fixture before an aiohttp shutdown callback raised an ignored
  cross-event-loop `RuntimeError`. The provider full-suite result is
  inherited from Task 1, with 948 passes and one optional ArcticDB cache
  skip.

See [paired verification](verification.md) for exact identities, results and
fixture paths.
