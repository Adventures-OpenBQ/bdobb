# Isolated v5 development

Branch: codex/clean-v5. Copied baseline: c7f59d129055f38d2594c7c9c83c479ec9c9172e; frozen v5 donor d35a13ecebe78205c5c99454ed627240017fdeb7. This is an unqualified, untagged v4 candidate plus isolated v5 assembly. Incoming v4 PRs #344/#345 must be reconciled before final v5 qualification. No push, rename or final v4/v5 tag.

## Implemented candidate scope

- Workspace create/edit, independent panel ownership/tabs, focused library targets, maximize/rail, arrangements and saved layouts. Every mounted dashboard owns its worker runtime.
- Generic Statement taxonomy, supplied fiscal Q/TTM labels and negative cash flow; complete revision-qualified worker transfer, honest stale/completeness notices, durable folds and completed line-item CSV/JSON/XLSX exports. Analytical Pivot definitions remain separate durable intent.
- Versioned v5 compatible app overlays preserve Statement and inherited v4 state with closed validation and link remapping. Workspace/layout documents and file bytes remain separate from apps exports and portable preferences.
- Quick Help/searchable Reference Manual and six real Calendar/Workspace/Statement screenshots in both themes. Candidate manual, user guide and keyless synthetic financial example reflect actual behavior.

## Current evidence

- Earlier foundation 127, UI/focus 137, real worker ownership 44, Statement/card/persistence 223 and codec 43 assertions passed in scoped runs.
- Statement actual browser folds, Table return and folded exports: 3/3 passed, including backend JSON projection. Workspace browser: 26/26 passed in prior scoped runs and again in the full diagnostic.
- Owner/help/menu repaired regression: 378/378; card/release/scrub scoped retry: 227/227; App/example current retry: 38/38.
- Single whole-branch review completed. All three important findings fixed: saved-tab restoration before focusing first panel, stale Statement transfer notice, and duplicate dashboard-slot rejection. Review-specific tests passed. App test module-reset isolation was corrected without weakening the restoration expectation.
- Final unit diagnostic: 5545 passed, 13 failed, 6 skipped across 307 files. One stale App test fixture is corrected by the current 38-test retry; twelve shell launcher timeouts are covered by a serial current-source 16/16 retry with the established 60-second budget. This is cumulative evidence, not a single all-green run.
- Stable Chromium diagnostic: 204 passed, 7 failed, 1 opt-in skip of 212 cases. Failures identified: async Pivot toggle fixture (2), compact header overflow (3), startup Apps/key metadata incorrectly counted as file acquisition (2). All seven failures are covered by the current affected-flow rerun: 72/72 passed, including Workspace, Statement, Pivot and compact headers. This is cumulative evidence.
- A prior changing-source browser run selected duplicate dynamically imported stores after Vite hot reload. Restarted stable harness passed all 14 focused worker/Pivot cases; use fresh harness after integration edits.
- Reference conformance 6/6, real curated inventory 71/71 rendered, numeric refresh and Run controls passed after route-draining teardown repair. OpenBQ Docker 9/9 rendered. Web contracts 31/31 passed.
- Native v5 candidate built with its own app identity. Actual absent-profile launch reproduced an omitted storage-root fix; restoring donor 4ac9cd071 removed the settings warning. Final rebuild passed. Native File → New Workspace… opened the dialog, created “Native v5 smoke”, and the workspace remained available after quitting and restarting; no settings warning appeared.

## Baseline audit corrections

The [article-side audit](../../../../editorial/bdobb-clean-baseline-fix-audit-2026-10-06.md) checks direct fix commits as well as PRs. Five gaps were confirmed: storage root (#316 issue), table-only key-maint detection, per-owner tabs for new/multi-import dashboards (#320 issue), native New Workspace menu, and Calendar logo/column-union repair. Six donor/new behavioral cases were observed failing before restores; current Keys/owner/Calendar/date suite passes 174/174, and the broader post-audit owning regression passes 631/631. Original EXP+n refusal is superseded by correct forward-expiry support and is not restored.

Donor fixes credited Art Cashin with Claude Opus 5.5 (storage, Keys, Calendar) and Claude Fable 5.1 (tab seeding/native menu review), with exact hashes in the audit. Preserve attribution in the final release provenance. Baseline/core corrections must propagate into final v4.

## Remaining release boundary

Use the [integration checklist](v5-v4-integration-checklist.md). #344 adds core Statement templates; reconcile generic v5 presentation against one worker definition and preserve numeric formats, fiscal labels and links. #345 changes raw-table/Arrange/Saved controls. The implementor could not run LocalTableRenderer.execution.test.tsx even on unchanged base; require successful changed-test local or CI evidence after integration. Copied baseline's 31 passing tests do not qualify #345.

Corrected unpublished v3 is validated and its local v3.0.0 tag now targets 03fa7617c21dc9ab2d9718c85efcfba416a4910a under explicit user authorization. Its repair checkout is bdobb-clean-v3-repair; the original tag object is retained as refs/archive/v3.0.0-before-baseline-correction. The replacement tag was imported here without changing candidate source or branch ancestry. V4/v5 final tag holds remain. Reconcile final v4 onto corrected v3, then transfer only the v5 delta after c7f59d1. Rerun full cumulative release gates and update controls/manual screenshots then.

[Validation receipts and commands](v5-candidate-validation.md) record cumulative results and limits. Help tests pass 17/17; all six screenshots were regenerated after repairs and the Workspace screenshot was inspected. Final typecheck, lint, scrub and diff checks pass. Logs use /tmp/bdobb-clean-v5-*.log.
