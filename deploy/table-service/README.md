# Native table service deployment

The Rust service and worker are maintained only in this repository. The paired
`Adventures-OpenBQ/openbq-docker` checkout owns Compose, the canonical route policy,
private example settings, and `table-service/source.lock.json`. No image is published
by this work. `bdobb-table-service:local` is a locally built image name.

Use the Docker repository's `prepare-source.mjs` against this checkout to export the
exact pinned commit into a new build context. Its generated `.table-source.json`
records revision, Git tree and archive SHA-256; the Dockerfile verifies revision/tree
build arguments against that manifest. The Docker repository records the Dockerfile
SHA-256 and verifies it before export. Do not substitute a working tree or an invented
remote Git URL for the unpushed source commit.

The multistage image compiles the native service and contained worker using Rust
1.98.1, exactly ICU 78.3 (official source archive SHA-256 checked), and Node 26.10.0
(official architecture-specific archive SHA-256 checked). The locked root pnpm
installation builds the private ingest bundle. Only that bundle and the complete,
dereferenced SheetJS xlsx 0.20.3 package enter the runtime; no frontend node_modules
is copied. Runtime includes ICU, Node and project/SheetJS license notices. Full Cargo runtime dependency license
texts are generated from each locked Linux dependency closure into `/app/licenses/rust`. Debian
runtime packages are supplied by the configured distribution repository; this is
source-pinned reproducibility, not a claim of bit-for-bit identical apt packages.

The runtime runs UID/GID 10001, with a read-only filesystem, no capabilities, a
private durable source volume, and no published host ports. The image healthcheck
reads the private service configuration and authenticates on loopback. The gateway
alone joins the internal table network; a separate egress bridge permits configured
backend acquisition. Operators must provide reviewed upstream URLs and credentials
in `/private/table-backends.json` if they enable backend acquisition. Upload-only
settings use `backend_config: null` and an empty backend allowlist.

See `crates/table-service/README.md` for the complete API/configuration and resource
reservation contract. Container memory, reservation budgets, parser heap, native
address-space limits, response limits and job deadlines all apply independently.
The gateway bounds upload bodies at 16 MiB, JSON commands at 2 MiB and each complete
JSON response/export batch at 8 MiB; larger native outputs refuse at the boundary.
The default end-to-end gateway/web deadline is 65 seconds, configurable downward
(to at least 1 second). A truncated or failed batch is a failure, never a zero-row
success. There is no automatic retry of a mutation.

## Connections

Desktop uses the existing Connections → Connect backend form: set the gateway
HTTPS URL plus `/table`, name `Managed tables`, select header authentication with
`Authorization` and value `Bearer <ordinary gateway token>`. “Ask at startup” keeps
the value out of saved backend files. Discovery reads `/table/widgets.json`; the
existing managed provider recognizes its `managed-native` descriptor and uses the
same backend authentication for capabilities, sources and sessions. Configure
`tableDesktopPrincipal: "desktop:owner"` on the gateway. All holders of this shared
bearer share that one desktop principal. Separate desktop principals require
principal-specific direct service tokens behind a separately secured private
connection; never accept a client ownership header as authentication.

Web server configuration adds `TABLE_RELAY_TOKEN`, a distinct private credential
shared only with the gateway. Once configured, fresh web bootstrap settings include
`preview-table` at the same-origin `/table` connection. Saved backend settings remain
user-owned; existing accounts add that same URL through Connections. The browser
receives no gateway/relay/service token. The authenticated immutable GitHub account
ID becomes `github:<id>` on every request and survives logout/login and service
restart. It is separate from the `desktop:` namespace. POST/DELETE require same-origin
CSRF checks. `SSRM_ROUTES_JSON` explicitly lists standard provider POST paths and
must agree with the gateway's `ssrmRoutes` list; unregistered POSTs stay refused.

No production image build or deployment is implied by a passing host-backed Linux
runtime smoke. Record the image build, inspect its revision/tree labels and
`/app/source.json`, and run authenticated health/upload/session/derive/restart checks
before publishing a production artifact.

The current sample profile uses an 8 GiB container with 7 GiB global / 6 GiB principal
reservations, 512 MiB worker address-space bounds, 64 MiB retained-result estimates
and a separate 1 MiB export wire cap. These are configurable conservative limits.
The qualification evidence (the actual 1,205 × 4 and 2,005 × 8 workloads, refusal
cases and exact paired source) is recorded on the v10 line, where it was measured.
The pinned image remains unqualified after an apt ENOSPC build failure; successful
host-backed runtime checks do not replace final image qualification.
