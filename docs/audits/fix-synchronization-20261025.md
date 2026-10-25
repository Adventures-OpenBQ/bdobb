<!-- Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only -->

# Fix synchronization on 25 October 2026

This branch carries the audited version 6.0.0 corrections onto the current public release history. It does not publish or promote a release.

- Public base: `cb83d212f4618307dbe501c4abe9269e14e24364`.
- Original audit source: `400caa0b91597806a9a934140f7fad42adde4aa4`.
- Validation: fresh native unit suite, typecheck and lint passed on the combined tree. The full test summary follows.

```text
 Test Files  452 passed | 6 skipped (458)
      Tests  8094 passed | 29 skipped (8123)
   Start at  18:17:30
   Duration  203.28s (transform 19.55s, setup 75.81s, collect 171.49s, tests 282.99s, environment 164.52s, prepare 27.45s)
```

V8–V10 release promotion remains on hold. V11 testing remains paused. No release branch or version tag is updated by this source synchronization. Earlier V7 device observations qualify the recorded audit binary; they do not stand in for a new artifact qualification. No paid model validation was repeated.
