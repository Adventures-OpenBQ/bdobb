# Blocker codes used in the ledger

- **B-TEXT**: no text entry in background mode. app_type was refused for element, coordinate and focused targets ("cannot be typed into while BDOBB Clean v6 is in the background"); raw app_key letters and Edit > Paste (disabled) did not reach any field. Full-screen control was requested twice (`request_full_control`) and both requests timed out with no response. Affects every typed parameter, filter, form, dialog name and every Rita prompt.
- **B-MENU**: pop-up/pull-down controls (Table/Chart view switch, dropdown parameters, column menus) are refused in background mode ("this is a pop-up / pull-down menu control … NOT clicked").
- **B-HOVER**: hover-only UI (left rail, multi-file document rail, hover cards) collapses under background input; rail navigation only partly workable.
- **B-BATCH**: app_batch aborted with "user interrupt" on every attempt (4/4, 0 actions run); single actions were used instead. Several single clicks were also refused while the user was typing.
- **B-OPENBQ**: OPENBQ_API degraded from ~15:12 (D-004): apps.json never answered again during the run; provider commands time out.
- **B-EXAMPLE**: EXAMPLE_DATA not served by any bound service (manifests/services.md).
- **B-FILE**: local CSV/XLSX/apps.json files reach the app only by drag-drop or native Open panels; neither is drivable in background mode.
- **B-RULE**: forbidden by the operator brief (stopping/restarting NAS services).
- **B-WINDOW**: at ~15:42 the QA window was resized to 3260×1185 by something outside this run while the user was active; GUI work was stopped to avoid further disruption.
