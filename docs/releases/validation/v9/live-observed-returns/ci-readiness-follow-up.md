# Hosted CI risk/exposure readiness follow-up

The prior current-head browser job passed with one retry, so it is retained as a pass-with-flake rather than a clean pass. This record preserves the controlled investigation and independent reviews. Local diagnostic commands below require the archived ignored probes; the ordinary focused suite commands run against the committed test. Raw artifact references identify local retained evidence.


## Investigation and validation

# Risk and exposure workspace reacquisition in CI

The Chromium test failed on its first attempt in [CI run 44856895677, job 136701165462](https://github.com/Adventures-OpenBQ/bdobb/actions/runs/44856895677/job/136701165462) at client commit `4509fde695f0f52db137625406098d8804aa6ee2`. The reopened **Return distribution** card did not attach `svg.main-svg` within 5,000 ms at `ready(reopened)`. The original attempt took 32.6 s. The retry passed in 19.0 s. The browser job finished with 419 passed, 1 flaky and 8 skipped. The workflow uploads its report only on a failed job, and the artifact API returned zero for this run. The hosted screenshots, trace and intermediate page state are unavailable. Hosted output (`ci-updated-e2e.log`), artifact API response (`ci-flake-evidence/hosted-artifacts.json`).

## What the browser evidence shows

`importRisk` installs the fixture routes, imports the workspace, waits for the tab to be visible and parks the pointer outside the rail. It can return while the linked cards are still working. The table runtime binds the imported source cards, acquires their data, waits for the table worker to publish the source revision and reads `chartData`. The chart recipe worker uses that snapshot to produce its result. `ChartRenderer` mounts the drawable surface as `data-testid="chart-plot"` after a successful drawable result. Its effect then hands the surface to Plotly, which attaches `svg.main-svg`. The original helper started the five-second SVG clock as soon as the tab and rail were ready, so that assertion also imposed a five-second deadline on unfinished acquisition and worker startup.

The exact unmodified test passed 5/5 in local Chromium with retries off. When the reopened page's renderer ran at 8× CPU slowdown, both runs still passed. In those runs, `importRisk` returned before the recipe result mounted the chart surface. Return distribution acquired its SVG 1.50–1.53 s after the import helper returned. A blanket 20× slowdown failed earlier on the rail collapse assertion and supplies no evidence for the hosted SVG failure. Unmodified baseline (`ci-flake-evidence/baseline.log`), 8× diagnostic (`ci-flake-evidence/cpu8.log`), 20× diagnostic (`ci-flake-evidence/cpu20.log`).

For the controlled replay, a Playwright route deferred only the reopened page's real `recipe.worker.ts` module loads until 6.25 s after `importRisk` returned. The first page, workspace export/import, four source payloads, table worker, recipe worker code and Plotly all remained real. The probe logs requests, worker jobs and replies, card states, and surface and SVG attachment. It waits briefly for the SVG after capturing the original failure and rethrows that failure. This delay is part of the local diagnostic only.

| Milestone | RED time relative to reopened-page instrumentation |
| --- | ---: |
| Table workers returned `chartData` | 1.116 s |
| `importRisk` returned and four source names were recorded | 1.262 s |
| Original SVG assertion failed while cards said “Calculating chart…” | 6.274 s |
| The real worker entry requests were released | 7.513 s |
| Return distribution's SVG attached after real recipe reply | 7.740 s |
| The diagnostic confirmed attachment on the same page | 8.077 s |

The controlled failure had the same locator, 5,000 ms timeout and call site as the hosted log. It verifies that the test could reject a valid asynchronous reacquisition and then observe the expected chart on that same page. The hosted log cannot establish whether the actual runner was delayed in this worker stage, source acquisition, rendering, or encountered a different problem with the same symptom. Controlled RED log and trace (`ci-flake-evidence/controlled-red.log`).

## Change and validation

The shared `ready` helper in `e2e/risk-exposure.spec.ts` now waits for each existing drawable chart surface under the spec's existing 90 s test deadline. It then requires the same Plotly SVG inside the card with the same five-second assertion. With the same controlled module gate and retries off, the replay passed 2/2. Its SVG mounted 6.44–6.55 s after import, beyond the old assertion window. The replay still checks all four acquired source names, seven histogram bins, seven returns, the changed first region weight of `0.18`, and the absent plot after source removal. The affected suite also retains its explicit plot-absence assertion when paged data is refused. Controlled GREEN log and traces (`ci-flake-evidence/controlled-green.log`).

The production app, workflow configuration and global timeouts are outside the single spec diff. The existing helper still requires a drawable surface and an attached SVG for every expected chart. If acquisition or the recipe never yields a drawable, the failure comes from the existing test deadline. That early-stage diagnostic may take longer than the old SVG failure. The renderer still gets its original five-second assertion once the surface appears.

## Replay commands

Run from the client worktree. The diagnostic copies are under the ignored evidence directory because their instrumentation deliberately stalls the real worker module. The only difference between the two copies is the change to `ready`. The replay uses separate output locations to preserve the recorded evidence.

~~~sh
evidence=.superpowers/pr-ci-review-2026-11-20/ci-flake-evidence
probe=e2e/risk-reacquire-probe.spec.ts
cp "$evidence/probe-original.ts" "$probe"
BDOBB_BROWSER_PORT=19541 BDOBB_MOCK_PORT=19542 RISK_PROBE_GATE_WORKER=1 \
  pnpm exec playwright test "$probe" -g 'reacquires a saved workspace' \
  --retries=0 --reporter=list --trace=on --output="$evidence/replay-red" \
  > "$evidence/replay-red.log" 2>&1
# Expected exit 1 with the original 5,000 ms SVG assertion.
cp "$evidence/probe-fixed.ts" "$probe"
BDOBB_BROWSER_PORT=19541 BDOBB_MOCK_PORT=19542 RISK_PROBE_GATE_WORKER=1 \
  pnpm exec playwright test "$probe" -g 'reacquires a saved workspace' \
  --retries=0 --repeat-each=2 --reporter=list --trace=on --output="$evidence/replay-green" \
  > "$evidence/replay-green.log" 2>&1
# Expected exit 0, 2 passed.
rm "$probe"
~~~

The baseline ran the committed spec at the original head on the same ports with `--retries=0 --repeat-each=5 -g 'reacquires a saved workspace' --reporter=list --trace=on --output="$evidence/baseline"`. The CPU diagnostic used the original probe on the same ports and `RISK_PROBE_CPU_RATE=8` with `--repeat-each=2` or `RISK_PROBE_CPU_RATE=20` with one attempt, with the worker gate unset.

~~~sh
BDOBB_BROWSER_PORT=19541 BDOBB_MOCK_PORT=19542 \
  pnpm exec playwright test e2e/risk-exposure.spec.ts \
  --retries=0 --reporter=list --trace=on --output="$evidence/chromium"
BDOBB_BROWSER_PORT=19543 BDOBB_MOCK_PORT=19544 \
  pnpm exec playwright test --config="$evidence/playwright.webkit.config.ts" \
  e2e/risk-exposure.spec.ts -g 'reacquires a saved workspace' \
  --retries=0 --reporter=list --trace=on --output="$evidence/webkit"
~~~

- Chromium 151.0.7922.34 on arm64 macOS, Playwright 1.62.1. The full risk/exposure spec passed 5/5 with no retries. Output (`ci-flake-evidence/chromium.log`).
- WebKit 26.5 on arm64 macOS. The reopened-workspace test passed 1/1 with no retries. Output (`ci-flake-evidence/webkit.log`).
- `pnpm typecheck`, `pnpm lint`, `pnpm knip`, `pnpm scrub`, and `git diff --check` exited zero. Knip reports the preexisting unused `Monitor` type in `src/browser-shim/window.ts`. Typecheck (`ci-flake-evidence/typecheck.log`), lint (`ci-flake-evidence/lint.log`), Knip (`ci-flake-evidence/knip.log`), scrub (`ci-flake-evidence/scrub.log`).
- The hosted build completed Vitest with 10,275 passed and 47 skipped at the original commit. The change is confined to Playwright and all source files are identical to that commit. Hosted build log (`ci-updated-build.log`).

Client commit `e5ccf3767f3b7188d5d158f96718b3bedfe29f86` changes one file. The local worktree is clean. The controlled harness failure is addressed, and qualification on the hosted runner is pending.


## Superpowers independent scoped review

# Independent scoped review of risk/exposure chart readiness

**Approved for the next hosted CI run.** Compared client `4509fde695f0f52db137625406098d8804aa6ee2` with `e5ccf3767f3b7188d5d158f96718b3bedfe29f86`. The sole changed file is `e2e/risk-exposure.spec.ts`. No Critical, Important, or Minor findings.

**Original five-second readiness failure: ADDRESSED in the controlled reproduction.** The four named risk/exposure cards obtain their figures asynchronously. An accepted nonempty figure reaches `ChartRenderer` from `LinkedChartRenderer.tsx:592`; the drawable test surface is attached before the Plotly effect performs the draw. The revised helper waits for that card-specific surface under the test's existing 90-second deadline, then checks the same Plotly SVG using the original five-second assertion. A surface without an SVG fails. A refusal or an acquisition that never completes also fails, although it can now use the remaining test time before reporting the missing surface. See `e2e/risk-exposure.spec.ts:21`, `:24` and `src/components/renderers/ChartRenderer.tsx:277`.

The fresh-page test still verifies the four reacquired sources, the saved seven-bin question, seven actual returns, the rebound region axis value of 0.18, and the loss of the chart on source removal. Paged-source refusal and plot absence remain explicit. The change adds no retry, sleep or fixture substitute and changes no product behavior or numerical assertion. See `e2e/risk-exposure.spec.ts:197` and `:216`.

I compared the two locally instrumented probe sources. Their only difference is the committed helper change. The controlled RED log shows the table workers completed, the old five-second SVG assertion failed while the recipe was calculating, and the chart subsequently drew on the same page after releasing the real worker modules. The same gate passed twice with the fix. The recorded ungated Chromium suite passed 5/5, and WebKit's focused reacquisition passed 1/1, with retries off. I inspected the existing logs and traces' recorded milestones; I did not repeat the suites. Controlled failure (`ci-flake-evidence/controlled-red.log`) · Controlled passes (`ci-flake-evidence/controlled-green.log`) · Chromium (`ci-flake-evidence/chromium.log`) · WebKit (`ci-flake-evidence/webkit.log`)

**Evidence limit.** Hosted run 44856895677 recorded the missing SVG on the first attempt and a successful retry. Its artifact response contains no trace or screenshot. The controlled experiment demonstrates a mechanism for the symptom. The specific cause on the hosted runner is still unknown, and the corrected head still needs hosted CI. Hosted artifact response (`ci-flake-evidence/hosted-artifacts.json`)


## Ponytail full scoped review

# Ponytail full review of the workspace-reopen CI fix

Lean already. Ship.

Client PR #89, `4509fde6..e5ccf376`, changes only `e2e/risk-exposure.spec.ts` (+5/−1). The shared `ready` helper waits for the card’s existing drawable `chart-plot` element under the 90-second test deadline. The placeholder lacks that test ID. Once the drawable mounts, the original five-second SVG assertion still checks Plotly rendering. Removing the added wait would put acquisition and worker startup back on that rendering deadline. A missing drawable can consequently take longer to report.

I inspected the helper, renderer and recorded run logs. With the real worker module held, the old assertion expired while the card was calculating. The patched test passed both controlled runs. The ordinary Chromium spec passed 5/5 and the WebKit reopen test passed 1/1 with retries disabled. The hosted first-attempt failure lacks a trace, so its exact cause remains unconfirmed. CI reproduction and verification (`ci-flake-report.md`)
