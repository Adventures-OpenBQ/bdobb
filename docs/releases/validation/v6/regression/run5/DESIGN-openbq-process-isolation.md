# Design: running heavy OpenBB routes in separate processes in openbq-docker (D8)

Status: **design proposal, awaiting approval.** Nothing has been implemented, pushed or deployed. Written 2026-10-09 at the user's request (decision D8 in `PROPOSAL-openbq-docker-fixes.md`). It builds on G5 there and does not replace it.

Inputs:
- `PROPOSAL-openbq-docker-fixes.md` (G5 and the CFTC review), `README-services.md`, `manifests/services.md`, `backend-sweep/failures.tsv`;
- the CFTC session's G5 assessment and its D8 reply (§9);
- openbq-docker `v3.0.0` (`071ae7a`): `provider-fixes/openbb_core/app/command_runner.py` (per-provider loops, cftc/cboe locks) and `provider-fixes/openbb_core/api/router/commands.py`;
- `openbb_cftc/utils/store.py` read from the local `openbq-local:3.0.0` image;
- local measurements (§2).

## 1. Problem

The API is a single `openbb-api` process. Since `239db5a`/`cf62ff5`, each provider's commands run on that provider's own event loop in a thread. Three things still run on, or starve, the server loop.

1. **Serialisation runs on the server loop.** The `commands.py` wrapper calls `output.model_dump(...)` and `jsonable_encoder` after `wrap_future` returns. FastAPI's `JSONResponse` then calls `json.dumps`, also on the server loop.
2. **GIL contention.** CPU-bound provider threads hold the GIL, which slows every step the loop takes.
3. **No cancellation.** When a client gives up, the server still finishes the work and serialises the result. A backlog of abandoned heavy requests drains through the loop.

Run 5: with 3 concurrent sweep workers, CFTC took 40–60 s per call. Then `apps.json` timed out from about 12:35 to 12:48, and the service recovered without a restart. G5's per-provider deadline frees queued CFTC work at its next await. It cannot interrupt synchronous CPU work and does nothing for serialisation on the server loop. Process isolation fixes both.

## 2. Measurements (Mac arm64, Docker 4 CPU, `openbq-local:3.0.0`, `--network none`)

Scripts and raw output are in this session's scratchpad (`d8/measure.py`, `d8/gil.py`, `d8/thread.py`, `d8/results.txt`). The payload is a synthetic FINRA-bond-shaped `OBBject` with 300,000 rows, which serialises to **134 MB** of JSON. The calls are the ones `commands.py` and `JSONResponse` make.

| Where serialisation runs | Serialise time | Longest server-loop pause |
|---|---|---|
| On the server loop (today) | 9.4 s | **13.0 s** (building plus serialising) |
| `asyncio.to_thread` | 9.8 s | **1.07 s** (p99 33 ms) |
| Spawned worker process; parent streams back 1 MiB chunks | 9.9 s in worker; stream-back 0.03 s | **0.16 s** |

- **Memory.** Serialising peaks at about 950 MB in whichever process does it. The parent stays at 25 MB when a worker serialises.
- **Platform import.** Importing `openbb_core.api.rest_api` in a fresh process takes **27.6 s and 890 MB RSS**. That is the fixed cost of every worker process.
- **GIL test.** Pure-Python CPU threads stretch the loop's 5 ms sleeps:

  | CPU threads | p50 | p99 |
  |---|---|---|
  | 0 | 1.7 ms | 3.3 ms |
  | 1 | 8.9 ms | 24.6 ms |
  | 3 | 16.4 ms | 101.5 ms |

  That slows routes but does not freeze them for minutes. A C section that holds the GIL (for example a pydantic-core dump or `json.dumps`) does freeze the loop for its whole duration.
- **Reading.** These figures are from the Mac. The NAS is slower, so they are lower bounds there. The 13-minute wedge fits "a backlog of abandoned results, each serialised on the server loop" better than "GIL contention alone", but **this is not measured on the NAS** (objection f, §9).

## 3. Selection rule: a static `(provider, route)` allowlist, with a result-size cap as backstop

A cost estimate cannot work, because cost is known only after a route runs. A result-size rule has the same problem: by the time the size is known, the work has already happened in process. So the rule is a configured allowlist (`OPENBQ_ISOLATE`), decided per route:

| Route | Decision | Reason |
|---|---|---|
| All `openbb_cftc` commands (`cot*`, `swap_*`, `historical_fixings`, `ois_*`, `fx_*`, `cds_index_trades`); not the `*_choices` or `cftc_apps` helpers | **Isolate**, one lane | Measured offender (CPU, 40 MB forex responses). One lane keeps a single shard writer and the existing one-at-a-time order. |
| FINRA `fixedincome/bonds` (`provider=finra`) | **Isolate** | Measured offender. Non-default `bond_type` (CA) returns about 150 MB. |
| TMX `derivatives/options/covered_calls` | **Phase 2 candidate.** Isolate if the §6 harness shows `widgets.json` above 1 s while it runs. | Wedged the API in the v3 sweep (CFTC session). Not measured here. |
| FFIEC `institution_structure` | **Phase 2 candidate**, same test | 159 MB response, so a serialisation offender |
| OECD dataflows | **Not isolated.** Open question Q5. | A ~1.5 GB process-lifetime singleton: memory, not loop time. Isolating it means a permanent 1.5 GB-plus worker or a reload on every call. |

Everything else stays in process, protected by G5. As a backstop, a response over `OPENBQ_MAX_RESULT_BYTES` (proposed 256 MB) is refused with a clear 413 rather than shipped (Q4). Pagination is out of scope because it changes the client contract.

## 4. Mechanism

### 4.1 Options

| Option | Fits the NAS? | Verdict |
|---|---|---|
| `ProcessPoolExecutor` | A killed worker marks the whole pool broken and fails every pending future. There is no per-task kill. Results are pickled back into the parent, which then still serialises on its loop. | Reject |
| Spawn per request | 27.6 s and 890 MB of import per call, and warm caches are lost every time (cold forex is 76–92 s versus 43–55 s warm). | Reject |
| `forkserver` per request | Starts fast, but in-memory warm state is still lost per call. | Reject |
| Multiple uvicorn workers (`[launcher] workers=4`) | Already tried by the CFTC session: 4 workers ran out of memory on the Mac, the NAS had about 3.5 GB free, a stall still blocks whichever worker it lands on, and the CFTC lock becomes per process. | Reject |
| Separate worker container | Cleanest isolation, but it needs a second 1.25 GB baseline and compose changes on the NAS. Behind the single tailnet Serve endpoint, the API must proxy to it anyway. | Fallback if in-container lanes fail |
| Job queue (Redis/RQ/Celery) | New infrastructure, and async job polling the client does not speak | Reject |
| **In-container worker lanes (recommended)** | Same image, same port, same Serve endpoint. Pure Python, so it runs on arm64 and amd64. | **Proposed** |

### 4.2 In-container worker lanes

- **A lane is one long-lived child process.** It runs the **same app** (`openbb_core.api.rest_api:app`) under uvicorn on a Unix socket (`/run/openbq/<lane>.sock`), with `OPENBQ_ROLE=worker`.
  - It is spawned **eagerly at startup** (objection a).
  - Default lanes are `cftc` and `finra`, at concurrency 1 each.
- **An ASGI middleware in the main process matches the allowlist.** It matches on path plus the `provider` query parameter and forwards the **raw request** (method, path, query, headers, body) to the lane with `httpx` over the socket. `httpx` 0.28.1 is already in the image. The middleware streams the response back unchanged.
- **Same code, no re-implementation.** The worker runs the identical route, command-runner, encoder and `validate_output` code, so the response is byte-identical by construction. This answers objection b; the contract test in §6 still enforces it.
- **The main loop only copies chunks.** No `OBBject` crosses the process boundary; in §2's run the stream-back took 0.03 s.
- **Supervision.** The main process owns its children: it reaps them, respawns a dead lane, and passes signals through.
- **Init.** No compose change is needed. `init: true` is optional (Q7).

## 5. Deadline, cancellation, back-pressure, budgets

### 5.1 Two deadlines, G5 inside

- **Soft deadline (G5, unchanged, inside the worker).** The worker's own `command_runner` keeps G5's per-provider `wait_for` on the wrapped future. It cancels the task at its next await, releases the cftc lock, and returns 504.
- **Hard deadline (parent).** At soft deadline plus grace (proposed +15 s), the parent sends **SIGKILL** to the lane, returns 504, and respawns the lane.
  - This is the only thing that can stop synchronous polars or pandas work.
  - The CFTC soft deadline must exceed measured **cold** time with margin, or every call after a kill runs cold and is killed again (objection a). Cold forex is 76–92 s on the Mac and unmeasured on the NAS, so the proposal is a **150 s CFTC soft deadline**, to be confirmed by measurement (Q2).

### 5.2 Kill policy

- **Kill only at the hard deadline.** A client disconnect does not kill a lane: the run-5 harness gave up at 60 s, below CFTC's deadline, and a kill on disconnect would keep the lane permanently cold.
- **Recycle on memory only, never on call count** (objection a). After a call, if the lane's RSS exceeds its cap, it is restarted while idle.
- **Respawn cost.** A respawn costs one platform import (27.6 s on the Mac). Requests that arrive meanwhile wait in the queue.

### 5.3 Back-pressure (objection c)

- **Today's queueing is kept.** A request for a busy lane **queues** in the parent, so a second CFTC call still succeeds, as it does today.
- **503 only when the wait itself fails.** A queued request gets 503 with `Retry-After` only if its own deadline passes before it starts, or if the queue is over `OPENBQ_LANE_QUEUE_MAX` (proposed 16).
- **The harness must know the new statuses.** BDOBB, Workspace and the regression harness see a new 503/504 class only where today they would hang. The sweep classifier needs both statuses (§7).

### 5.4 Shard safety

- **Cross-process corruption cannot happen.** `store.py` writes `{path}.tmp{os.getpid()}` and then calls `os.replace`, and the other CFTC caches are `diskcache`/SQLite, which is process-safe. The corruption seen so far was two **threads** in one process sharing a temp name.
- **What remains is lost updates.** The search-shard merge (`write_search_records`) is a read-modify-write, so two writers can lose updates.
- **With one CFTC lane, no flock is needed** (objection d). If Q3 ever approves more than one CFTC lane, it needs:
  - a per-shard `fcntl.flock` around `write_search_records`;
  - a temp name unique per pid **and** thread.
- **Orphan sweep.** On lane spawn, delete `record_shards/*.tmp*` orphans left by a SIGKILL.

### 5.5 Memory and CPU budget

- **Per-lane memory.**
  - Each lane costs 890 MB to import.
  - The CFTC lane is estimated at 1.7–2.0 GB peak. That is inferred from whole-container figures, **not measured per worker**, and the CFTC session explicitly calls 1.7 GB a guess.
  - The FINRA lane is estimated at about 1.9 GB peak during a CA serialise.
- **Net added memory.** The main process sheds the working sets these routes used, so the net addition is about 1.8 GB of import baseline, with a peak near 3.6–4 GB above today.
- **This is tight.** The CFTC session saw about 3.5 GB free on the NAS. That is why per-lane RSS caps are config, and why Q1 asks for the real free-memory figure. Q1 also offers a single shared `heavy` lane for CFTC and FINRA as the low-memory option (about +2 GB; FINRA then queues behind forex).
- **CPU.** One lane is one core at most, so the main loop keeps the rest.

## 6. Observability and testing

### 6.1 Observability

- **Request log.** One line per isolated request: lane, route, provider, `queue_ms`, `run_ms`, bytes, status, outcome (`ok`, `soft-504`, `killed-504`, `queue-503`), worker pid, and RSS after the call.
- **Loop-lag monitor.** The main process logs any loop gap over 250 ms. This is the wedge alarm.
- **Status endpoint.** An authenticated `GET /openbq/lanes` returns each lane's state, queue depth, pid, RSS, restarts and last kill.

### 6.2 Order of work (objection f)

1. **Measure first.** Run the CFTC session's queued run-5 replay with `py-spy` dumps, after the v5 OPENBQ all-clear. Plus the local split test: the same replay with only FINRA CA, then only CFTC.
2. **Let the split set the order.**
   - If serialising on the server loop dominates, ship Phase 0: `asyncio.to_thread` serialisation for all routes, which cut the 13 s pause to 1.07 s in §2. Then build the lanes.
   - If GIL-holding CPU work dominates, build the lanes first. Phase 0 is a broad edit to `commands.py`, so it goes through the same contract test.

### 6.3 Tests (all local; none against OPENBQ_API or the NAS)

1. **Contract test (objection b).** For every allowlisted route, run with `OPENBQ_ISOLATE` on and off and compare status, `content-type` and the body's sha256. Every route must be byte-equal.
2. **Wedge reproduction.** Extend `scripts/verify-cftc-responsive.py` (on `v3.0.0`).
   - Replay run 5's 5 stall widgets with their run-5 parameters, 3 concurrent clients with 60 s client timeouts, for 15 minutes.
   - Poll `apps.json` and `widgets.json` every second throughout.
   - Run it at `--cpus 2` as well as unconstrained, to approximate the NAS.
   - **Baseline:** the `v3.0.0` image must show probe stalls over 5 s, which shows the harness reproduces the wedge. Record how long they last; the Mac may not reach 13 minutes.
3. **Kill test.** A test-only command spins synchronous CPU for 300 s.
   - It must return 504 at the hard deadline.
   - The lane must be respawned, with no orphan process and no `*.tmp*` files left.
   - The next CFTC call must succeed.
4. **Memory soak.** `swap_trades` forex ×5, then FINRA CA ×5: the lane's RSS stays flat, and the container peak is recorded against Q1.
5. **Full sweep.** The 995-widget sweep: identical statuses to the baseline except upstream flakes.

### 6.4 Acceptance numbers

- During test 2 on the candidate, `apps.json` and `widgets.json` have p99 < 1 s and max < 2 s, including while FINRA CA serialises.
- No request is still in flight past hard deadline + 5 s.
- CFTC defaults succeed as in run 5 (7/40/45 s class), and a queued second CFTC call succeeds when it finishes before its deadline.
- Respawn time and per-lane peak RSS are recorded, and they are within the Q1 budget.
- Contract test: 100 % byte-equal.

## 7. Rollout

- **Home line.** openbq-docker `release/v3`, as a point image `openbq-local:3.0.x`. The x is set with the G1–G5 batch label (Q6).
- **Code shape.**
  - A new overlay module holds the lane supervisor and the middleware, hooked in through the existing hash-checked `provider-fixes` mechanism.
  - The G5 guard stays in `command_runner.py`.
  - Feature flag: `OPENBQ_ISOLATE` set to empty means today's behaviour.
- **Carries.**
  - `v4.0.0` and `v5.0.0` are the same commit as v3, so they need new point tags on the same build. **Existing tags are never moved.**
  - `release/v6` first needs the 13 missing commits that the proposal's §4 lists.
  - v1/v2: no; there is no core overlay there.
- **Regression risk.**
  - The official runs measured image `35011a55`. A new image changes timings and adds 503/504 outcomes, so it must not reach the NAS during the freeze or under an in-flight run.
  - The sweep classifier needs `ISOLATION_DEADLINE` and `ISOLATION_BUSY` dispositions before the next run uses the image.
  - The flag ships **off** until tests 1–5 pass locally.

## 8. Open questions for the user

1. **Q1. Memory budget.** How much memory is actually free for the API container on the NAS, and what `mem_limit` applies? Should there be two lanes (cftc and finra, about +1.8 GB baseline, peak +3.6–4 GB) or one shared `heavy` lane (about +2 GB; FINRA queues behind forex)?
2. **Q2. CFTC deadline.** Accept a 150 s CFTC soft deadline plus 15 s grace, pending a NAS cold-forex measurement? Users would wait up to 165 s before a 504.
3. **Q3. More CFTC lanes.** Allow more than one CFTC lane later? That needs the search-shard flock and a per-thread temp name, as an overlay of `store.py` or upstream.
4. **Q4. Size cap.** Refuse results over 256 MB with 413, or send them whatever their size?
5. **Q5. OECD and Phase 2.**
   - OECD dataflows' 1.5 GB singleton: leave it in process, or give it its own lane?
   - TMX covered_calls and FFIEC institution_structure: include them now, or only if the harness confirms?
6. **Q6. Version and batch.** Ship D8 in the same `3.0.x` image as the G1–G5 batch, or in a later point release?
7. **Q7. Phase 0.** Approve Phase 0 (thread serialisation for all routes) as an independent change if the measurement shows serialisation dominates?

## 9. CFTC session position

**Agrees with the direction, with objections a–f.** Its reply is quoted in the coordinator's scratchpad `d8-cftc-constraints.md`. Each objection is addressed here:

| Objection | Where addressed |
|---|---|
| a. Deadline versus cold start; no count-based recycling; spawn eagerly | §4.2, §5.1, §5.2, Q2 |
| b. Byte-equality contract test | §4.2 (same app, raw-request proxy), §6.3 test 1 |
| c. Queue up to the deadline, then 503 | §5.3 |
| d. Flock only with more than one CFTC lane | §5.4, Q3 |
| e. Decide TMX covered_calls, OECD and FFIEC explicitly | §3, Q5 |
| f. Measure the `apps.json` split first; the split sets the order | §2, §6.2 |

It also confirmed that:
- nothing has been prototyped toward process isolation;
- its uncommitted worktree edits are the rejected per-command-loop experiment;
- per-lane RSS has not been measured.

## CFTC session measurement + correction (2026-10-09, after the design was written)
Source: CFTC-wedge session; full table in the coordinator's side-session notes `cftc-worker-rss-2026-10-09.md`.
Setup: bare process importing only openbb_core + openbb_cftc at 35011a5 (CFTC code = 071ae7a); CftcSwapTradesFetcher.fetch_data then json.dumps(model_dump). swap_trades accepts rates|forex only. MB.
- import 58; rates cold 100 s / peak 551; forex 47–53 s / peak ~990 (RSS 821); rates warm 22.5 s.
- fresh process, warm disk (respawn case): rates 27 s / peak 510; forex 68 s / peak 982. Disk cache 6.6 MB.
Implications:
- (a) a per-worker cap near 1.25 GB fits (Mac; NAS unmeasured) — the earlier 1.7 GB figure was a guess.
- (b) respawn after SIGKILL costs ~5–15 s over warm, so objection (a) "deadline vs cold start" is weaker; the deadline must still exceed ~70 s (forex) and ~100 s (cold rates).
- (c) CORRECTION to objection (b): fetch is 47–100 s, JSON 1–3 s — response building does NOT dominate CFTC time. Worker-side serialisation still matters for FINRA's 150 MB, not for CFTC. Caveat: this JSON is 179 MB for forex vs the route's 40 MB, so the route serialises differently; JSON timing indicative only.

## FINRA worker measurement (CFTC session, 2026-10-09)
Source: CFTC-wedge session; full table in the coordinator's side-session notes `finra-worker-rss-2026-10-09.md`. Bare process importing only openbb_core + openbb_finra at 35011a5, include_matured=false. Columns: rows, fetch / JSON / peak (MB).

| bond_type | rows | fetch / JSON / peak |
|---|---|---|
| TS (default) | 153 | 0.7 s / — / 57 |
| ABS | 29,903 | 2.8 s / 1.0 s / 251 |
| TBA | 43,515 | 2.2 s / 0.6 s / 749 |
| CA | 299,672 | 16 s / 5.5 s / 2,151 (fetch-only 1,354; JSON 406 MB) |
| CMO | 465,085 | 22 s / 8 s / 3,055 (fetch-only 1,729; JSON 652 MB) |
| MBS | — | exit 137 twice; container at 9.4 GiB when killed |

FINRA keeps no disk cache (respawn = first call); import alone is 54 MB.
Implications: a FINRA worker cap of ~3.5 GB covers all bond types except MBS. MBS fits no sensible cap — isolation turns it from a whole-API threat into a predictable worker kill, but it never succeeds without a row cap or streaming. That is a separate user decision (the user previously chose defaults-only, no row cap). With the CFTC worker at ~1.0 GB peak, two workers peak at roughly 4.5 GB, against ~3.5 GB free on the NAS — Q1 stays the main risk.

**MBS, measured (CFTC session, 2026-10-09):** fetch alone peaks at 8.2 GB (1,510,377 rows, 110.6 s, VmHWM 8,199 MB); with JSON it is OOM-killed past 9.37 GiB on the Mac's 15.6 GiB Docker VM. Estimate (not measured), from CA/CMO's 1.6–1.8× fetch-peak ratio: MBS with JSON needs about 13–14.5 GB — i.e. it cannot succeed in any worker under ~14 GB, close to the NAS's whole 16 GiB API cap. Only a row cap or streaming makes MBS answerable.

**MBS, native measurement (CFTC session, 2026-10-09; supersedes the 13–14.5 GB extrapolation above):** uv venv with the image's versions (Python 3.12, openbb-core 2.0.1, openbb-finra 2.0.0, same source); peak = ru_maxrss. macOS native: fetch 1,510,377 rows in 61 s, peak 6.7 GB; JSON 27 s, 2.07 GB body; fetch+JSON peak 10.8 GB. With the Linux fetch peak of 8.2 GB plus the native 3.8 GB JSON delta, a Linux worker serving MBS needs about **12 GB** (estimate) — still most of the NAS's 16 GiB API cap.

**MBS row cap, measured (CFTC session, 2026-10-09; native Mac, incl. JSON):** peak 0.6 GB @50k rows, 1.1 GB @100k, 2.7 GB @250k, 4.5 GB @500k, 7.1 GB @1M, 10.8 GB uncapped (1.51M). Mechanism: `limit` on the FinraBondPricesQueryParams built by bond_list flows to trace.query(max_rows); collect_pages stops paging there, so the fetch itself is bounded (3.8 s @50k, 15.5 s @500k, 36 s @1M). Linux ≈1.2× higher → estimated caps for a Linux worker: ~75k rows for a 1 GB budget, ~300k for 3.5 GB. Caveat: TRACE sorts by finraSecurityIdentifier, so a cap returns the first N securities (a truncated list, not a sample) — the UI must say so.

## Rulings (user, 2026-10-09)
- **Q1:** one shared `heavy` lane (CFTC + FINRA queue behind each other), cap about 3.5 GB — fits the NAS's current free memory. FINRA MBS is row-capped at about 300k rows with a truncation warning (ruled the same day; built in the openbq-docker 3.0.1 batch).
- **Q2:** CFTC soft deadline 150 s + 15 s grace (pending a NAS cold-forex measurement).
- **Q3:** one CFTC lane only; no shard flock.
- **Q4:** refuse results over 256 MB with 413.
- **Q5:** OECD stays in-process; TMX covered_calls and FFIEC institution_structure join the lane only if the harness shows they stall.
- **Q6:** ship D8 in a later point release after 3.0.1.
- **Q7:** Phase 0 (thread serialisation for all routes) approved as an independent change if the measurement shows serialisation dominates.
- **Order:** implementation starts after the `apps.json` stall split is measured (the CFTC session's queued run-5 replay with py-spy dumps, after the v5 OPENBQ all-clear).
