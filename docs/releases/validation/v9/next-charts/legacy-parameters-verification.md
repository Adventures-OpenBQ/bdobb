# Legacy linked chart Parameters browser tests

Baseline `5c64d55d2ed5de2832a7119e4cd7ddb160704c9f`. The Parameters implementation in `caf36e08` mounts Category and Measures through `LinkedParametersPortal` in the card's Parameters region. New linked charts have the panel collapsed. The former chart-body locator cannot resolve the portalled field. The failing browser snapshot contains the newly created chart, its **Show parameters** button, and the body message asking the user to choose chart fields.

Seven authoring sites across the three specs now find the card containing the chart body, click the exact **Show parameters** button and query the exact **Parameters** region on that card. The chart-body locator still scopes the original Plotly and chart status checks.

## Reproduction and verification

Run from the client worktree. Both browser commands used Playwright Chromium on macOS with the default TypeScript table engine, a single worker, zero retries and separate unused app and mock ports. The checkout already contained the compiled WASM artifacts.

```sh
env -u NO_COLOR FORCE_COLOR=0 PIVOT_WASM_VERIFY_ONLY=1 \
  BDOBB_BROWSER_PORT=4703 BDOBB_MOCK_PORT=4704 \
  pnpm e2e e2e/table-final-review.spec.ts --project=chromium --workers=1 \
  --retries=0 --reporter=list --output=/tmp/v9-parameters-legacy-red \
  -g 'ordinary text counts reach actual worker linked chart as numeric measures'

env -u NO_COLOR FORCE_COLOR=0 PIVOT_WASM_VERIFY_ONLY=1 \
  BDOBB_BROWSER_PORT=4705 BDOBB_MOCK_PORT=4706 \
  pnpm e2e e2e/table-final-review.spec.ts e2e/table-execution.spec.ts \
  e2e/statement-model.spec.ts --project=chromium --workers=1 --retries=0 \
  --reporter=list --output=/tmp/v9-parameters-legacy-green

pnpm typecheck
pnpm lint
pnpm scrub
git diff --check
git diff --cached --check
shasum -a 256 -c /tmp/v9-parameters-recovery-sha.txt
```

- On baseline, exit 1 with one failed case. The original `table-final-review.spec.ts:17:55` selection timed out at 30,000 ms waiting for `locator('.linked-chart-renderer').getByLabel('Category', { exact: true })`. The output, screenshot, error context and trace are in `/tmp/v9-parameters-legacy-red.log` and `/tmp/v9-parameters-legacy-red/`.
- With the locator correction, exit 0 with **21 passed (47.1s)** and zero skips. The original failing case passed in 839 ms. Full output is in `/tmp/v9-parameters-legacy-green.log` and artifacts are in `/tmp/v9-parameters-legacy-green/`.
- Typecheck, lint and both diff checks exited 0. Scrub and header checks reported clean.
- The six external-catalog recovery files matched their pre-edit SHA-256 values.

| Spec | Cases passed | Changed chart authoring coverage |
| --- | ---: | --- |
| `table-final-review` | 3 | Ordinary Count and Unique Count numeric measures and Plotly trace values |
| `table-execution` | 8 | Duplicate measure instances and reopen, XLS linked subset in both compact themes, Year/Quarter filtered ratio, and full 1,200-row library source selection |
| `statement-model` | 10 | Wide and long XLS and CSV profit charts and reopen, wide XLS source failure and recovery with a changed value, and numeric XLS ratio projection |

## Self-review

Reversing the three new card/panel lines per authoring site and the selection locator changes produces all three baseline specs byte for byte. This confirms that source setup, request instrumentation, existing expected data, body locators, and timeout and skip policy were preserved. The test sites repeat the same three explicit control steps, keeping the legacy tests independent of the chart recipe fixture that loads the examples at import time. The staged diff contains the three specs and the durable verification note. The changes exercise the existing UI with the default engine. Independent review and remote CI confirmation remain pending.

Committed as `fcb11da8e746464d6f83e19ac47a0e21d44c2230`, a direct child of the baseline. The tracked worktree is clean. The six recovery files also passed their SHA-256 comparison after the commit.

## Full default Chromium sweep at fcb11da8

Discovery found **411 tests in 89 files**. This single sweep covered the standard Playwright configuration with the default table engine, one worker, zero retries and fresh local ports. Head and tracked status were recorded before the run.

```sh
release_followup_dir=.superpowers/v9-release-followup-2026-11-20
env -u NO_COLOR FORCE_COLOR=0 pnpm e2e --project=chromium --list
env -u NO_COLOR FORCE_COLOR=0 PIVOT_WASM_VERIFY_ONLY=1 \
  BDOBB_BROWSER_PORT=4707 BDOBB_MOCK_PORT=4708 \
  PLAYWRIGHT_HTML_OUTPUT_DIR="$release_followup_dir/full-browser-html" \
  pnpm e2e --project=chromium --workers=1 --retries=0 \
  --output="$release_followup_dir/full-browser-results"
```

The run exited 1 after **402 passed, 8 skipped, 1 failed (10.0m)**. Seven pre-existing opt-in dashboard sync cases and the opt-in reference acceptance case skipped. All 21 tests from the three migrated specs passed. The sole failure was the managed full-scope case in `ssrm-parity.spec.ts`. The real compiled Rust fixture reached chart creation and timed out at line 51 waiting for the page's Category combobox. Its recorded chart card has a collapsed **Show parameters** control and the choose-fields message. No port-related failure appeared.

The complete run, exact discovery list and exit code are in `full-browser-run.log`, `full-browser-discovery.log` and `full-browser-exit.txt`. `full-browser-html/` holds the HTML report. `full-browser-results/ssrm-parity-managed-full-s-8697d-and-persisted-linked-reopen-chromium/` holds the failure screenshot, DOM context and trace. The run log SHA-256 is `eccedd86648ffa52b4074b08e6748d10439327e4eaeb465f5c3a89bf7f88e279`. The tracked tree was clean when Playwright exited.
