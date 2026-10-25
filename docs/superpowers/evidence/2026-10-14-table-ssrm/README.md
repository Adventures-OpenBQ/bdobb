# Table SSRM qualification

Plan date: 2026-10-14. Executed: 2026-10-15, macOS arm64 host / Linux arm64 native runtime.
The native browser workflows pass in Chromium and WebKit. **The assembled Docker
image remains unqualified**, and the bounded control-admission fix awaits the
controller's scoped independent review. Machine-readable commands, results, source hashes and measurements are
in [qualification.json](qualification.json). [decisions.md](decisions.md) preserves
every `Ruling:` line from task progress before scratch cleanup.

## Source and reproduction

Native source: `1382c316d3838355a4366a163e63f280500d7284`, tree
`d7c9a9a11122ea90b72925ca33363563c0dd81d4`. Paired Docker configuration:
`41641c684af4db1c6390ea682e5663daff331bfd`. This source includes the bounded two-slot control
admission fix at the web relay and native HTTP service; the paired canonical gateway
uses the same exact control route classification. The later evidence commit updates
pairing metadata without another native source repin.
The exact exported archive SHA-256 is
`b03dc334387d53b907cb9f3a83358747b5414f7c927135ee6a6ec9a17a1c2770`.
Dockerfile SHA-256 is unchanged:
`41c59cdcc8a4576e028d46fd5eba00508201cb69a5f88b05d0658b07a1dd70b8`.
Canonical gateway policy SHA-256 is
`c4d1a2bd75523d75b53a0cb579116ecf4e627210e6c8bd2196eb3deba672fc7a`;
`package.json` and `web/policy.vendored.json` name the exact paired Docker commit.
Previous task11 and final filename/cleanup-wave provenance and observations remain
recorded separately in the JSON. See [control fix evidence](control-admission-fix.md)
for fresh results and every RED/intermediate failure.

Build the ingestion bundle and Linux service/worker with locked dependencies,
Rust 1.98.1 and ICU 78.3. The test host uses a task-owned host-backed Linux root
(`/private/tmp/bdobb-worker-linux-root`) and Cargo target
(`/private/tmp/bdobb-worker-linux-target`). The root contains `/usr`, `/var`, `/etc`
and `/root/node-v26.10.0-linux-arm64`. It is a local storage workaround, not a
redistributable artifact. With those prerequisites and Playwright browsers:

```sh
pnpm table-ingest:build
TABLE_QUAL_LINUX_ROOT=/private/tmp/bdobb-worker-linux-root \
TABLE_QUAL_LINUX_TARGET=/private/tmp/bdobb-worker-linux-target \
TABLE_QUAL_GATEWAY=/private/tmp/openbq-docker-table-ssrm-discovery/funnel-gateway/server.mjs \
TABLE_QUAL_EVIDENCE_DIR=/private/tmp/task11-ssrm-final-pass-evidence \
pnpm test:ssrm:browser
```

`scripts/ssrm-native-harness.mjs` creates only its own randomly named container,
private catalog/config, random ports and credentials; removes them on completion;
and never uses user accounts. It signs encrypted synthetic GitHub 42/43 sessions
using the real web authentication path. Browser HTTPS calls traverse the actual
web relay, canonical gateway, Linux HTTP service and native WorkerSession. The
harness maps the test gateway origin to loopback and serves source UI modules
through Vite. Filesystem/dialog shims hold dashboard persistence and exported
files. No compiled-Wasm analytical fixture substitutes for this native path.

Separately, the real built web HTTPS/auth smoke passes on Node 22.16.0, with its
explicit synthetic edge gateway. The task11 run passed all 54 web tests on that deployment runtime;
the task11 canonical gateway run passed 93 tests on Node 26.10.0. The Node 22 official archive checksum
was checked against its official SHASUMS file. These checks do not imply a cloud
deployment or GitHub OAuth roundtrip.

## Browser evidence and measured scope

All 4 native cases pass in 46.6s: Chromium resources 8.0s/consumers 12.5s;
WebKit resources 10.3s/consumers 13.9s. The cases cover:

- Actual UI CSV upload, visible native rows, saved durable source and hard reload.
  The 1,205 × 4 source produces1,204 selected rows after excluding a row beyond the
  first page. Full chart and linked consumers see all 1,204 selected rows.
- Actual card menu linked-table and chart creation, Plotly 1,204 points, and CSV
  menu export with 1,205 eligible rows plus header. Existing card export ignores
  selection deliberately; selected chart/linked operations honor it. A second
  linked descendant is created through the dashboard action and both descendants
  reopen after hard reload. Saved files contain no live session IDs.
- A presented stream admitted before refresh finishes all 1,205 rows after reopen.
  The stream and off-page selection are driven through the actual browser store
  and executor APIs; chart/link/export menu interactions are actual UI actions.
- A 2,005 × 8 source loads 21 pages using production `useTableResult`. Requested 9,999
  rows are clamped to 100. The 12-block cache evicts older pages and retains 1,105
  rows, with maximum block 100. A three-team pivot is applied through the store;
  keyboard expansion works, child offset 600 returns rows, and full-scope mean is 1,003.
- Registered standard LIVE SSRM uses a synthetic 1,200 × 2 upstream HTTP provider
  through the real relay/gateway. Actual Next page actions reach the last 100 rows;
  snapshot-only export is absent. This is protocol/UI qualification, not approval
  of any external vendor endpoint.
- Native oversized upload returns 413; negotiated row 101 is refused by the remote
  executor before HTTP. A fresh signed foreign owner cannot reopen the source
  (404). Light theme, keyboard focus and 390 × 844 narrow viewport are exercised;
  the WebKit screenshot was visually inspected with visible rows and controls.

Peak bytes below are from the successful final runs. Process figures are maximum
observed `/proc` VmHWM, sampled every second; they can miss an exited short-lived
worker. Container figures are cgroup `memory.peak`, which includes parser and page
cache allocations. Parser maxima come from actual Node `resourceUsage()` at exit.

| Run | Parent HWM | Worker HWM | Container peak | Parser maxRSS |
| --- | ---: | ---: | ---: | ---: |
| Chromium resources |46,686,208|46,919,680|185,348,096|98,716 KiB|
| Chromium consumers |37,609,472|26,017,792|186,900,480|80,632 KiB|
| WebKit resources |46,874,624|47,194,112|188,260,352|98,804 KiB|
| WebKit consumers |37,048,320|26,906,624|185,589,760|80,236 KiB|

Host Node sampled RSS ranged up to 536,911,256 bytes. That process includes Vite,
web relay, gateway and the test driver outside the native container; it is not an
isolated gateway memory benchmark. Browser heap was not measured. The browser
request/cache bounds above are directly asserted. No million-row claim is made;
20,000 rows in the sample config is an admission ceiling, not tested capacity.

For 2,005 × 8, session opening took768–923ms; model application maxima341–463ms;
row request medians46–47ms (WebKit max272ms). For 1,205 × 4, chart maxima133–149ms,
derive maxima419–447ms, export-batch maxima37–43ms. Timings measure relay-to-gateway
response headers; the gateway buffers each native response before publishing it.
They exclude paint time and are local debug-binary observations, not latency SLAs.
Full per-operation counts/medians/maxima appear in the JSON evidence.

## Resource decisions and refusals

The configurable sample profile is 8 GiB container, 7 GiB global reservation,
6 GiB principal reservation, 2 compute workers, 4 admitted jobs and 4 HTTP exchanges.
It allows 6 sessions per owner / 8 globally, 18 retained slots / 16 per owner, 3 exports
per owner, 2 MiB uploads, 8 MiB encoded sources, 64 input / 256 output columns, 100-row
blocks, 1 MiB encoded export batches, 64 MiB retained-result estimates and one 128 MiB
V8-heap parser. Actual worker hard RLIMIT_AS stays 512 MiB. Node heap is not a total
process-memory bound; the container cap covers native/parser external allocations.

Two real qualification failures led to typed accounting corrections, not removal
of safety limits:

1. An Input owns boxed JSON, not a worker. It now reserves 8 MiB + 64 KiB metadata in
   this profile. Native results retain their full 512 MiB + three frames + 64 MiB cache +
   2 MiB thread reservation (~602 MiB). Encoding/boxing peaks stay behind the job
   transient reservation. Original and derived inputs use the same kind; checked
   arithmetic, slot quotas and RAII cleanup remain. The regression proves exact
   original/derived accounting and returns to baseline after disposal.
2. The 1 MiB export wire cap was mistakenly used as the core row-block heap budget.
   A real 100 × 8 native row request returned RESOURCE_LIMIT. Core block heap now
   uses the bounded 64 MiB cache budget, while encoded export remains 1 MiB. The
   exact 100 ×8 test fails before and passes after the fix; a 4,096-byte configured
   wire-cap regression still refuses a 5,000-character export row and releases it.

An earlier two-job owner profile refused ordinary concurrent UI work; four jobs
support the measured automatic row/totals/linked activity. Earlier 12 GiB runs were
intermediate and are not final evidence. Correct input accounting enables the
final 8 GiB hard-reload chain without serialization to mask automatic UI concurrency.
A 16 MiB result budget refused 2,005 × 8. Even at 64 MiB, a nested team+unique-region pivot
refuses retained state; ordinary three-team grouping passes. These refusals remain
explicit. Operators must size for their shapes and concurrent sessions. Hard reload
may leave abandoned sessions until TTL and consume admission; close unused work,
wait for expiry, or review all configured limits together. Mutations do not retry
automatically, and no unbounded fallback is enabled.

## Verification and limits

Task11 Rust checks passed: core 163, wire 6, native 8, worker 26 and service 68;
Wasm host compilation passes (no host unit tests), with 16 actual Wasm browser
checks. Strict service clippy, TypeScript, lint, desktop/web bundles, packaging,
fingerprint, notices and header checks are recorded in the JSON. The task11 full JS sweep passed 8,170 tests with 29 skipped (450 files passed,
6 skipped) in 87.65s. Final desktop and web bundles build in 28.19s and 14.46s. Earlier full sweeps found the managed
widget lookup escaping its error boundary, a missing `clearManagedSource` mutation
classification, and stale help-copy assertion; all are corrected and their focused
regressions pass. Existing React act and jsdom canvas warnings and Vite large-chunk
warnings remain baseline. The new browser runner removes inherited NO_COLOR before
Playwright sets FORCE_COLOR. No broad warning rewrite was made.

The native portable smoke verifies upload, foreign-owner/spoof refusal, 5-row linked
derivation, 2-row batches, restart/reopen, expired old sessions and two workers with
hard 512 MiB RLIMIT_AS. The browser container runs non-root host UID 501 with read-only
root, private config/catalog, 8 GiB cgroup cap and the actual healthcheck script.

The pinned Docker image build previously failed at apt because the Docker VM had
insufficient space/damaged overlay storage. The unchanged failure was not retried;
no unrelated image/cache/volume was pruned. The equivalent runtime does **not**
qualify assembled image layers, image UID 10001, named-volume initialization or
release binaries. Physical iPad/iOS, Windows/Linux desktop and packaged Tauri
native dialogs were unavailable/not run; desktop macOS WebKit is not an iPad test.
Final-review coverage now stops the actual parent worker, confirms queued RPC bytes,
cancels while dispatch is outstanding, resumes the worker and verifies no child
publication, parent usability and fully reclaimed admission. Independent whole-branch and scoped fix reviews are complete; see [final review](final-review.md). Nothing was pushed, deployed, or changed in a live stack.


## Final review fixes and verification

The HTTP boundary decodes UTF-8 percent-encoded filenames exactly once before
catalog basename validation. Regression tests roundtrip a184-byte Unicode filename,
preserve literal percent escapes and reject malformed encoding/unsafe decoded names.
Harness cleanup attempts each resource even when evidence writing fails and preserves
the startup error. Three real-container fault-injection cases pass and exit naturally.
The resource browser now asserts the numeric revenue aggregate equals1003.

The final full Linux service suite passes70 tests. The stable-path full JS sweep
passes8171 tests/29 skipped in88.47s (450 files passed/6 skipped). All4 actual native
Chromium/WebKit browser tests pass in1.2m; strict service clippy, types and amended JS
lint pass. The first full JS attempt cached the Node-only fixture's old filename
while it was renamed; that single suite-loading failure is preserved in the log,
and the subsequent stable-path run is green. No analytical fallback was introduced.

The measurement table and original command entries above remain task11 observations
at the explicitly recorded `task11_measurements_source` in the JSON. Final acceptance
logs and raw browser evidence are recorded under `final_review_fix_wave`; this does
not reclassify older measurements as measurements of the new source. Production
image qualification remains blocked by the prior ENOSPC; no retry or pruning occurred.


Independent whole-branch review found no Critical or Important issues. Its minor
findings were fixed in one combined wave and independently re-reviewed: all
addressed, no new breakage. See [final review](final-review.md).


## Saturation-safe control admission follow-up

Each HTTP layer now reserves two simultaneous authenticated cancellation/disposal/
export-cleanup requests independently of ordinary traffic. Web control requests
have a finite 240/minute per-user allowance; gateway control requests have an
independent `requestsPerMinute` allowance. Source deletion, derive, commands, export
creation, LIVE and malformed routes retain ordinary limits. Existing body, deadline,
identity, CSRF and ownership rules remain. Exact route and fixed bounds are
specified in the service/gateway README files.

New actual loopback relay tests prove ordinary saturation still admits controls,
the two-control cap refuses excess work, rate consumption is independent and finite,
and success/error/disconnect/deadline paths reclaim admission. Native HTTP tests
prove owner/auth refusals and actual export/session disposal while ordinary requests
are held. A real stopped native derivation fills the sole ordinary HTTP slot;
control cancellation succeeds, fences child publication and restores resource usage.

Fresh checks pass: Node22 web57, canonical Node26 gateway96, Linux service72,
strict Clippy/types/amended lint/headers, exact source export, Compose config and
four native Chromium/WebKit browser cases42.8s. The first full JavaScript sweep had
8170 passed/29 skipped and one unchanged viewer popup test failure. Its isolated
file rerun passed16 tests. A controller-authorized final whole sweep with no
concurrent native/browser work passed8171/29 skipped (450 files passed/6 skipped)
in80.31s. Both whole-sweep logs and isolated evidence are retained.

The assembled production image remains **UNQUALIFIED**. No build retry, pruning,
push, deployment, merge or unrelated UI change occurred. Scoped independent review
belongs to the controller. Full commands/results are in
[control-admission-fix.md](control-admission-fix.md).


Independent scoped review of the control-admission fix passed: all findings
addressed, no new breakage. [Review record](control-admission-review.md).
