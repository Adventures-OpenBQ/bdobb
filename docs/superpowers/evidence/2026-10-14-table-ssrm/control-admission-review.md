# Independent control admission fix review

Completed 2026-10-15 against bdobb46948da and Docker41641c6.

- **Ordinary HTTP saturation refuses session cancellation, session disposal and export cleanup at all three layers — ADDRESSED.** Web admission selects a separate two-slot counter at `bdobb/web/server.mjs:257`; canonical gateway admission selects its separate two-slot counter at `docker/funnel-gateway/server.mjs:577`; native HTTP admission selects a separate semaphore initialized to two at `bdobb/crates/table-service/src/http.rs:35` and `:75`. Ordinary limits remain four, configured `maxConcurrent`, and configured `max_http_requests`, respectively. No control path falls back to ordinary capacity.

### Finding Verdicts / Spec Compliance

- **Only the three exact managed control routes receive reserved admission — PASS.** `bdobb/web/policy.mjs:461` and `docker/funnel-gateway/policy.mjs:460` require a validated managed route, exact method, anchored path and 1–128 ASCII alphanumeric/underscore/hyphen ID. `bdobb/crates/table-service/src/http.rs:89` independently checks the complete native path, method, ID and absence of a query. Source deletion, derive, commands, export creation, LIVE, wrong methods and malformed paths cannot use the reserve. Existing relay URL/query validation remains in place.
- **Independent finite JS rate accounting — PASS.** `bdobb/web/server.mjs:111` separates per-user maps while preserving the 240/minute policy; `docker/funnel-gateway/server.mjs:486` separates fixed-window buckets while preserving configured `requestsPerMinute`. Ordinary failures never increment control concurrency or spend its rate bucket. Both new relay test files explicitly exhaust each allowance and verify isolation in both directions.
- **Authentication, identity, ownership, body limits and deadlines retained — PASS.** Native authentication precedes lane acquisition at `bdobb/crates/table-service/src/http.rs:58`; web identity/CSRF precedes admission at `bdobb/web/server.mjs:245`; gateway bearer validation remains before routing at `docker/funnel-gateway/server.mjs:560`, with relay identity validation retained in `tableExchange` at `:454`. The fix still invokes the existing bounded body/upstream/native handlers. New saturation tests verify unauthenticated and wrong-owner refusals, signed web identity, desktop gateway identity, web CSRF and invalid gateway relay assertions.
- **Permit release on terminal paths — PASS.** Web and gateway counters decrement in `finally` at `bdobb/web/server.mjs:288` and `docker/funnel-gateway/server.mjs:583`. Native owned permits remain scoped across `next.run(req).await` at `bdobb/crates/table-service/src/http.rs:80`, including future cancellation. Existing disconnect/body/upstream deadlines still terminate their work. New tests cover successful completion, errors, disconnect/future abort, deadlines, and reuse of both control slots; rejected ordinary requests acquire no permit.
- **Real saturation and native cancellation/publication fence — PASS.** Relay regressions hold four real upstream responses, admit controls, then hold exactly two controls and reject the third. Native held-body tests at `bdobb/crates/table-service/tests/http.rs:561` delete a real export, cancel and dispose the owned session while ordinary admission is full, then verify zero retained slots. The amended real-worker test at `bdobb/crates/table-service/tests/derivation.rs:597` proves ordinary HTTP refusal during a stopped native derivation, successful targeted cancellation, 409 on resumed output, no child publication, restored resource usage and successful subsequent work.
- **Deployment source pairing and qualification boundaries — PASS.** `docker/table-service/source.lock.json:3` pins source `1382c316d3838355a4366a163e63f280500d7284` and tree `d7c9a9a11122ea90b72925ca33363563c0dd81d4`; `bdobb/web/policy.vendored.json:3`, package metadata and qualification metadata consistently pair Docker `41641c684af4db1c6390ea682e5663daff331bfd`. Independently compared the exported native/web production files and amended Rust tests with the reviewed checkout: byte-identical. Independently hashed canonical policy and compared the vendored body: byte-identical, SHA-256 `c4d1a2bd75523d75b53a0cb579116ecf4e627210e6c8bd2196eb3deba672fc7a`. Image qualification remains explicitly UNQUALIFIED after prior ENOSPC.

### New Breakage in the Fix Diff

- **Critical: None. Important: None. Minor: None.**

### Out-of-Scope Observations

- **None.**

### Checks Reviewed

- **PASS — Scoped diff review.** Read the supplied fix packages for bdobb `e6bd7eba44a83b971bcbf313ef0913c8c101b651..46948da7b44f28964c7e265ae43ea769786249bc` and Docker `448339c97ffddc522876ab7a73f60725c38215f0..41641c684af4db1c6390ea682e5663daff331bfd`, plus directly relevant surrounding lifecycle code.
- **PASS — Stored regression evidence corroborates reported results.** Inspected RED logs (web/gateway 0/3, native cancellation 413 versus expected 200, native owner-handler admission failure), focused GREEN logs, and full-suite summaries: web 57/57, gateway 96/96, native service 72/72 including both new HTTP tests and the amended real-worker fence, final JS 8171 passed/29 skipped, browsers 4/4. Initial unchanged viewer failure and isolated 16/16 rerun remain disclosed.
- **PASS — Supporting evidence inspected.** Clippy/build logs show successful completion; header output is clean; final pairing test is 1/1; source-export/vendor logs name the matching revision, tree and policy hash. TypeScript, final ESLint and Compose logs are empty, consistent with the report's successful silent runs; their exit statuses are reported by the implementer rather than independently reconstructed here.
- **CHECK — No suites rerun.** Code inspection raised no specific unresolved doubt requiring a focused execution. Review performed read-only comparisons and log inspection; no repository changes, Git commands, live/auth probes, image build or deployment.

### Verdict

- **Spec compliance: PASS.** All scoped requirements are met by the implementation and covering evidence.
- **Quality verdict: PASS.** Small production changes preserve established routing and lifecycle behavior; independent bounded admission is exercised at every layer with actual requests and native workers.
- **Fix round: All findings addressed, no new Critical/Important breakage.** No open scoped findings. This verdict qualifies the source fix; it does not qualify the assembled production image.

<!-- Path keys: bdobb = /private/tmp/bdobb-table-ssrm-discovery; docker = /private/tmp/openbq-docker-table-ssrm-discovery. Evidence logs = /private/tmp/ssrm-control-fix-2026-10-15. -->
