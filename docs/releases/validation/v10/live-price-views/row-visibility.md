# V10 refused-source row visibility

The stacked review at `3808e73e` identified a Minor coverage gap: the three synthetic refusal cases checked the source table's column header, which could remain visible without data cells. The correction starts from published head `4048adb9` and adds one assertion to `e2e/live-price-views.spec.ts`: the source card must contain a visible `AAPL.US` data cell. The existing header, chart refusal, missing-plot, disabled-Apply and exact acquisition-query assertions remain unchanged.

This checks a representative rendered listing cell in each refusal case: ordinary rows, opted-in rows without a receipt, and an opted-in legacy snapshot. It does not require all 58 rows to render in a virtualized table. The existing dual-executor tests continue to verify the complete retained row count. No production code, payload, dependency, timeout, retry or skip setting changes.

## Controlled coverage proof

On Chromium with the TypeScript engine, a temporary diagnostic set only the real source table body's CSS visibility to hidden, preserving its header and real store/worker data. All three original cases still passed. With the new data-cell assertion and the same diagnostic, all three failed specifically because the `AAPL.US` cell was unavailable to the visibility assertion. The preceding header assertion still passed. This is a deliberate rendering mutation that demonstrates the former coverage gap, not a reported product failure.

The diagnostic was removed before qualification and is absent from the committed executable test. With ordinary rendering, all three affected cases passed on Chromium 151.0.7922.34 and WebKit 26.5, using both TypeScript and compiled Rust: **12 passed, no skips, no retries**. Every Rust case recorded successful WASM delivery; every TypeScript case recorded zero WASM responses.

## Local evidence

The plan-specific evidence directory is `.superpowers/sdd/2026-11-21-v10-row-visibility/` relative to the client worktree. It preserves the original spec, diagnostic patch, three-case old-test control log, three-case RED log with traces/screenshots, and final engine-specific logs/JSON runtime attachments. The recorded runs used a local wrapper of `playwright.live-price-views.config.ts`, restricted to `live-price-views.spec.ts`, fresh servers and zero retries. These equivalent commands use the checked-in configuration and an explicit file filter, so they work without the ignored evidence wrapper.

```sh
BDOBB_BROWSER_PORT=18841 BDOBB_MOCK_PORT=18842 VITE_TABLE_ENGINE=typescript PIVOT_WASM_VERIFY_ONLY=1 \
  pnpm exec playwright test --config playwright.live-price-views.config.ts e2e/live-price-views.spec.ts \
  --grep 'synthetic transport: refuses' --retries=0
BDOBB_BROWSER_PORT=18843 BDOBB_MOCK_PORT=18844 VITE_TABLE_ENGINE=rust PIVOT_WASM_VERIFY_ONLY=1 \
  pnpm exec playwright test --config playwright.live-price-views.config.ts e2e/live-price-views.spec.ts \
  --grep 'synthetic transport: refuses' --retries=0
```

The client unit suite passed **10,387 tests, with 47 existing optional skips**. This remains synthetic/browser qualification and inherited installed replay evidence; it establishes no fresh vendor acquisition or image build. All four PRs must remain unmerged. Typecheck, lint and scrub/header checks passed. [Independent review](independent-row-visibility-review.md) approved the correction and portable-command follow-up at `66540fc4`, with all findings closed. Exact published-head CI is recorded in the PR follow-up.
