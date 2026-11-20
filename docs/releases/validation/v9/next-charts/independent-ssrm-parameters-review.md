# SSRM Parameters review

## Spec compliance

- ✅ Spec compliant for `fcb11da8..ae479397`. Both specs locate the card containing the new linked chart renderer, click its exact **Show parameters** button and select Category and the original measure inside its exact **Parameters** region. The scoped locators use Playwright's strict matching and normal click action. The diff contains these two test hunks and the release verification update. `e2e/ssrm-parity.spec.ts:51`, `e2e/ssrm-widget.spec.ts:48`, `docs/releases/validation/v9/next-charts/verification.md:236`.
- ⚠️ The full amended-head browser gate remains pending. The native browser evidence covers the identified prebuilt Linux arm64 binaries and the gateway files matching Docker `a0efab23`. The amended-head native rebuild is outside the scope of this evidence. `docs/releases/validation/v9/next-charts/verification.md:242`, `ssrm-native-identity.log:1`, `ssrm-native-identity-postrun.log:1`.

## Strengths

- Both failures waited for the same Category role while their new linked chart showed the collapsed chevron. The 411-test baseline found 402 passed, eight opt-in skips and one failure in 10.0 minutes. The authenticated native baseline reached linked chart creation and hit its 120-second timeout. `full-browser-run.log:423`, `full-browser-run.log:453`, `full-browser-run.log:36`, `full-browser-run.log:276`, `ssrm-native-red.log:14`.
- The locator changes preserve the 204 and 1,204 Plotly point counts, solver preview and native export through refresh. The two hunks end inside the test bodies, so I checked the surrounding fixture and later assertions for coverage-loss risk. The default case loads the actual Rust WASM runtime and retains acquisition, projection, export, saved source and linked reopen checks. The native case signs in to the harness and uploads 1,205 rows. Its persisted reopen counts, cross-principal 404, 512 MiB address-space limit and non-root check remain in place. The baseline-byte reversal record corroborates the complete assertion preservation. `e2e/ssrm-parity.spec.ts:22`, `src/lib/tableExecution/rust/runtime.ts:15`, `e2e/ssrm-parity.spec.ts:57`, `e2e/ssrm-parity.spec.ts:64`, `e2e/ssrm-parity.spec.ts:76`, `e2e/ssrm-parity.spec.ts:78`, `e2e/ssrm-widget.spec.ts:8`, `e2e/ssrm-widget.spec.ts:14`, `e2e/ssrm-widget.spec.ts:43`, `e2e/ssrm-widget.spec.ts:53`, `e2e/ssrm-widget.spec.ts:63`, `e2e/ssrm-widget.spec.ts:71`, `e2e/ssrm-widget.spec.ts:73`, `ssrm-spec-reversal.log:1`.
- The skip, timeout and retry policy is preserved. The focused config check confirms the default entry point excludes the native widget and the separate entry point runs Chromium and WebKit with a 120-second timeout. The recorded focused commands used one worker and zero retries. Default Chromium passed 2/2 in 4.7 seconds, including the unchanged LIVE refusal, and native Chromium and WebKit passed 2/2 in 18.6 seconds. Both focused passing runs recorded zero skips and clean output. `playwright.config.ts:15`, `playwright.ssrm.config.ts:4`, `ssrm-default-parity.log:3`, `ssrm-default-parity.log:8`, `ssrm-native-green.log:3`, `ssrm-native-green.log:8`.
- The recorded mount inspection confirms read-only external and checkout mounts with writable private task state. The post-run hash checks matched all seven identified files. The evidence summary reports cleanup for all three containers and 85 successful requests plus one 404 for each native browser. Typecheck, lint, scrub, header and both diff checks recorded exit 0. `ssrm-native-red-mounts.log:1`, `ssrm-native-identity-postrun.log:1`, `ssrm-native-evidence-summary.log:1`, `ssrm-types.log:6`, `ssrm-lint.log:6`, `ssrm-scrub.log:5`, `ssrm-diff-check.log:1`.

## Issues

### Critical

None.

### Important

None.

### Minor

- The native baseline emitted a Vite dependency reoptimization notice. The release notes record it, and the failure trace still identifies the Category locator after chart creation. The focused passing logs are clean. `ssrm-native-red.log:8`, `ssrm-native-red.log:18`, `docs/releases/validation/v9/next-charts/verification.md:238`.

## Assessment

**Task quality — Approved.** The adjustment follows the existing authoring interaction and restores both cases with their original coverage and execution policies.
