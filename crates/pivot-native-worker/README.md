# pivot-native-worker

Process-isolated `pivot-native` sessions for the native service. Linux is the only
supported production platform. `WorkerSession::spawn` returns
`UnsupportedPlatform` on macOS and other unsupported Unix platforms; there is no
unenforced fallback. The existing in-process native API and Wasm limits are unchanged.

```rust,ignore
let config = WorkerConfig::new(
    PathBuf::from("/opt/table/bin/pivot-native-worker"),
    512 * 1024 * 1024, // whole virtual address space, including ICU/loader/heap
    8 * 1024 * 1024,   // each request or response payload
    Duration::from_secs(10),
)?;
let mut session = WorkerSession::spawn(config, "en-US", limits)?;
let cancel = session.control(); // Clone + Send; keep outside an HTTP session mutex
let response_text = session.dispatch_wire(&request_text)?;
let usage = session.resource_usage()?;
cancel.cancel()?; // terminal; kills AND reaps even during blocked RPC
```

Configuration fields are private and validated by `new`. Executable must be an
absolute, trusted operator path to the installed worker; clients must never
choose it. Memory and frame caps must be positive; frames fit the 32-bit wire
length; deadlines are positive and at most one day. Getters expose
`reserved_memory_bytes`, `max_frame_bytes`, and `command_deadline`.
Presented-transfer batches default to 500 rows. Set `with_batch_rows(rows)` to
1–500 (inclusive); other values return `InvalidConfig`. `batch_rows()` exposes
the configured cap. The required private init field `batchRows` carries this
setting to `NativeSession::set_batch_rows` before the child acknowledges startup.
The cap applies to the first and every subsequent transfer batch; byte limits
still apply independently.
Create **one shared configuration**, then clone it per session. Its startup gate
defaults to one concurrent process creation; configure 1–1024 using
`with_max_starting_workers(n)` before cloning. `max_starting_workers`,
`active_startups`, and `reserved_startup_memory_bytes` expose that pool. Changing
the capacity after cloning is rejected. Reserve the startup memory headroom once
per configuration, separately from live-worker reservations; do not recreate a
configuration per request. A full startup pool returns `StartupBusy` before
creating a thread or child.
The reservation is the entire child address space, not estimated retained data.
The service must reserve this budget before spawning and release it only after
worker termination/reaping. Budget parent framing buffers separately (one bounded
output plus caller-owned input; startup locale JSON encoding has bounded expansion
and temporary copies). The library does not perform global live-worker admission
or retain response caches. Each live or starting worker also owns one parent
supervisor thread with a 128 KiB requested stack plus platform thread overhead;
include these and the HTTP/source-store allocations in service headroom.

Linux sets **both hard and soft RLIMIT_AS before exec**, disables core dumps,
sets parent-death SIGKILL with a parent PID race check, and enables no-new-privileges.
The child independently verifies its address-space limit before reading startup
configuration. Loader, mapped ICU data, stack, heap, and temporary calculation
allocations consume the same budget. Allocation failure can abort the child;
the parent returns a sanitized terminal error and reaps it. This is an address
space cap, not a cgroup/RSS accounting metric or hostile-code sandbox. The trusted
worker has no subprocess/network execution path. Per-worker memory pressure is
contained; global worker count and service host headroom remain admission duties.

Process creation, the startup handshake, and every RPC use a parent wall
deadline, including pipe writes and reads. Process creation runs in a dedicated
owner thread, which remains alive until child reap so Linux PDEATHSIG cannot fire
when an HTTP executor thread retires. If process creation itself is blocked when
the caller times out, the owner retains its startup slot until it can kill and
reap the child. Repeated timeouts therefore cannot create unlimited detached
threads or children. Kernel operations in uninterruptible I/O cannot be forced
to finish by a userspace timer; SIGKILL reaping may also wait on the kernel.
The reserved startup pool covers this delayed cleanup. If reap unexpectedly fails,
that slot is conservatively retained. Install the worker and ICU on local,
trusted storage. The protocol is sequential. `dispatch_wire(&mut self, &str)`
passes the exact request text and returns the exact existing pivot-wire response
text; it never JSON-reencodes the transport. Structural negative zero is retained.
Core handle is always 1; remote identities belong to the HTTP layer.

Each private frame has a big-endian u32 length, big-endian u64 sequence, one-byte
kind, and bounded payload (the length includes sequence and kind). Startup uses
kind 0/version 1, raw pivot-wire uses 1, usage uses 2. Unknown controls, wrong
sequence/kind, extra output, bad lengths, truncated streams, invalid UTF-8 and
invalid wire envelopes terminate the session. Every terminal RPC failure kills
and reaps. An oversized caller request is rejected before writing and is
recoverable. No listener, shell, log forwarding, or inherited environment is used;
stdin/stdout are private pipes and stderr is discarded. Inherited descriptors
above 2 are marked close-on-exec. Linux `close_range(CLOEXEC)` is preferred; on
older kernels a raw `getdents64` scan of `/proc/self/fd` sets `FD_CLOEXEC` for each
inherited descriptor, including high descriptors above a lowered descriptor limit.
The fallback uses a fixed 4096-byte stack buffer, validates every record boundary
and descriptor number, and iterates the finite post-fork descriptor table without
allocation or locks. It uses only syscalls/async-signal-safe functions after fork;
if procfs is unavailable when needed, startup fails closed. Runtime ICU must resolve
via trusted system linker configuration or binary RPATH, never inherited
`LD_LIBRARY_PATH`/`DYLD_*` values.

`resource_usage` returns the original core `ResourceUsage` through a private
control message. It is an estimate for observability, never the allocation cap.
All supplied core limits are preserved except `max_state_bytes`: the contained
child sets that field to `None` because the Wasm state estimator deliberately
refuses Statement, MEMBER, and chained witnesses and includes host caches.
The library does not weaken those existing Wasm resource checks. Every supplied
input/row/column/batch/cache/export/transfer limit remains in force.

`control()` returns a cloneable handle owning the child through a separate short
mutex. RPC never holds this mutex while reading/writing. Kill and wait happen
under the same lock; the stored child is removed only after reaping, preventing
late handles from signaling a recycled PID. The driver exclusively owns reaping
these children; application SIGCHLD handlers must not indiscriminately reap them. Session drop calls kill/reap even if
control handles survive. `kill`, `cancel`, and `dispose` are idempotent terminal
operations; a core wire `cancel` remains the core's separate protocol operation.

Build requirements and locale/oracle pins are those in `../pivot-native/README.md`:
Rust 1.98.1, ICU4C exactly 78.3, Node 26.10.0 / V8 14.6.202.34-node.35 / CLDR48 for
live native ordering tests. Qualification Dockerfile:

```
docker build -f deploy/table-service/Dockerfile.worker-qualification \
  -t bdobb-native-worker-qualification:icu78.3 deploy/table-service
docker run --rm --read-only --tmpfs /tmp \
  -v "$PWD:/work:ro" -v native-worker-target:/target \
  -v native-worker-cargo:/usr/local/cargo/registry \
  bdobb-native-worker-qualification:icu78.3 \
  cargo test --locked --manifest-path crates/pivot-native-worker/Cargo.toml --features test-fixture
```

The image fetches the official `unicode-org/icu` release-78.3 tag archive, verifies
SHA-256 `f06bcab72736ee9d55689033b8198a178562354128cf38edb2afc2e67e3fd931`,
and installs its LICENSE with the runtime. The digest is pinned, not inferred
from a mutable version label. The image is a test build environment, not the
production service image. See the Task 5A report for measured qualification and
host storage limitations.

Linux aarch64 qualification measured successful empty startup at 64, 96, and
128 MiB, with 1, 16, and 32 MiB rejected/exited. These are startup observations,
not recommended analytical budgets. Semantic tests use 512 MiB finite budgets;
a 28,689,458-byte real registration request exhausts a 96 MiB worker and is
reaped, while a second 128 MiB worker remains usable. Allocation termination is
reported as `Io` or `Terminated`, not classified as guaranteed OOM from an exit
signal. `Deadline` identifies parent timeout; protocol violations have explicit
`Protocol`/`FrameTooLarge` classifications. Error messages omit child stderr and
underlying sensitive OS details.

The adversarial `worker-fixture` executable is built only with the explicit
`test-fixture` feature. Install production using the default features and
`--bin pivot-native-worker`.
