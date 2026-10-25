# Run 2 (GUI retest after user approvals), 2026-10-08 from ~16:39 EDT

Profile discipline: new backup `<home>/QA-profile-backups/bdobb-clean-v6-regression-gui-20261008T163923/` (tree hashes equal run-1 originals); disposable v6 profile seeded with the same three backends, Rita URL and MCP server.

Interaction findings (tooling, not product):
- computer_batch (the only display-scope tool) is aborted with "user interrupt" on every call (4/4, including a single screenshot) although request_full_control reports full control available. Display-scope input therefore remained unusable.
- `osascript … System Events key code` → "osascript is not allowed to send keystrokes (1002)"; not changed (system security setting).
- Background app_* with the QA app frontmost: clicks work; raw clicks never give an <input> focus; Edit > Paste stays disabled; ⌘V blocked by the tool. BUT keyboard focus moved with Tab (or focus set programmatically by a dialog) DOES accept per-character app_key typing, with occasional refused keystrokes that must be verified and retried.
- Rail navigation recipe: click Add widget → Escape → Tab (rail stays expanded under keyboard focus) → click the target row.
- Rita pane opens only on pointer hover, input focus (input not rendered while closed) or pin (set only by a sendToAgent cell; no served widget has one): raw input produces no mouseenter, so the pane cannot be opened. All native Rita cases remain BLOCKED (B-HOVER).
- Native <select> parameters and the card view switch do not respond to Return/Down when focused: still BLOCKED (B-MENU).
- At ~16:55 the QA window moved to another display region (x=1860) by itself; work continued after re-anchoring.

Service changes observed: OPENBQ_API restarted by the top-level session (healthy); REFERENCE_CURATED redeployed by someone else to sha-1978c19 at 15:37 EDT (manifests/services.md).

Results (retests reference run-1 receipts):
- D-003 retest: Connections shows OPENBQ_API "995 widgets · 38 apps" (screenshots/R2-001-…). PASS.
- Duplicate-name dialog (V3-007, E05-001): curated "Onboarding App for Devs" over the baseline import offers Replace / Keep both "(2)" / Skip / Cancel (R2-002). Keep both: new dashboard "(2)", original file byte-unchanged. Second import offers "(3)"; Replace: same dashboard id, all tab and card ids regenerated from the file, "(2)" untouched. PASS.
- Card binding: cards from the curated app bind to REFERENCE_BASELINE (resolution by widget id across all backends, App.tsx design note D3); curated cannot be rendered independently while baseline is connected.
- D-005 reproduced on a fresh run-2 import (import-compare/R2-baseline-…) and on the curated import (R2-curated-…).
- E05-004: original Group 3 → MSFT after cell click; "(2)" keeps AAPL. PASS.
- E05-017: Number 250 → "Number: 250"; Text "Rehearsal" → "Text: Rehearsal" (R2-003). With run-1 boolean → PASS.
- E05-002 / E05-019..023: native selects unchanged by keyboard → still BLOCKED.

## Serial sweep rule breach (operator error)
The run-2 resume (`backend-sweep/sweep_serial.py`, one request at a time, 0.5 s spacing) was meant to stop on any request over 30 s. Its guard only reacted to a timeout *error*; `urllib`'s `timeout=30` is a per-read socket timeout, so slow-but-streaming responses ran 54–187 s and the sweep kept going. Stopped by hand at 284/995 (19 widgets added after the restart; slowest default 187 s, slowest non-default 131 s). No parallel load was generated, but the user's 30 s stop rule was not honoured for those 19 widgets. Not resumed.
