# Task 8 implementer report

> Historical implementation-validation record. This report describes the original isolated candidate, which included the unmerged Rust optimization stack. Its 6,709-test result and 7d549040 workflow pin are historical; they do not assert passing parity on the clean release/v4 delivery base. The current delivery workflow pins 2aff39850fa356f31d342e86ee772537cc791d12. Rust qualification still depends on PR #25 and its prerequisites; current delivery checks are reported separately. Required native/server qualification remains INCOMPLETE.

Status: DONE_WITH_CONCERNS. CI/report/checklist implementation complete locally; real release decision remains **INCOMPLETE**, not qualified. Publication belongs to root after whole-branch review. Worktree `/Volumes/Builds/openbq-benchmarks/pivot-test-program-work`, baseline `c3cf728c70874cd7d50fb764d5a328c32dc121fd`.

## Implementation

- Existing CI checks preserved. Added standalone `*.node.mjs` suites, explicit fixed TS/built-WASM parity, linked Chromium smoke separately for TypeScript and Rust, failure seed/trace retention.
- Added dispatch + Monday 06:17 UTC scheduled extended suite: full SHA input validated before checkout, bounded integer seed through environment, exact checkout verification, contents read-only, no persisted checkout credentials, one concurrency group, 45-minute Ubuntu budget, sequential TS/Rust Chromium/WebKit, seven-day artifact retention. TypeScript evidence uploaded before second engine overwrites output. No SEC download, data stress, native-device execution or increased runtime limits.
- Matrix now has 38 stable IDs, mirrored in 47-entry JSON inventory including eight granular native/server-sync items and one refusal-only negative-capability item. IDs represent requirements, not row positions/repeated Spec letters.
- Release reporter consumes inventory and Task7 semantic report API. Per-ID statuses; failed required correctness wins; missing/native/environment/unsupported computation blocks; negative capability needs explicit refusal assertion; performance stays advisory. Every executed attestation has source/commit and allowlisted artifact/dataset/environment identities, named assertion/platform, and actual proof byte SHA256 verification. Unknown IDs, mismatched identities, corrupt evidence and Linux-as-native rejected. Task7 report bytes + schema semantics validated; refused stages remain unavailable.
- Release checklist documents actual native gaps, real server-sync environment gap, partial native observation limits, legacy tick policy reports, admission refusals, default-branch activation prerequisite, candidate pin maintenance, separate Rust and TS publication/dependency review.

## TDD evidence

Initial missing module run reported ERR_MODULE_NOT_FOUND; this was scaffolding, not counted as behavioral RED. Added trivial exported reporter scaffold, then ran `node --test scripts/pivot-qualification/release-report.node.mjs`: 1 passed, 9 failed. Expected failures included missing native evidence returning QUALIFIED instead of INCOMPLETE, failed correctness returning QUALIFIED instead of FAILED, missing proof/identity rejection. Implemented the gate: 10/10 passed.

Self-review added a regression for negative-capability `status: passed` without `refusalAssertion`: RED `QUALIFIED` versus expected `INCOMPLETE` (saved `/tmp/task8-refusal-red.log`), then corrected the predicate. GREEN standalone final suite 44/44, including Task7 semantic consumption/refused timing test.

## Verification commands and results

Commands run from the worktree; outputs remain external under `/tmp` (not product/native qualification evidence).

1. `node --test scripts/pivot-qualification/*.node.mjs` → 44 tests, 44 pass, 0 fail, 0 skipped, duration 1215ms. `/tmp/task8-node.log`. Includes verifier, child-process deadline/journal, tick policy, Task7 reports and 12 release-report tests.
2. `pnpm exec vitest run src/lib/tableExecution/qualificationParity.test.ts` → 38/38 passed, 1 file, 2.01s. `/tmp/task8-parity.log`.
3. `pnpm test:run` → 368 files passed / 2 skipped; 6709 tests passed / 7 skipped; 0 failures; 93.49s. `/tmp/task8-full.log`. Existing React act warnings appeared; output is not pristine. No failures omitted.
4. `PIVOT_TRACE_EXTENDED=1 PIVOT_TRACE_SEED=20261103 pnpm exec vitest run src/lib/tableExecution/qualificationParity.test.ts` → 219/219 passed, 1 file, 36.18s; user seed recorded. `/tmp/task8-extended.log`.
5. `pnpm exec playwright test --config playwright.qualification.config.ts --project chromium --grep 'company switch, row checkboxes'` → 1 passed, 10.1s. `/tmp/task8-smoke.log`.
6. `VITE_TABLE_ENGINE=rust pnpm exec playwright test --config playwright.qualification.config.ts --project chromium --grep 'company switch, row checkboxes'` → 1 passed, 12.0s. `/tmp/task8-smoke-rust.log`. Both smoke runs emit existing NO_COLOR/FORCE_COLOR warnings. Runtime asserts actual requested engine. Browser output `e2e-results/qualification/` is ignored and was overwritten by second engine as expected locally.
7. `pnpm exec playwright test --config playwright.qualification.config.ts --list` → 18 tests / 2 files across Chromium/WebKit. `/tmp/task8-browser-list.log`. Discovery only; not a full browser execution claim.
8. Python existing PyYAML BaseLoader validation of both workflow files → parsed workflow triggers/jobs/steps, every step has run/uses, contents read-only, no raw `${{ inputs.* }}` expressions in shell. CI 5 jobs; extended 1 job. Regex/JSON inventory cross-check → 38 matrix IDs / 47 unique inventory IDs, every matrix ID in inventory. `actionlint` is not installed; hosted Actions were not executed locally.
9. `node --check scripts/pivot-qualification/release-report.mjs` → exit 0. `git diff --check` → exit 0.
10. Synthetic CLI dry-run driver wrote explicit SYNTHETIC proofs/bundles to `/tmp/task8-release-dryrun/`, invoking `node scripts/pivot-qualification/release-report.mjs <case>.json` for each case and asserting return code: missing → INCOMPLETE exit 2; failed → FAILED exit 1; environment → INCOMPLETE exit 2; slowdown → QUALIFIED exit 0. Input and output JSON preserved in that directory. All SHA256 proof bytes checked by the real reporter. These are gate behavior fixtures only, never actual release evidence.

No builds, benchmark/profile execution, native UI changes, pushes, merges, new dependencies or resource-limit increases were performed. Existing generated WASM artifacts were used for local parity/browser verification; root owns broader final build/artifact review.

## Files

`.github/workflows/ci.yml`, `.github/workflows/pivot-qualification.yml`, `scripts/pivot-qualification/release-report.mjs`, `scripts/pivot-qualification/release-report.node.mjs`, `docs/testing/pivot-qualification-matrix.md`, `docs/testing/pivot-requirements.json`, `docs/testing/pivot-release-qualification.md`, and this report.

## Self-review and concerns

Fixed refusal-only passed-label loophole with RED/GREEN regression. Preserved all existing CI jobs/checks and standalone `.node.mjs` convention. Evidence attestation review remains necessary: checksums bind bytes and candidate identity but cannot establish whether arbitrary proof prose actually demonstrates an assertion. Broad matrix items require review of complete engine/assertion coverage before passing.

Required native worker recovery, exact revision chain, native UI import/export and remaining platform/input evidence remain unrun; real server-sync `.env` unavailable. Actual private native observations not committed. Other OS remain unqualified without blocking a specifically scoped macOS target. Performance refuses/slowdowns do not erase these gaps. No release-qualified claim.

Schedule/dispatch cannot be claimed active from this branch. Default-branch workflow presence/initial activation prerequisite documented using official GitHub docs verified by root 2026-11-03. The scheduled pin is advanced to the local Task8 implementation commit `7d54904054cb840bf4b11a655ad68f9ab37b2e6b` in the follow-up; final candidate changes require an intentional reviewed bump.

Inherited open Rust optimization stack (`25e858d619`) remains a publication dependency: root must prevent inherited production commits from accidentally appearing in the final TS/test-infrastructure PR. Task8 contains no Rust/TS production fixes.

## Final follow-up verification

`pnpm exec eslint scripts/pivot-qualification/release-report.mjs scripts/pivot-qualification/release-report.node.mjs` → exit 0, no output. Workflow pin follow-up points to `7d54904054cb840bf4b11a655ad68f9ab37b2e6b`, which contains Task8 scripts/tests. Python BaseLoader parse and full 40-hex SHA comparison to the existing implementation commit passed; docs match. `git diff --check` passed. No broad test repeat for metadata-only pin change.
