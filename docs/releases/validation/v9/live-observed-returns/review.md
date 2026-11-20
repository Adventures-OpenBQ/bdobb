# Live observed returns qualification review

The provider and Docker source pin were reviewed against the approved fixed
window, receipt transport and SDK request contract. Independent Task 5 review
and the final release-readiness review are pending.

- Re-vendoring copied each tracked file from the canonical Git object. The
  installed wheel comparison checks its package inventory and every packaged
  file against that same pin. The Docker stack has two history mirrors. A
  local canonical installation with standard routers also exercised the two
  standard aliases.
- The earlier selector capture queried the widget's top-level `dataKey`.
  The generated definition already declares `data.dataKey = "results"`.
  The installed regression checks that nested key directly. The provider
  router requires no selector override.
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

See [paired verification](verification.md) for exact identities, results and
fixture paths.
