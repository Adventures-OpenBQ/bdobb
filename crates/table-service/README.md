<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Managed native table HTTP service

The service runs on Linux with ICU4C 78.3, Node 26 and the built table-ingest
bundle. Every analytical session runs in `pivot-native-worker` with a hard
Linux address-space limit. macOS has no uncontained service fallback. The
browser/desktop client can connect to a Linux service.

Build the ingestion bundle from the repository root, then build both binaries:

```sh
node scripts/build-table-ingest.mjs
cargo +1.98.1 build --locked --release --manifest-path crates/pivot-native-worker/Cargo.toml --bin pivot-native-worker
cargo +1.98.1 build --locked --release --manifest-path crates/table-service/Cargo.toml --bin table-service
TABLE_SERVICE_CONFIG=/private/table-service.json ./crates/table-service/target/release/table-service
```

Install the complete SheetJS xlsx 0.20.3 package where the ingest bundle can
resolve it. See `server/table-ingest/README.md` and the worker crate README for
runtime packaging. The production container/gateway belongs to the deployment
integration; the qualification container is not a deployment image.

## Private configuration

`TABLE_SERVICE_CONFIG` names a trusted operator JSON file, maximum 1 MiB.
The final path must be a regular file, not a symlink. Keep it mode 0600 in a
private directory; it contains authentication credentials. Configuration and
errors are never echoed. Bind on a private interface behind an authenticated
gateway; the service does not provide TLS or browser cookie/CSRF handling.

Example (paths and credentials are operator values; numbers require workload
qualification):

```json
{
  "listen": "0.0.0.0:8080",
  "catalog_path": "/var/lib/table-service/sources",
  "catalog": {
    "limits": {
      "max_upload_bytes": 2097152,
      "max_parse_bytes": 8388608,
      "max_cache_bytes": 67108864,
      "max_input_rows": 20000,
      "max_output_columns": 256,
      "max_row_block_rows": 100,
      "max_export_batch_bytes": 1048576,
      "max_sessions_per_principal": 6,
      "max_concurrent_jobs_per_principal": 4,
      "max_session_seconds": 1800,
      "max_job_seconds": 60,
      "max_input_columns": 64
    },
    "backend_widgets": {
      "openbb": {
        "prices": [
          "symbol"
        ]
      }
    }
  },
  "auth": {
    "desktop_tokens": {},
    "gateway_token": "REPLACE_WITH_DISTINCT_RANDOM_TOKEN_AT_LEAST_32_BYTES"
  },
  "ingestion": {
    "node": "/opt/node/bin/node",
    "entry": "/app/server/table-ingest/dist/child.mjs",
    "backend_config": "/private/table-backends.json",
    "max_concurrent_children": 1,
    "max_child_heap_mb": 128
  },
  "worker": {
    "executable": "/app/bin/pivot-native-worker",
    "memory_budget_bytes": 536870912,
    "max_frame_bytes": 8392704,
    "max_starting_workers": 2
  },
  "runtime": {
    "compute_workers": 2,
    "max_admitted_jobs": 4,
    "max_sessions": 8,
    "max_retained_slots": 18,
    "max_retained_slots_per_principal": 16,
    "max_exports_per_principal": 3,
    "max_http_requests": 4,
    "max_command_bytes": 2097152,
    "body_seconds": 30,
    "total_memory_budget_bytes": 7516192768,
    "principal_memory_budget_bytes": 6442450944
  }
}
```

`catalog.limits` and `runtime` accept omitted fields with provisional defaults;
other configuration fields are explicit. Unknown fields refuse. The catalog
parent directory must exist. Private backend definitions must match the catalog
allowlist; their URLs/headers never appear in discovery. Set `backend_config`
to null and `backend_widgets` to `{}` when only uploads are enabled.

One WorkerConfig is built once and shared across all sessions. Its default
batch size is set to `min(max_row_block_rows, 500)`, with a minimum of 1. Its
frame budget must be at least `max_parse_bytes + 4096`. Startup reservations
remain charged even if process creation times out before reap.

Memory admission includes distinct reservations:

- Fixed global: shared worker startup headroom, 2 MiB owner/thread allowance per
  startup, configured parser V8 heaps times maximum children, and all admitted
  HTTP body buffers.
- Each admitted compute job: 32 times parse bytes for decoded parent structures
  and copies, twice upload bytes, and 16 times command bytes.
- Each retained input slot: `max_parse_bytes + 64 KiB` for boxed encoded JSON
  and ownership metadata. Boxing removes spare String capacity; encoding/boxing
  transient copies remain covered by the admitted compute job.
- Each native slot: one worker address-space budget, three IPC frame buffers,
  one cache budget and 2 MiB owner/thread allowance. Native worker limits are
  unchanged. Input, native and export slots all retain existing slot quotas.
- Each export: eight batch-byte budgets for cached/serialized parent buffers;
  its original native result keeps its existing slot alive.

These are deliberately conservative reservation rules, **not an RSS benchmark
or a proof of parent/Node allocator overhead**. The worker OS address-space
limit is enforced independently. V8 heap does not cap all Node external buffers;
deployment must additionally bound the whole service/container. Defaults are
provisional; no unlimited scale or production memory qualification is claimed.

## HTTP contract

Every route, including health/discovery, authenticates either:

- `Authorization: Bearer <desktop token>` configured to one principal; or
- `X-Table-Gateway-Token: <private service token>` and
  `X-Table-Principal: <authenticated principal>`.

Duplicate auth headers, mixed mechanisms, missing gateway assertions and
untrusted principal-only headers refuse. The gateway must strip client identity
headers and supply its private token. No tokens go in saved cards.

| Method | Path | Request and response |
|---|---|---|
| GET | `/healthz` | `{status:"ok"}` |
| GET | `/capabilities` | ProviderCapabilities, full native operation surface |
| GET | `/widgets.json` | `managed_table` descriptor, type `table_ssrm` |
| GET | `/sources/backends` | `{backends:[{backendId,label,widgets:[{widgetId,label,parameters}]}]}`; safe IDs only |
| POST | `/sources/uploads` | Raw bytes; `Idempotency-Key`, `X-Upload-Filename`, `Content-Type`; returns `{sourceId}` |
| POST | `/sources/backends` | `{idempotencyKey,binding:{backendId,widgetId,params}}`; returns `{sourceId}` |
| DELETE | `/sources/:id` | `{deleted:true}`; admitted sessions retain their snapshot |
| POST | `/sessions` | OpenSession below |
| POST | `/sessions/:id/commands` | Command below; returns Reply |
| POST | `/sessions/:id/derive` | DeriveSession below; returns a new transient OpenSession response |
| POST | `/sessions/:id/cancel` | `{targetRequestId?:string}`; returns `{cancelled:true}` |
| DELETE | `/sessions/:id` | `{disposed:true}`; kills workers and closes dependent exports |
| POST | `/sessions/:id/exports` | Command containing `presented`; returns `{exportId,batch:Reply}` |
| GET | `/exports/:id/batches?sequence=N` | Reply for the next sequence or cached latest retry |
| DELETE | `/exports/:id` | `{deleted:true}`; releases cursor/cache/result pin |

OpenSession:

```json
{"sourceId":"s_...","protocolVersion":1,"widgetId":"card-1","locale":"en-US","inputRevision":1}
```

Response contains `sessionId`, `sourceSnapshotId`, `capabilities`, `limits`, and
`expiresInSeconds`; no `resultId` until an apply succeeds. The absolute session
lifetime is not extended by activity. Cleanup runs every second and on opening a
session. Restart or expiration requires creating a new session from the saved
source reference. Unavailable sessions/results are never reported as zero rows.

Command:

```ts
interface Command {
  sessionId: string;
  sourceSnapshotId: string;
  resultId?: string;
  wire: string; // EXACT encodeRequest(1, request) output, not JSON.parse/stringify
  refresh?: { inputRevision: number };
}
interface Reply {
  sessionId: string;
  sourceSnapshotId: string;
  resultId?: string;
  wire: string; // pass to the existing decodeResponse codec
}
```

The inner numeric session handle is always **1**. Remote opaque identities stay
outside it. Preserve `wire` as text: JavaScript stringify of parsed structural
negative zero changes the definition. The service forwards native apply/read
wire text unchanged. Export transport IDs are private and are translated back
to the client's requestId/transferId without changing tagged cell semantics.

Every existing command is dispatched: inputSchema, applyModel, previewDefinition,
bindFormula, memberDomain, identityWitness, selection, rows, inspect, facets,
totals, chartData, presented, nextSubset, cancel and dispose. registerInput and
importFile refuse at the public boundary; use managed acquisition. Selection is
a pure action proposal; apply its returned SelectionSpec in a new applyModel.
Definitions and operations use shared pivot-wire/core validation. Exact counts
are admitted only with safe integer revision/count limits; source completeness
remains the acquired evidence, not an assertion of upstream completeness.

Apply requires strictly increasing **both** model and output revisions, with
nondecreasing input revision. Refresh adds `refresh:{inputRevision:N}`, where N
is newer than the published input, and the core request revision.input must be
N. It reacquires the persisted source and calculates in a fresh contained worker.
Only success publishes the new snapshot/result pair. Failure, timeout,
cancellation, disposal and supersession preserve the previous publication.

An exact latest successful apply retry (same wire bytes, original identity and
refresh fields) returns its cached reply and correlation. Same revision with
different content conflicts. A pending/failed/cancelled attempt reserves its
revision: retry with newer model/output revisions. Older delayed revisions cannot
win merely by arriving later. A response lost after the atomic commit may be
recovered with the exact successful retry.

Commands register their cancellation token before waiting for compute capacity,
so targeted cancellation also fences queued requests. Cancel/dispose use a
bounded HTTP control path independent of full compute admission. They invalidate
metadata synchronously before deferring process termination and cursor cleanup,
including when the blocking executor is saturated. Candidate native workers are killed/reaped through independent
WorkerControl. Already committed results are not rolled back. Parser acquisition
has its own bounded child deadline; cancellation can discard its result while
that child finishes. Admission remains held until background work ends. Native
worker RPC wall deadlines can terminate a failed published worker; clients then
receive unavailable/recreate errors. Kernel-uninterruptible process operations
retain the separately reserved startup capacity until reap.

Exports pin the original native result, including schema and selection. POST
returns sequence 0. Request only sequence 1 next, then 2, etc.; retrying the most
recent delivered sequence returns the same cached bytes. Skipped/older sequences
conflict. Use a fresh transferId for a new export. Exact presented retries include
all original wire fields (including ignoreSelection); changing them conflicts.
Raw presented/nextSubset commands use the same managed mechanism and retain the
original presented requestId. Initial batch retries validate owning-session
liveness and export expiry before returning the cache, even before periodic cleanup. A refresh/new apply does not change an export.
Failed/oversized transfers close their cursor and release export quota. A final
batch remains retryable and pinned until DELETE, cancellation, session disposal
or expiry. If a GET response is lost after advancing the native cursor, the
completed batch is cached so the same sequence can be retried.

### Linked result derivation

`capabilities.linkedDerivation:true` advertises `POST /sessions/:id/derive`:

```json
{
  "parent":{"sessionId":"session_...","sourceSnapshotId":"snapshot_...","resultId":"result_..."},
  "revision":{"widgetId":"parent-card","input":1,"model":2,"output":2},
  "requestId":"derive-unique-request",
  "protocolVersion":1,
  "widgetId":"child-card",
  "inputRevision":7,
  "locale":"en-US"
}
```

The authenticated principal must own the parent. Path/session, published result,
source snapshot, and every parent revision coordinate must match before the
result is pinned and the job is queued. No latest-result lookup occurs afterward.
The child locale is explicit and must pass the same native ordering contract as
an ordinary open. The operation consumes the **complete native presented subset
with selection honored**; no loaded page, group block, or caller row payload is
accepted. Native selection `none` means all eligible rows. Empty selections that
actually select zero rows still retain schema and metadata.

The response has only the ordinary `sessionId`, new `sourceSnapshotId`,
`capabilities`, `limits`, and `expiresInSeconds`. It has no rows, wire, result ID,
or durable source ID. Internally the first subset's schema, completeness,
freshness, diagnostics, model warnings and provenance are preserved, adding the
parent widget/model/output coordinate to lineage exactly as `subsetTransfer.ts`.
Ordinary native registerInput inference may supply column dtypes, just as on the
local linked path. No calculated internal state is serialized.

The child owns an encoded transient input and a separate OS-contained worker.
It can apply independent definitions and derive further children. Later parent
refresh/source deletion cannot change the admitted subset; parent disposal or
expiry cancels pending work. After successful publication, parent disposal has
no effect on the child. Child deletion/expiry releases its input and workers.
A child's direct source refresh refuses: derive a replacement child from a new
parent result instead. Saved cards retain their existing parent-card reference
and definition; runtime child IDs never become saved source references.

Before accumulation, existing global/principal job-memory reservations, retained
input slot, export/cursor slot and global/principal session reservation must all
succeed. Pending opens count toward session admission. Each native batch is
limited by `min(max_row_block_rows,500)` and `max_export_batch_bytes`. Sequences
are contiguous from zero, non-final batches must advance, total rows cannot
exceed `max_input_rows`, columns cannot exceed `max_input_columns`, and at most
`max_input_rows + 1` batches are attempted. **Both cumulative native response
bytes (including batch metadata) and final encoded source bytes** must fit
`max_parse_bytes`. Thus many tiny batches can conservatively refuse earlier than
the final source size alone suggests. Parent accumulation remains covered by the
existing job reservation (`32 * max_parse_bytes` plus upload/command allowances).
The child worker additionally passes existing slot, memory and startup admission.
All cursor/slot/session/job reservations use RAII cleanup.
The core row-block heap estimate is bounded by `max_cache_bytes`, separately
from the encoded export batch cap `max_export_batch_bytes`. Both checks remain
active; the worker address-space limit bounds transient native allocations.

Cancel with `POST /sessions/:parentId/cancel` and this operation's `requestId`.
The pending request is registered before waiting for compute capacity. Existing
job deadlines, request-drop fencing, parent expiry/disposal and shutdown apply.
Routine cancellation and the service job deadline fence child publication while
a bounded in-flight parent RPC may finish; admission remains held until cursor
cleanup. They do not kill the shared parent worker or its other exports. The
worker's own hard RPC deadline can still terminate a genuinely hung parent;
clients must reopen if that exceptional native failure makes it unavailable.
Quota/oversize refusal also preserves the parent's worker.
No mutation retry is implied. A lost response can leave a transient child until
its absolute expiry; deleting a known returned child is the explicit cleanup.

Frontend integration: managed `ProviderSession.deriveLinked?(parentRevision,
{protocolVersion:1,widgetId,locale,inputRevision,signal?})` returns the child
`ProviderSession` through the same authenticated bounded transport and negotiation
validator, including `rowBlockLimit` and snapshot consistency. Older managed and
standard LIVE providers omit the optional capability/method; consumers must
refuse unsupported remote derivation. Local linked execution is unchanged.
Abort/dispose and failed derivation transport send independent targeted cancel;
malformed known child sessions are deleted. Child transport limits inherit the
provider configuration and are intersected with the child's negotiated limits.

HTTP admission reserves **two simultaneous control requests**, independently of
`max_http_requests` ordinary slots. Only exact, query-free
`POST /sessions/:id/cancel`, `DELETE /sessions/:id` and `DELETE /exports/:id`
use them (IDs are 1–128 ASCII letters, digits, `_` or `-`). Authentication
precedes admission and resource ownership is still checked by each handler.
Source deletion, commands, derivation and export creation use ordinary admission.
A full lane returns the existing 413 `limit_exceeded`; it cannot borrow from the
other lane. The permit lives through handler completion and releases on error,
body deadline or request-future drop. Existing body, job and worker deadlines
continue to apply. The gateway and web relay independently reserve two slots too,
and apply a separate finite request-rate allowance to control traffic.

Transport errors are `{error:{code,message}}`: 400 invalid input, 401 auth,
404 source/route/method unavailable, 409 identity/revision/sequence conflict,
410 unavailable session/result, 413 resource/deadline admission, 500 sanitized
configuration/storage failure. Foreign and nonexistent IDs are indistinguishable
within each resource type. Core semantic diagnostics remain correlated wire
responses (HTTP 200). Export inability to produce a bounded subset returns 413.

## Verification

Linux service tests require the built ingest bundle, Linux Node, ICU and a real
worker binary. No fake analytical outputs or macOS worker fallback are used:

```sh
TABLE_INGEST_NODE=/absolute/linux/node \
TABLE_NATIVE_WORKER=/absolute/pivot-native-worker \
cargo test --offline --locked --manifest-path crates/table-service/Cargo.toml
cargo clippy --offline --locked --manifest-path crates/table-service/Cargo.toml --all-targets -- -D warnings
```

HTTP tests use Axum's in-process routing with real Node/native child processes;
the binary smoke test also opens an actual loopback listener and sends SIGTERM.
The shared worker/native semantic suites are maintained separately. Deployment,
container resource sizing and gateway integration remain separate qualification.
