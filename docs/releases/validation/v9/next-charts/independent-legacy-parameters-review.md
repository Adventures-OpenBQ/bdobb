# Legacy linked chart Parameters review

## Spec compliance

- ✅ Spec compliant for `5c64d55d..fcb11da8`. Each of the seven authoring sites clicks the exact **Show parameters** button on the card containing the chart body, then uses that card’s exact **Parameters** region for Category and measure selection. The Playwright actions enforce strict matching, so an ambiguous card or control would fail the test.
- `e2e/table-final-review.spec.ts:17` preserves the region category, Count and Unique Count measures, and both numeric Plotly traces.
- `e2e/table-execution.spec.ts:54`, `:140`, `:343` and `:379` preserve duplicate measure selection, the two compact XLS themes and acquisition checks, the filtered report ratio, and the selected source and 1,200-point library chart. Plotly checks continue to run through the chart body.
- `e2e/statement-model.spec.ts:97` and `:246` preserve the wide and long XLS and CSV chart path and the formatted XLS ratio chart. The numeric `40` and `0.4` trace expectations retain their chart-body scope.
- The controller diff changes these three specs and appends the release verification note at `docs/releases/validation/v9/next-charts/verification.md:230`. All replaced lines are Category or measure locator calls. The diff preserves source setup, values, table projections, worker and request instrumentation, reopen and chart-body checks, and timeout, retry and skip policy. It contains no production or global setup changes.
- ⚠️ Raw typecheck, lint, scrub, header and diff-check output was unavailable in the supplied evidence. The implementer report records successful exits and clean checks. Remote CI for the amended head remains pending, as recorded in the release note.

## Strengths and verification

- The exact card, button and region locators drive the existing UI. The short setup at each site makes its state transition explicit and keeps the legacy specs independent of chart example fixtures.
- `/tmp/v9-parameters-legacy-red.log` records one Chromium failure with exit 1 at the original `e2e/table-final-review.spec.ts:17:55`. The old chart-body Category locator timed out at 30,000 ms. The failure snapshot shows the linked chart’s collapsed **Show parameters** button and its prompt to choose chart fields.
- `/tmp/v9-parameters-legacy-green.log` records 21 Chromium passes in 47.1 seconds across all three specs, with one worker, zero retries and zero skips. The original failing case passed in 839 ms. The implementer report identifies the default TypeScript engine, fresh ports and `PIVOT_WASM_VERIFY_ONLY=1`. The browser logs contain no warnings.
- Running the read-only `shasum -a 256 -c /tmp/v9-parameters-recovery-sha.txt` from the client worktree confirmed all six recovery files still match their recorded hashes. The browser suites were reviewed through their recorded output.

## Issues

- Critical 0
- Important 0
- Minor 0

## Assessment

**Task quality approved.** The scoped test changes exercise the Parameters UI and keep every existing assertion in the review diff. The recorded browser run resolves the reproduced locator failure.
