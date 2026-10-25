# v5 → v6 migration and rollback, native GUI (V6-001)

2026-10-08 ~15:55 EDT. Disposable copies only. Both live QA profiles were backed up first (see ../profile-restore.md).

Apps: v6 `com.artcashin.bdobb.clean.v6` exe 7b752cfa…1b67; v5 `com.artcashin.bdobb.clean.v5.reconciled` exe 4b6fce084f172e869cb3b7f47c44af1f548c337570b7e83b86ca2c41f60b2da3 (read-only bundle in bdobb-clean-v5-reconciled).

| Step | Result | Evidence |
|---|---|---|
| Copy the backed-up v5 QA profile into an emptied v6 data dir | done | v6-copy-before-launch.sha256 (6 files, equal to v5 backup) |
| Launch v6 on it: no settings banner, v5 dashboards Main/Untitled and workspace "Native v5 regression" shown, no Rita handle (no URL) | PASS | screenshots/030-…, 031-… |
| Files v6 changed | PASS | v6-copy-after-v6-run.sha256: only logs/bdobb.log changed; `skills/` (5 bundled SKILL.md) added; settings.json byte-identical (no keys written without a UI change) |
| AI Library defaults on the migrated profile (Rita off, sharing off, no MCP, rounds 40) | BLOCKED | background rail clicks on this window toggled the hover rail without opening the dialog; the window was then resized to 3260×1185 by something outside this run, and GUI work was stopped. The default 40 is shown on the fresh-profile AI Library instead (screenshots/003-…). |
| Rollback: v5 Reconciled on the post-v6 profile: launches, same Main/Untitled tabs, workspace and two dashboards, no settings banner, no AI Library entry in the rail | PASS | screenshots/032-… |
| v5 rewrote/removed v6 data | PASS (none) | after-v5-rollback-run.sha256: only logs/bdobb.log differs; skills/ and settings intact |
| v5 live profile put back | PASS | moved aside before, moved back after; final recursive hash check in ../profile-restore.md |

Not exercised: v6-written Rita keys (`ritaUrl`, `ritaMaxFunctionRounds`) through the GUI and their v5 tolerance (needs text entry or a dropdown, both unavailable in background mode); `chat.json`, `mcpTokens.json`, `ai-library.json` were never produced.
