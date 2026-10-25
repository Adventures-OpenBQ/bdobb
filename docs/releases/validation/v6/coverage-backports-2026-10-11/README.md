# v6 coverage-audit back-ports 2026-10-11 — receipts (RE-FREEZE)

Branch `codex/clean-v6`, on top of the freeze `b9a893f`. A commit-level audit of every bdobb-v2 ref found three dev fixes to Rita, a v6 feature, that dev first tagged v12.3.0 (#91). User ruling 2026-10-11: a fix belongs to its feature's version, so these are back-ported here.

| Commit | What |
|---|---|
| `855b12c` | Dev da6f4bb: a Rita widget fetch sends only the parameters the widget declares. Model-supplied `input_args` such as `api_key` or `callback` no longer reach the backend. Failed first (`red-declared-params.log`). |
| `79b2e10` | Dev 5c05aa5: Stop cancels an MCP tool call already in flight. The turn's signal now reaches `callMcpTool`, linked to each request's timeout controller and unlinked in `finally`; a caller's abort is not reported as a timeout. Failed first (`red-stop-cancels-mcp.log`, `red-stop-chatstore.log`). |
| `4d7751b` | Dev b1e6612: Rita asks before an external MCP tool runs. A **Confirm tool call** prompt shows the server, URL, tool and arguments, with **Run** and **Deny**. Deny returns `user_declined`; Stop or Clear settles the prompt as denied. Turned-off tools are refused before any prompt, and local tools run unprompted. The commit's untrusted-data bracketing is deliberately not carried. Failed first (`red-confirm-mcp.log`). |
| `2b93f74` | `provenance.md` records the back-ports, the approved Maximum tool rounds setting, and that dev's Spark deployment notes are superseded by clean's OpenBQ Rita recipe. |
| `4a19a48` | Real merge of the v5 freeze `13c3618`. Nine conflicts, each resolved by keeping both sides (see the commit message). |
| `2ee6407` | `e2e/proxied-tools.spec.ts` now answers the confirmation: it checks nothing is sent before **Run**, then sees the result. |

Every gate is v6's full set plus the revision test and dashsync. `run-gates.sh` is the script that was run.

The first full run, at `4a19a48`, failed two e2e tests (`e2e-first-run.log`):
- `proxied-tools.spec.ts:62`: the confirmation was working as designed, so the test was updated in `2ee6407`.
- `pivot-page-runtime.spec.ts:10`: a load-sensitive timeout. Alone it passed 24/24 over three repeats.

The gates below are the second run, at `2ee6407`.

| Gate | Result |
|---|---|
| typecheck | pass |
| lint | pass |
| unit | 7081 passed, 29 skipped |
| revision-test | 51 passed |
| build | pass |
| e2e | 271 passed |
| web | pass |
| build-web | pass |
| web-browser | PASS |
| cargo | pass |
| scrub | Failed during the run only on its own unscrubbed logs. After those were scrubbed: scrub-check clean, header-check clean (`scrub-rerun.log`). |
| help | 75 passed |
| cargo-test | 15 passed, 0 failed |
| e2e-webkit | 24 passed, 1 failed: `rail.spec.ts:109`. Pre-existing, as in the earlier v6 receipts. |
| notices-check | up to date |
| dashsync | 7 passed |
| diff-check | `git diff --check b9a893f HEAD`, excluding receipt logs: exit 0 |

**Frozen.** The freeze is the commit that adds these receipts. Delivery: nothing pushed, no tag moved.
