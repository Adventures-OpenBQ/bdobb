<!-- Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only -->

# Fix synchronization on 25 October 2026

This branch carries the audited version 8.0.0 corrections onto the current public release history. It does not publish or promote a release.

- Public base: `c8a9b6aac6bdda5d20194369f7d1e7ad8f0882b2`.
- Original audit source: `b99a885c588bdc63ec21f3d882cb2305c319fbae`.
- Validation: fresh native unit suite, typecheck and lint passed on the combined tree. The full test summary follows.

```text
 Test Files  474 passed | 6 skipped (480)
      Tests  8517 passed | 29 skipped (8546)
   Start at  18:20:58
   Duration  170.35s (transform 13.29s, setup 63.94s, collect 133.62s, tests 225.86s, environment 144.47s, prepare 25.01s)
```

V8–V10 release promotion remains on hold. V11 testing remains paused. No release branch or version tag is updated by this source synchronization. Earlier V7 device observations qualify the recorded audit binary; they do not stand in for a new artifact qualification. No paid model validation was repeated.
