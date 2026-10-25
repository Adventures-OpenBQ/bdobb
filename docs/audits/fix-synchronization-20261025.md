<!-- Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only -->

# Fix synchronization on 25 October 2026

This branch carries the audited version 10.0.0 corrections onto the current public release history. It does not publish or promote a release.

- Public base: `9cded7a12f0303b42f201cd78046249712039beb`.
- Original audit source: `1ea8e43db2d3269038c251b0635fcfa7d6ed12d3`.
- Validation: fresh native unit suite, typecheck and lint passed on the combined tree. The full test summary follows.

```text
 Test Files  480 passed | 6 skipped (486)
      Tests  8720 passed | 31 skipped (8751)
   Start at  18:23:51
   Duration  132.49s (transform 10.52s, setup 50.57s, collect 88.15s, tests 192.50s, environment 114.52s, prepare 20.09s)
```

Reconciliation: Adjusted patch license-header context to public AGPL; retained public licensing metadata.

V8–V10 release promotion remains on hold. V11 testing remains paused. No release branch or version tag is updated by this source synchronization. Earlier V7 device observations qualify the recorded audit binary; they do not stand in for a new artifact qualification. No paid model validation was repeated.
