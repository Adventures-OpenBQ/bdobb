# V5 local candidate reconciliation

V5 adds Workspaces, saved panel layouts and Statement presentation on the validated v4 analytical core. PR #344 templates and #345 Saved/Arrange controls stay in v4. The candidate remains local and untagged; no push or repository rename has occurred.

## Release lineage

| Release | Local lineage | Scope |
| --- | --- | --- |
| v3 | `277c9a549b129b1f02f6e93f3c540c161806fe2f`; local `v3.0.0` | Reference desktop parity, startup storage-root correction, BDOBB Help/Reference. Cron deferred. Previous local tag objects preserved. |
| v4 | `d3337532d7938193f258fd945425d6f633bab1c5` | Analytical Pivot/worker authority, date/calendar/library/key/docked controls, PR344 templates and PR345 drawer cleanup. Final tag held. |
| v5 | Integration parent `325e1d47dd2f8f34b82122104b8e4676fcf72d9a`, branch `codex/clean-v5-reconciled` | Workspace/layouts and generic Statement view over the actual v4 lineage. Final tag held. |

The preserved original v5 candidate is `9e00707`, copied from baseline `c7f59d1`. Its checkout and uncommitted naming corrections remain untouched. The original dirty v4 assembly also remains untouched. All corrected v3/v4 commits are actual v5 ancestors, rather than source copies on an unrelated base.

## Implementation and user documentation

The producing worker emits bounded, versioned Statement presentation metadata containing structural IDs, labels and authored order. It contains no formulas or private source facts. V5 consumes complete revision-qualified worker transfers, projects actual delivered leaf rows, preserves raw values and per-cell formats/errors, and refuses incompatible structure. Empty selection stays empty. It does not fill hidden lines or compute competing totals.

Template folds use stable section IDs and survive label changes. Ordinary provider folds retain their existing names. Calculation errors display and export as `#ERROR`, with the reason available on hover. Linked charts retain raw numeric values. Compatible Apps exchange carries pinned v4 templates inside the v5 presentation envelope and remaps linked card identities.

A regression found that strict v5 JSON validation was being applied to ordinary legacy imports. Profile detection now uses own data descriptors without invoking accessors; strict validation runs only for an explicitly declared v5 envelope. Optional malformed legacy extensions retain the existing safe refusal/fallback behavior. Declared v5 accessors, unsupported schemas and invalid overlays remain rejected.

Quick Help, searchable Reference Manual and the standalone user manual use BDOBB wording. Statement guidance documents template projection, selections, errors, exports and stable folds. Both themes have refreshed Statement and Workspace screenshots, inspected visually and in the native manual. Real bundle-identifier storage paths and historical source URL targets are retained accurately.

## Validation

The complete final local unit run passed: **5,743 tests across 322 passing files**. Six reference tests in one file are intentionally skipped because reference integration is explicitly disabled while Docker remains stopped. The candidate is saved locally; final release gates remain held.

| Check | Result / receipt |
| --- | --- |
| Final complete local units | 5,743 passed, six opt-in reference tests skipped, exit 0; 613.25 seconds |
| Legacy/v4/v5 codec regression | 34 passed; includes 15 reproduced legacy failures and a declared v5 accessor refusal without getter execution |
| Statement owning and Help/codec checks | 86 passed before the final narrow codec correction; owning behaviors are also covered by the complete final run |
| Full browser diagnostic | 242 passed, five failures and one not run; not a single all-green run |
| Corrected affected browser suites | 23 passed: Help, RSS, Statement, Pivot parameter viewports and table toolkit |
| Browser Apps/templates after codec fix | Six passed, including both themes, folds/reload/export and mixed monetary-context errors |
| v3/v4 Help browser fixtures | Three passed per version; shared heading correction carried through actual ancestry |
| TypeScript / lint | Passed for final codec and browser fixture changes; earlier complete-source lint receipt retained |
| Web regressions | 31 passed with local test-server permissions |
| Repository scrub | Clean |
| Final native build | Passed; final binary SHA and observations in `native-observation-codec-final.json` |
| Native inspection | No startup settings warning; saved two-panel Workspace and independent tabs restored; BDOBB version 5 Reference Manual and Statement image/error guidance verified; app quit |

The original fresh-profile native launch and quit/reopen checks are in `native-observation.json`. The final codec-only rebuild was checked against the preserved test profile. No production storage profile was reset.

## Diagnostic history and limits

The first full unit diagnostic ended with 5,726 passed, 16 failed and six reference tests blocked/skipped. Fifteen failures came from overly broad v5 validation; one was a stale BDOBB2 Help assertion. Both were repaired and tested. The reference beforeAll failed after the requested Docker shutdown. A subsequent sandboxed unit attempt stopped progressing; its partial log is retained separately and is not qualification evidence.

The full browser diagnostic exposed the same stale Help heading, three timeout cases, and a reference `route.fetch` callback surviving teardown and being attributed to the following RSS test. The corrected local suites passed all affected cases, including both RSS tests. Reference teardown now drains in-flight routes, but that correction has not been rerun against the stopped reference backend. Do not report a clean single full-browser run from these composite receipts.

Earlier pinned-backend rehearsals are preserved with their original source identity: OpenBQ nine of nine; reference 70 of 71 rendered. The remaining reference image endpoint returned HTTP500 from an upstream StarHistory403; it is recorded as an exception, not a rendered widget. Reference Run/refresh controls passed three of three after repairing canceled-fetch handling and requiring successful completed responses. These backend rehearsals preceded the narrow final codec correction; no new full backend qualification is claimed afterward.

At the user's request, `bdobb-v3-reference-final` and `bdobb-v3-openbq-regression` were stopped. Docker inspection confirmed no BDOBB v3/v4 containers running. Leave them stopped until requested otherwise. No containers were removed.

Receipts are under [validation/v5-reconciled](validation/v5-reconciled/). Historical frozen-source hashes remain separate from the final corrected-source manifest. Final v4/v5 tags, pushing and repository renaming remain explicitly held.

## Fix batch 2026-10-08 (user-approved)

Merged `codex/clean-v4-integration` (v3 D-005/D-008/D-002, v4 D-007 and its user-approved `appsJson.cleanV4.test.ts` assertion change, logged in v4-integration.md). Added Window ▸ Keep Sidebar Open (home v5): a native check item bound to the active workspace's `railsOpen.left`, disabled outside a workspace, kept in sync through `set_window_pin`. No assertion changed on this line. Receipts: [validation/v5-reconciled/fixbatch-2026-10-08](validation/v5-reconciled/fixbatch-2026-10-08/).

## Fix batch 2026-10-09 (user-approved)

Merged `codex/clean-v4-integration` at `ae3d540` as `af73e52`. That brings in D-011 (a blank local cell or an omitted JSON key is null, not an unavailable field, so pivot groups no longer show `#ERROR`) and D-014 (`M` is a first-class month category; stored `legacyBucket: 'month'` is unchanged), both logged in v4-integration.md. The merge had no conflicts, and v5 has no further transform lists that needed `M`. No assertion changed on this line. Every gate passed on its first run. Receipts: [validation/v5-reconciled/fixbatch-2026-10-09](validation/v5-reconciled/fixbatch-2026-10-09/).

## Workspace connection carry 2026-10-09 (user-approved)

Merged `codex/clean-v4-integration` at `2bbde09` as `2d55644`. That brings in the v3 Workspace connection (spec `docs/superpowers/specs/2026-10-08-workspace-connection-design.md`, revision 4): Settings ▸ General ▸ User Settings (Local or Server), Workspace connections in key or login mode, Ask for credentials on startup, the OpenBB mark on Platform API backends, and removal of the allowed-code-languages gate. v5's own "workspaces" (panel arrangements) are unrelated and unchanged. Four conflicts, each resolved by keeping both sides. No assertion changed on this line. Every gate passed on its first run. Receipts: [validation/v5-reconciled/workspace-2026-10-09](validation/v5-reconciled/workspace-2026-10-09/).

Second merge: `codex/clean-v4-integration` at `3ef75a3` as `0417e57`, bringing the ticker-conflict fix (Done no longer reports a false "defaultTicker changed elsewhere" after a server connect) and User Settings first in Settings ▸ General. No conflicts. `06d1e08` before it corrected the v5 Workspaces help, which still described the removed Workspace account panel. Every gate passed on its first run. Receipts: [validation/v5-reconciled/workspace-2026-10-09b](validation/v5-reconciled/workspace-2026-10-09b/).

## BDOBB2 → BDOBB rename 2026-10-09 (user-approved)

Merged `codex/clean-v4-integration` at `ed0fa4c` as `f7ac8f0`: the v3 rename (`b6c0ce7`, through v4 `b49924c`) and the v4 key-tones refresh (`621f498`). v5 now uses identifier `com.artcashin.bdobb` and productName `BDOBB` at version `5.0.0`; `migrate.rs` is unchanged. `lib.rs` keeps v5's menu items and v4's deferred main-window build. No assertion changed on this line. Every gate passed on its first run. Receipts: [validation/v5-reconciled/rename-2026-10-09](validation/v5-reconciled/rename-2026-10-09/).

## widgetGap sync 2026-10-09 (user-approved)

Merged `codex/clean-v4-integration` at `1fffdd0` as `1597f84`: Workspace settings downloads ignore unknown BDOBB settings keys with a note instead of refusing, and `widgetGap` is synced. v5's `numberShortcutTarget` and `workspaceOrder` are not synced. No conflicts; no assertion changed on this line. Every gate passed on its first run. Receipts: [validation/v5-reconciled/widgetgap-2026-10-09](validation/v5-reconciled/widgetgap-2026-10-09/).

## numberShortcutTarget sync 2026-10-09 (user-approved)

`c5be527` syncs `numberShortcutTarget` with User Settings on a server; `workspaceOrder` stays local. Test change: the upload block has 13 keys and never `workspaceOrder`; a download applies a valid value and refuses an invalid one. Every gate passed on its first run. Receipts: [validation/v5-reconciled/shortcut-sync-2026-10-09](validation/v5-reconciled/shortcut-sync-2026-10-09/).

## Fix batch 2026-10-10 (FREEZE for the release regression)

- Merged frozen v4 `a4439c4` as `29a90b8`. No conflicts.
- Fixed #26 (`731a3ef`; root cause WebKit `:focus-visible` on restored focus; native check still owed) and #24 (`4eab8b9`, `1f7c164`, `32ec98b`). #23 confirmed by e2e (`091ec31`).
- Assertions changed: none.
- Receipts: [validation/v5-reconciled/fixbatch-2026-10-10](validation/v5-reconciled/fixbatch-2026-10-10/). Every gate passed at `091ec31` except web-browser, which is composite: 2 failures under concurrent load, then 3/3 passes here and 1 in a clean worktree, and a clean bisect.

## Fix batch 2026-10-10b (RE-FREEZE; supersedes the 1ff1c91 freeze)

- Merged re-frozen v4 `c1df908` as `8d3df8c`. No conflicts. It carries the v3 warnings notice, the #17 gap fixes and D-019's worker export.
- D-019 (#32), Statement view (`9d7178a`). Assertion changed with approval: `statementExecution.test.ts:75`.
- The #26 native check is still owed (morning).
- Receipts: [validation/v5-reconciled/fixbatch-2026-10-10b](validation/v5-reconciled/fixbatch-2026-10-10b/). Every gate passed once at `9d7178a`.
