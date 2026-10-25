# Local v4 PR integration ledger

Isolated branch: codex/clean-v4-integration. Original bdobb-clean working tree retained unchanged. Original candidate matches copy snapshot c7f59d129055f38d2594c7c9c83c479ec9c9172e. Corrected qualified v3 is merged into ancestry as 03fa7617c21dc9ab2d9718c85efcfba416a4910a; v3 tag is not being moved again.

Frozen approved source: PR344 0340c6f8f5d1e0157f8577a7af139ba43d2985a8 on base 0bc3e7a42155ec4b0e413b5d0e8302ef6205289c; PR345 14357123e06362d1173c5b8b850e695ba4511e3b on PR344. Both were open at inspection. Source-only three-way port preserves original copyrights and author attribution without importing donor Git history. PR authors: Art Cashin; inherited donor contributors remain credited in provenance.

Baseline LocalTableRenderer.execution.test.tsx: 31/31 passed locally before PR application. This does not qualify PR345's changes.

Ruling: retain the clean line's versioned compatible-app envelopes and portable identities rather than introduce PR344's direct, unversioned ownerId/analytical fields into plain Workspace exports. Carry Statement schema 2 through the v4 compatible profile; unknown snapshots remain inspectable in native persistence and are refused by portable export. Preserve accessor/cycle refusal and remapping coverage. Cost: donor apps tests require adapting to the clean line's already-established explicit export contract.

Ruling: PR345's user-approved raw-table Arrange footer supersedes the earlier withheld standalone activation-button experiment. Port its final control placement; do not retain the obsolete hidden-control constant in LocalTableRenderer.

Pending: resolve shared source contracts, apply PR345, restore Keys/Calendar baseline omissions, qualify changed execution tests, unit/browser/reference/native gates, user Help/reference updates and final whole-branch review. No push, remote repository, rename or final v4/v5 tag.

The first post-PR execution-file run failed 19 cases: outdated legacy Arrange selectors failed early and leaked unreleased spies into subsequent tests. Isolated activation itself succeeded but the following old Pivot click closed the drawer that #345 had already opened. Updated tests use the actual four-list chooser and new menu labels, retain durable save/rollback/unmount assertions, and assert canonical definitions while retaining legacy intent. Column-only canonical reports have valid empty delivery and pinned aggregates, so that case expects empty rather than ready. Current repaired file reached 37/39; final two fixture changes are under broader owning verification. The original statement portable tests failed on schema 2; explicit validated support was added, preserving known-schema refusal. Four Calendar/Keys regressions observed RED before restore.

Changed LocalTableRenderer.execution.test.tsx now passes all 39 tests locally in the broad owning run, including the #345 drawer-first activation cases and PR344 Statement source-retarget checks. Help's inherited index assertion omitted the already-added Calendar topic; its expected reading order now includes it explicitly.

## Whole-branch review and correction

The single whole-branch review found two Important issues, with no Critical findings. Derived Statement formulas could combine individually valid facts with different currency/unit contexts; changing the FY/FQ selector created an explicit fiscal binding on metadata-backed sources. Three regression cases failed before production corrections (mixed currency, mixed unit, metadata FY/FQ switching).

Derived formulas now retain the actual Statement fact IDs read by their dependencies, propagate that evidence through nested formulas, and refuse incompatible company/currency/unit contexts. Unrelated lines are excluded from this compatibility check. The fiscal selector updates an existing explicit period-kind binding but preserves the absence of that field for metadata-backed sources.

The analytical owning suite passed 398/398 after correction. Additional boundary cases exercise matching contexts and unrelated differently denominated lines, plus real worker preview for metadata FY/FQ switching. The first full-unit diagnostic picked up the new RED tests while still running: 5406 passed, 3 intentionally reproduced failures, 6 opt-in skips; this run is not qualification. A complete fixed-source run and full browser run are pending.

Existing integrated evidence: 844/844 owning tests before review corrections, including all 39 LocalTableRenderer execution tests; 17/17 Help checks; 33/33 targeted browser cases; 4/4 Statement preview visual cases across both themes and desktop/narrow layouts; 6/6 reference contracts; native build passed before review corrections. These earlier runs do not replace final-source qualification.

Final-source boundary run: 14/14 cases passed, including actual worker preview with acquired fiscal metadata, matching currency/unit calculations and unrelated context isolation. Real Chromium module-worker mixed-context regression passed (the first test fixture omitted the API's required AbortSignal; corrected fixture passed). Web contract suite 31/31 and scrub check pass. Type checking and lint pass after explicit typing of browser fixture imports. Broader Help coverage found Calendar's missing image; real both-theme screenshot generation is underway rather than exempting that topic. Article-side clean-v4 manual now includes Statement templates and final Saved/Arrange controls.

The first fixed-source full unit attempt stalled under filesystem/network restrictions and was interrupted. Its unrestricted replacement is the qualification run; do not report the interrupted attempt as passing. Browser full run was started before the additional mixed-context spec was written, so that spec has its own separately passing real-worker receipt.

Broader Help suite now passes all 42 checks with both real Calendar screenshots. All 31 web contracts pass. Final reference contract invocation explicitly uses OPENBB_REFERENCE_URL=http://127.0.0.1:7780; the earlier default-port attempt refused connection at 7779 and is not a passing result. Receipts are being collected under docs/releases/validation/v4-integration. Full qualification remains pending; no final v4 tag or push.

The explicit-binding boundary check additionally reproduced an unset fiscal period kind on a draft with mapped period fields. The selector now updates period kind when any explicit fiscal field exists, while retaining metadata-only bindings. This is the same review correction, with an additional RED case before its boundary adjustment. Native fresh-profile startup showed no settings warning, and a disposable second tab survived quit/reopen. A further native build incorporates final Help images and the explicit-binding correction.

Full Chromium diagnostics found two narrow viewer-header overflow failures (dark/light 390px) after the action cluster exceeded the card width. The existing browser assertions observed RED. The action cluster now wraps within the card; all 8 viewer cases passed, including desktop, narrow, cramped and coarse-pointer modes. Additional action-bound checks are running to verify visible controls remain inside the header, not merely clipped.

Current fiscal/context boundary suite passes 15/15 with authoritative FY/FQ metadata and actual worker Profit40 evidence. The full-unit diagnostic loaded the explicit-field RED case before its fix; that known case is repaired in the 15-case run. Final qualification must use frozen source and a freshly restarted browser harness. Reference image acquisition encountered upstream Star History 403; this is recorded as reference-backend failure, not silently counted as a rendered widget. OpenBQ Docker smoke passed all nine cases; reference numeric refresh and Run request gating passed.


The complete diagnostic Chromium run finished with 211 passed, 3 narrow-viewer overflow failures (both themes plus coarse pointer), and 1 opt-in reference skip. All 8 repaired viewer cases subsequently passed, including explicit bounds for every visible header action. The frozen-source full browser qualification uses fresh ports 4297/4298 with reference acceptance enabled and includes the new mixed-context case. Frozen-source unit qualification enables reference contracts against 7780. Final native build is also running.

Backend identities: reference container 3bc7119d6ea6, image openbq-regression:reference-final-source on 7780; OpenBQ container 381c1b453af1, image openbq-regression:v3-final-source on 6912. OpenBB Docker source checkout observed at c3223c3e9c1a4c2b26471655b35fe467f4ae0177. Reference rehearsal finished with 70 rendered and one upstream image acquisition failure; nine OpenBQ cases rendered. No final tag or remote operation.

Native inspection confirmed final-source startup without a settings warning and retained disposable tabs. Native Reference Manual navigation includes Calendar, whose page loads. It also exposed inherited v3 wording in home/About pages and missing Calendar imagery in the expanded guide; corrections are prepared in /tmp/bdobb-v4-guide-corrections.json and intentionally await completion of the live browser run to avoid HMR during qualification. Those documentation-only changes require fresh Help verification and rebundling.

The fresh full-browser run observed two asynchronous Pivot-switch fixture failures: Playwright uncheck expects immediate state change while the control retains its committed state until durable save. Both tests now click and explicitly await the resulting checked state, retaining saved-definition/reopen assertions. A focused two-case run is in progress; no product behavior was changed for that timing repair.

Both corrected asynchronous Pivot-switch browser cases passed, preserving durable save/reopen checks. Native frozen-product-source build exited successfully. Manual wording corrections also include the import/export pages, distinguishing v4 pinned templates from v5 generic Statement presentation. These changes remain staged outside the source tree until the current browser run ends.

The completed unrestricted unit diagnostic reports 5410 passed, 1 known explicit-fiscal RED fixture failure, 6 opt-in skips. That boundary is corrected and passes in the 15-case current-source run; the frozen-source full unit run is still pending. Native Tables manual inspection additionally found a duplicate older report-model section and a stale PR338 CI checkpoint. The prepared documentation correction consolidates to the current Page-set/Saved-panel instructions and retains copyright/license notices and historical source attribution.

Native manual search for Statement reaches Tables and exposes the pending stale Import/About wording, matching the staged correction list. Native observation receipt records the rebuilt binary hash, isolated identity, no startup settings warning and quit/reopen persistence. The final documentation rebundle remains required before v4 can be considered complete.


Final product verification: 5417/5417 unit tests across 304 files, zero skips; 214 browser cases passed in the complete run and both asynchronous switch fixture failures passed in the repaired focused run. This is composite browser evidence, not a single all-green run. All 42 Help checks, 31 web contracts, six reference contracts and nine OpenBQ smoke cases passed. Reference rehearsal rendered 70/71; the remaining upstream image request returned HTTP 403. Final native manual inspection verified version 4.0.0, Calendar imagery, correct Statement scope, no startup warning and retained tabs. It found one residual Episode 3 boundary sentence; that sentence was corrected and a final documentation rebundle is running. Final tags and pushes remain held.


Reader-facing Help and searchable Reference Manual now use BDOBB. Verified historical source-link targets and real application-data identifiers are retained. The obsolete donor clone command was replaced with a local-checkout instruction. Final Help suite passed 42/42. Corrected v3 received the same documentation changes in bdeb3474e7a242ad7ca8ea413e80142fcac782c7; its authorized unpublished local v3.0.0 tag now points there, with the prior tag object retained at refs/archive/v3.0.0-before-help-branding. V4 must merge this documentation-only v3 continuation before its candidate checkpoint; no product behavior changed.

Final BDOBB naming bundle exited 0 and native inspection verified BDOBB Help titles, v4.0.0 scope, Episode 4 boundary, Calendar imagery, retained tabs and no startup settings warning. The native receipt now names the final binary hash. Product source matches the frozen 5417-test unit run; subsequent differences are documentation and the two repaired asynchronous browser assertions. Candidate is validated with the recorded composite browser evidence and one upstream reference image limitation; final tag remains held.

The v5 cumulative run exposed the shared HelpDialog fixture still expecting BDOBB2 after the requested documentation rename. Corrected its three expected navigation labels; all21 HelpDialog cases pass in v3, v4 and v5. V3 local tag now points to c1783a1899467367d4d102e7ca3410fbf0f2cb42, preserving prior tag at refs/archive/v3.0.0-before-help-fixture. No product code changed; native v4 binary remains the qualified artifact. V4 is merging this test-only v3 continuation before v5 ancestry reconciliation.

The post-branding Help browser suite passes 3/3 with the BDOBB heading. The test-only v3 continuation 277c9a5 is carried into this lineage; its prior tag object is preserved, and final v4 tagging remains held. Product source and native qualification are unchanged by this fixture correction.

## Fix batch 2026-10-08 (user-approved)

- Carried by merge from v3 `claude/clean-v3-fixbatch` (`refs/integration/v3-fixbatch-2026-10-08`): D-005 `3abc906` (no automatic grid compaction; the DashboardGrid conflict with this line's `margin`/`containerPadding` resolved by keeping both), D-008 (array group default joined) and D-002 (browser smoke scoped to the built-ins seed; `test:web:browser` in CI after `build:web`).
- D-007 (home v4): curated `pivot-v1` layout overlays on backend tables import as `card.table.pivot`, which TableRenderer applies, instead of a worker-only `tableDefinition.analytical`. Backend tables stay off the client worker (user ruling: SSRM/server execution later). Reverses the provenance.md ruling, corrected there with a dated note.
- USER-APPROVED ASSERTION CHANGE (2026-10-08): `src/lib/appsJson.cleanV4.test.ts` "reference pivot-v1 layout overlays become editable analytical definitions in v4" asserted `tableDefinition.analytical`. Renamed "…import as the in-thread pivot their backend table runs (D-007)", it now asserts `table.pivot` equals the source recipe and `analytical` is undefined. The old expectation was the defect.
- Receipts: [validation/v4-integration/fixbatch-2026-10-08](validation/v4-integration/fixbatch-2026-10-08/).

## Fix batch 2026-10-09 (run 3 defects, user-approved)

- D-011 (home v4): a local CSV/XLSX blank cell (left out of the row by SheetJS) or a JSON row that omits a key made the engine read the field as unavailable, so a Company×Desk group showed `#ERROR`. `datasetFromBytes` now fills every absent file column with null, using `Object.defineProperty` so a `__proto__` column stays an own key. The engine's rule that an absent key means the field is unavailable is unchanged. As approved, row IDs change once for rows that contain a blank, because identity hashes the row content.
- D-014 (home v4): `M` (calendar month) is a first-class category transform. It is added to the type unions, the model and execution validators, the `M → month` bucket mapping, the category editor, and the arrange-panel label `Month`. Stored `legacyBucket: 'month'` is never rewritten; `migration.test.ts` and `persistence.test.ts` already pin that.
- New tests:
  - `localTableData.test.ts`: a blank CSV cell and an omitted JSON key are present as null; an absent `__proto__` field is filled as an own key.
  - `tableExecution/workerClient.test.ts`: the drawer path through the worker for CSV and JSON gives Company×Desk sums with no `#ERROR`. An `M` model with first/max/min/last/sum validates and gives the same rows as the legacy month recipe, with hard-coded expected values.
  - `CategoryEditor.test.tsx`: offers and saves `M`.
  - `ArrangePanel.test.tsx`: labels an `M` pill "Month".
- Assertions changed: none.
- Review: one code-reviewer pass found no Critical or Important issues. It noted two Minor points that predate this change and were left as is: a column that is blank in every row is still absent, and the pivot header shows the raw code `M`, as it already does for Y and Q.
- Receipts: [validation/v4-integration/fixbatch-2026-10-09](validation/v4-integration/fixbatch-2026-10-09/). The e2e result is composite: one PDF find-bar timeout under load, which passed on a rerun of that spec.

## Fix batch 2026-10-10 (FREEZE for the release regression)

- Fixed: #18 (`5c052c5`), #20 (`c45b30b`), #21 (`6a8d5fe`), #28 (`9785736`), #29 = D-021 (`8b36ed1`), #30 (`cf2eb84`), and D-020 (`d7e9fc3`, with review follow-up `62be9df`).
- Proof tests: V4-004 backend-card linked remap (`2f3f1db`) and #16 (`2933622`). #27 is already fixed by `75b8781` and covered by `missingLines.test.ts`.
- Open: D-019 export format ([OPEN-QUESTIONS.md](OPEN-QUESTIONS.md)).
- Assertions changed: none. The worker-export test helper `exportAs` now also waits for a binary file.
- Receipts: [validation/v4-integration/fixbatch-2026-10-10](validation/v4-integration/fixbatch-2026-10-10/). Every gate passed once at `62be9df`.

## Fix batch 2026-10-10b (RE-FREEZE; supersedes the a4439c4 freeze)

- User rulings 2026-10-10:
  - merged frozen v3 `1c50899` (OBBject warnings notice) as `8dd322a`;
  - D-019 / #32 inline `"#ERROR: <reason>"` in exports (`29cf46e`);
  - #17 gap: backend Pivot `value` fallback (`b7fc6c2`) and the refusal reason shown in an empty worker table (`58eb69a`).
- D-020 / #33 and D-021 / #34 are approved as built.
- Assertions changed: none.
- Receipts: [validation/v4-integration/fixbatch-2026-10-10b](validation/v4-integration/fixbatch-2026-10-10b/). Every gate passed once at `29cf46e`.
