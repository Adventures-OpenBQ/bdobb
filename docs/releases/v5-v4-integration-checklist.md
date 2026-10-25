# V5 reconciliation onto final v4

This is a merge checklist, not authorization to tag or push. The isolated v5 branch is codex/clean-v5; its copied baseline is c7f59d129055f38d2594c7c9c83c479ec9c9172e. Preserve the original candidate and baseline manifest until reconciliation is complete.

## Inputs

- Final qualified v4 must incorporate user-identified PRs [#344](https://github.com/bdobb-dev/bdobb-v2/pull/344) and [#345](https://github.com/bdobb-dev/bdobb-v2/pull/345). Both were open at inspection; #345 stacks on #344, which targets #338. Freeze the actual final commit and source hashes; do not transfer changing branch heads by assumption.
- Restore storage-root initialization from donor 4ac9cd071857472220000602e3f37a335503fcee (issue #316). It was omitted from the clean baseline and is now restored in v5. Carry it once, with its nonfatal failure behavior. Existing v3 tag must not be moved silently.
- Carry only the v5 delta after c7f59d1. Keep modern analytical worker ownership, revision checks, full transfers, source identity, Undo and group lifecycle. Keep provider-specific #342 activation, widget pinning, AI/Skills and cron deferred.

## Resolve shared boundaries

1. Review WidgetCard, LocalTableRenderer and StatementWorkerView together. Core templates arrive in v4; generic Statement presentation and durable folds arrive in v5. Retain one authoritative analytical definition and worker result. Do not calculate independent competing totals or reinterpret numeric formats.
2. Verify template-generated rows, explicit wide/long mappings, flow/stock/formula rules, overrides and updates against Statement projection. Missing data stays missing, zero remains zero and negative cash flow remains negative. Supplied FY/Q/TTM labels and fiscal alignment survive.
3. Preserve complete revision-qualified worker transfer and its stale notice. Linked outputs obey producer presentation/selection and preserve raw numeric values for charts. Never expose private fields or claim unknown backend completeness.
4. Reconcile versioned apps profiles and persistentCard projection. Preserve the final v4 template format and metadata, then add the v5 Statement overlay. Round-trip both, refuse unknown/malformed profiles before writing, and remap links through fresh card identities. Workspace/layout files and dropped bytes remain separate from apps exports.
5. Keep dashboard-owner mutations and independent panel tabs through workspace focus, replacements, storage sync, tab deletion and drag. Keep runtime ownership alive for all mounted panels. Restore saved tabs before focusing the first visible panel. Reject duplicate dashboard assignments including hidden slots.
6. Adapt tests and screenshots to #345's Arrange-first raw table and combined Saved panel. Do not use an old Enable report model selector without opening its drawer.

## Acceptance gates

- Run the complete post-#345 LocalTableRenderer.execution.test.tsx successfully. The implementor's unchanged-base environment failure is not acceptance of their modified tests. Obtain CI evidence or reproduce locally, documenting any environment repair without weakening assertions. The copied candidate's 31 passing tests do not certify #345.
- Re-run complete unit coverage with the established 60-second budget for shell launcher fixtures; retain current-source retry receipts when a full diagnostic changed during execution. Run typecheck, lint and scrub.
- Restart the isolated browser harness after integration edits. Raw-path dynamic store imports can select a different module instance after Vite HMR; never qualify those cases from a changing harness. Run all Chromium cases, including actual worker/Pivot/links/Undo, Workspaces, Statement, folded exports and compatible-import persistence.
- Repeat pinned reference contracts, all 71 reference widgets, saved chart views, Run/numeric refresh and nine OpenBQ Docker cases with fresh receipts. Keep the real container identities and hashes.
- Build the final native candidate under a separate identity, launch with an absent app-data root and verify no startup settings warning. Exercise persistence/restart in that isolated profile. Preserve prior test profiles instead of touching normal BDOBB data.
- Update Quick Help, searchable Reference Manual, candidate example and article-side manual to the resulting controls; generate and inspect both-theme screenshots. Confirm user instructions match actual exports and storage boundaries.
- Record final lineage, source hashes, donor attribution, logs and unresolved limits. Final tag, push and repository rename remain held until the user authorizes the release boundary.

## Current integration findings (2026-10-07)

The v4 integration is isolated at ../bdobb-clean-v4-integration, on codex/clean-v4-integration. Its ancestry includes corrected clean v3 03fa7617c21dc9ab2d9718c85efcfba416a4910a. User explicitly authorized rebuilding unpublished v3 and replacing its local tag; this has been completed and the prior tag object is retained under refs/archive/v3.0.0-before-baseline-correction. The saved v5 delta is commit 9e00707 after c7f59d129055f38d2594c7c9c83c479ec9c9172e. Preserve this candidate while preparing reconciliation.

PR344/345 integrated source is frozen at 0340c6f8f5d1e0157f8577a7af139ba43d2985a8 and 14357123e06362d1173c5b8b850e695ba4511e3b. All 39 integrated LocalTableRenderer execution cases now run successfully locally; the implementor's CI-only caveat has been resolved for this clean-line integration. Current v4 corrects derived mixed currency/unit contexts, metadata FY/FQ switching and narrow viewer-header action wrapping. Carry those corrections into v5 once, retaining v4 ancestry. Final frozen-source v4 checks are in progress; do not treat it as qualified yet.

The current v5 loadStatementSnapshot discards row groupPath, cellErrors and cellFormats before projecting ordinary provider-style fields through statementRows. It therefore cannot safely project v4's compiled templates, whose rows are line members and whose columns are worker-calculated fiscal measures. StatementRenderer currently has one format per item and no per-cell error display. Reconciliation must preserve these worker descriptors and errors, use the calculated values directly, and support per-cell formats. Tests must cover selected template-derived Profit40, error cells from incompatible monetary contexts, authored line/section order and labels, linked propagation, folded exports, negative cash flow, and unchanged ordinary FY/Q/TTM projection.

Use explicit, validated presentation evidence from the producing worker rather than guessing that a raw field or private row ID prefix identifies a Statement. Any presentation descriptor must be bounded, versioned, clone-safe and contain only presentation metadata; it must not carry executable formulas or private source facts. Selected rows remain selected; do not reintroduce filtered/hidden lines to fill a template.


### Reconciled checkout (2026-10-07)
New checkout: ../bdobb-clean-v5-reconciled, branch codex/clean-v5-reconciled. V4 input b3f754fba5ceb34fa2b6788be0c09de4d970945c includes corrected v3 bdeb3474e7a242ad7ca8ea413e80142fcac782c7. Preserved v5 input remains 9e00707; original v5 checkout and its uncommitted naming changes are untouched, with a binary patch saved at /tmp/bdobb-v5-documentation-preserved.patch.

Ruling: resolve shared documentation on validated v4 content, adding the v5 Workspace/Statement walkthroughs and BDOBB naming. Keep both screenshot recipes, validated Calendar assets, wrapping card actions and one Rust storage initialization plus the New Workspace menu. This preserves the v4 core while adding only v5 scope.

Merged boundaries passed 93/93, including 39 LocalTableRenderer execution tests, Help and v4/v5 compatible profiles. Typecheck passed after copied dependencies finished; an earlier npx invocation before copying completed attempted registry lookup and failed, so is not qualification. Four real-worker template projection regression cases reproduced RED before implementation. Worker presentation metadata is versioned and bounded, with labels/structural IDs only; source facts and executable formulas remain private. Final regression qualification remains pending; no tag or push.

### Current integrated lineage and validation

Current v5 reconciliation HEAD a1080a5 includes actual v4 a337255 and corrected v3 c1783a1 ancestry. Template projection, stable folds, per-cell errors/formats, complete linked transfers and updated Help/Reference are implemented and tested; see [v5 reconciliation](v5-reconciliation.md) for current receipts and remaining gates. Older pending descriptions above document the original reconciliation findings. Docker v3/v4 containers are stopped at the user's request; no restart, tag or push is authorized by this checklist.

### Final local candidate check

The current integration parent is 325e1d4, including v4 d333753 and v3 277c9a5. Final local units pass 5,743 with six intentional reference skips while Docker is stopped. Corrected affected browser suites pass23 and post-codec Apps/template checks pass6; browser qualification is composite. Final native build/inspection, web31, TypeScript/lint and scrub pass. See the reconciliation report for the preserved upstream reference image exception and deferred route-cleanup backend check. Save local candidate only; final tags/push/rename remain held.
