# Independent review of the v9 pivot inspector fix

## Spec compliance

**Pass** for the pre-push task at `2e7d4646`, reviewed from `60cbc4f8`. The three affected specs change the shared-update delivery and its import. Their before/after UI, worker, persistence and layout assertions are preserved. The narrower mutation targets the exact dashboard and group seeded at each call site (`e2e/pivot-page-runtime.spec.ts:21`, `e2e/pivot-group-inspection.spec.ts:21`, `e2e/pivot-page-cascade.spec.ts:26`).

## Strengths

- The document owns the external module script. Once it loads, a synchronous evaluation calls a static named import's real Zustand store through a function installed in that page. Script-load and synchronous invocation failures propagate. Each caller installs the helper once, and Playwright's page teardown releases both the script and function. All runtime changes live under `e2e/` (`e2e/fixtures.ts:104`, `e2e/fixtures/pivot-shared-group.ts:4`).
- The Page case still requires a visible R101 update while the override keeps 109 rows, then checks for precisely the R101 row after reset. It also verifies 112 observed members, paging, focus restoration, touch bounds, original source-import count, saved definition and saved dashboard bytes across the existing variants (`e2e/pivot-page-runtime.spec.ts:10–22`). The sibling cascade retains its real-worker rows, chart, source counts and byte-level dashboard check (`e2e/pivot-page-cascade.spec.ts:19–27`).
- The original error points at the evaluation before the next assertion (`original-failure-excerpt.txt:8`). To exclude shell-wrapper status ambiguity I checked Playwright's raw output and last-run records. The original strong control reached R101, the diagnostic weak case retained the old UI and emitted the exact rejection, and the corrected weak-mode case reached R101 with its module request held across GC. All three recorded empty lifetime-event lists (`control.log:13`, `red.log:14`, `red.log:20`, `green.log:13`). The portable account explains the diagnostic export and failed ordinary reproduction attempts (`docs/releases/validation/v9/live-observed-returns/pivot-inspector-flake.md:9–17`).
- Retained runner summaries show 51 browser cases passed across three repetitions with retries disabled and 10,326 unit tests passed with 47 skipped (`matrix.log:68`, `unit.log:18543`). The implementation report records successful typecheck and lint. The review used the existing runs.

## Findings

**Critical and important** — none.

**Minor** — `e2e/pivot-page-cascade.spec.ts:5` has a stray space before the comma in `read ,deliverSharedGroupValue`. Correcting the import spacing is optional polish.

**Existing validation noise** — Knip lists the unused exported `Monitor` type at `src/browser-shim/window.ts:46` (`knip.log:6`). That file is outside the change.

## Declined to judge

- The precise hosted cause, whether the mutation ran on the failed hosted attempt, and the future failure rate. The job retained no original trace, and the diagnostic introduced a thenable export to control the native callback.
- Other asynchronous table, worker, and memfs reads. Their assertions and dependencies are outside the shared-update change.
- New hosted CI, PR publication, and live status of the three PRs. Those belong to the controller's post-review task.

## Assessment

**Code quality approved. Ready to push for hosted CI.** The new delivery path removes the asynchronous import from the failing evaluation, keeps real state and assertions, and introduces no retries, sleeps, timeout changes or skips. No blocking findings.
