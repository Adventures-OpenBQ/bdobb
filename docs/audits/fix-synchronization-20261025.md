<!-- Copyright 2026 SecretoftheUniverse.com LLC. SPDX-License-Identifier: AGPL-3.0-only -->

# Fix synchronization on 25 October 2026

This record tracks the version 9.0.0 source synchronization and the subsequently authorized V9 release-branch integration. No version tag is published by this integration.

- Public base: `82197988230bd323400240b4c86334e0c1fd84d4`.
- Original audit source: `a350975375076a764ead59f61d4b5582208f9ae9`.
- Validation: fresh native unit suite, typecheck and lint passed on the combined tree. The full test summary follows.

```text
 Test Files  477 passed | 6 skipped (483)
      Tests  8579 passed | 31 skipped (8610)
   Start at  18:20:58
   Duration  172.78s (transform 13.29s, setup 63.89s, collect 135.05s, tests 239.27s, environment 145.50s, prepare 24.74s)
```

Reconciliation: Adjusted patch license-header context to public AGPL; retained public licensing metadata.

At the original source-synchronization checkpoint, V8–V10 release promotion remained on hold and V11 testing remained paused. That source synchronization updated no release branch or version tag. Earlier V7 device observations qualified only the recorded audit binary.

## V9 release integration approved on 25 October 2026

The user authorized merging the verified V9 fixes into `release/v9`. The candidate `586e155e2effc7dedcfae4f77ed4e7faa20df53f` includes the current V9 release layout changes, inherited V8 named-tab and safe-area corrections, Rita aggregation/override-intent fixes, and explicit dashboard placement context for shared cards. The subsequent commit updates this audit record only.

A fresh full suite on the integration candidate passed 8,586 tests, with 31 skipped (477 test files passed, 6 skipped). Earlier qualification on application source `9ba9006fbd1c131c20f6650a800e0fd06a713d31` also passed typecheck/lint, 40 affected browser fixtures, signed Mac/iPad builds, and native table/dock/Files/cold-launch/two-way-sync checks. The later test-header correction and this record do not change application code.

Qwen passed 19/19. Claude previously passed 18/19; after the dashboard-context correction, the explicitly authorized targeted Clock-removal check passed 1/1, with the other 18 cases intentionally excluded. This is not a new full Claude cycle. DeepSeek was gateway-blocked (HTTP402). No model API calls were made for the release merge. Physical pinch was human-verified on V8; no new V9 pinch result is claimed. The isolated backend required an 8GiB allowance after a 4GiB audit OOM; no 4GiB runtime envelope is claimed.

V10 remains on hold and V11 remains paused. Only the V9 release branch is authorized for this integration; existing version tags remain unchanged.
