# v6 overnight rebuild 2026-10-14 — receipts (FREEZE)

Branch `claude/v6-rebuild-20261013` (PR #48), on top of `release/v6` `e0c0a0c`, re-cut as `v6.0.0` by the user's overnight authorisation of 2026-10-13.

## What is in it

- **The held v6 branches:** `claude/fix-card-extensions-v6`, help relaunch, Date expression tab, keysave → openbq-api, Run tooltip hard refresh and apps-sync.
- **The v5.0.0 re-cut.** Through it, the v4.0.0 re-cut (PR #45, the v4 RC fixes and the 10-12 v3 repair fixes) and PR #44 reach v6.

## Integration work

- **Help pages and screenshots:** v6's are kept, with the RC's "BDOBB Workspace save" wording carried in.
- **`workspacesFile.ts`:** keeps v6's shared `isStringRecord` from `shareTargets`, alongside #44's `screenFit` import.
- **Tests:** the v3 Save… rail tests now render v6's LeftRail (`onOpenAI`).
- **Notices:** regenerated.

## Gates

| Gate | Result |
|---|---|
| Local, at `17cda5b` | typecheck, lint, scrub, notices, build, build-web: pass. Unit tests: 7577 passed, 29 skipped. cargo (app, pivot-core, pivot-wasm), pivot-verify, pivot-packaging and the web smoke: pass. e2e: 285 passed. |
| GitHub CI, at `03524b2` | build, e2e, pivot, reference and scrub: success. |
