<!-- Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# The reference backend through the Funnel door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gateway in openbq-docker v3 carries a `/ref` family and the reference's `live_grid_ws` socket through the public Funnel door, so BDOBB's Vercel preview can offer the whole reference backend (Live Grid card included) while the desktop app is unchanged.

**Architecture:**
- **openbq-docker v3 gets a `funnel-gateway`** — the SSRM walk's v4 gateway (`claude/walk-ssrm-v4`, ca9ba1b) **minus** PR #10's table machinery, **plus** v8's socket door (`origin/release/v8`). It admits nothing without the machine token; it forwards `/api/**` (as now) and a new `/ref/**` family to the keyless Episode 3 reference (`openbq-reference:17783`), and relays one ticketed WebSocket, `/ref/live_grid_ws`.
- **BDOBB v3's web layer** re-vendors the gateway's `policy.mjs` by commit, seeds a second backend ("OpenBQ Reference (preview)") at `<origin>/ref`, and ports v8's socket shim so the browser opens the reference socket on the door with a thirty-second ticket from the web layer. The web server's own upgrade handler keeps refusing every socket.
- **Deployment** builds the gateway image multi-arch to GHCR, pins it by digest in the NAS compose, and adds `:10000` with `AllowFunnel` to the Serve config already in use.

**Tech Stack:** Node 22 (gateway, `node --test`; `ws@8.21.3`), Python 3.12 (reference fixture + compose tests), FastAPI/Starlette (reference), Docker Compose, Tailscale Serve/Funnel, Vite/TypeScript + Vitest + `node --test` (BDOBB web layer), GHCR `docker buildx`.

**Spec:** `docs/superpowers/specs/2026-10-15-reference-socket-through-funnel-design.md` (in the BDOBB v3 worktree, branch `claude/v3-review-fixes-20261015`). The plan argues from the spec; executors read both.

## Repositories and refs

Read-only in every repository except the BDOBB v3 worktree, where only this plan file is written and committed. Use `git show <ref>:<path>` to read donor code; never modify a donor.

- **openbq-docker v3 (the gateway lands here):** worktree on branch `claude/v3-key-maint-into-release`, head `38c717c`. Has no `funnel-gateway/` yet. Gateway tests run `node --test *.test.mjs` on Node 22; Python checks run `python3 -m unittest discover -s workspace/tests` and `python3 -m pytest v3/tests`/`tests`; `scripts/check-public.py` gates every commit (`.githooks/pre-commit` / `pre-push`).
- **Gateway donors (clone `~/Developer/adventures-in-openbb-articles/openbq-relaunch/openbq-docker-v11`):**
  - `claude/walk-ssrm-v4` (ca9ba1b) — the v4 gateway: `funnel-gateway/`, the compose `web` profile, `gateway.env.example`, `ts-config/serve-funnel.json` + `serve-v3-funnel.json`, `tests/test_web_profile.py`, the CI steps, `docs/v4/gateway-down.md`. Includes PR #10's table routes/service/`control-admission.test.mjs` — **leave all of it out at v3.**
  - `origin/release/v8` — the socket door: the ticketed upgrade handler in `funnel-gateway/server.mjs`, `previewOrigin`, `maxSockets`, the 240 s socket lifetime, the `ws` dependency, the single-budget `spend`, and `newsSubscription` as the pattern for `refSubscription`. Bring down only the socket-door machinery, not the news/RSS/TLS-dial pieces.
  - `origin/release/v10` — the grid socket relay (`/grid/live_grid_ws`): the closest pattern for relaying a live-grid socket with per-frame re-validation of `{"params":{"symbol":…}}` (`liveGridSubscription`, `connectGrid`, the `connect()`/message handlers). The `/ref` socket is this pattern simplified (keyless upstream, no vendor metering).
- **BDOBB v3 (the web layer lands here):** the worktree above. `web/policy.mjs` is vendored (`scripts/gateway-vendor.mjs`; `web/policy.vendored.json` records tag + sha256; `web/security.test.mjs` recomputes and pins it; `package.json` keys `openbbDocker`/`openbqDocker`). `web/server.mjs` already has `/socket-ticket`, the upgrade handler, and the `wss:` `connect-src`. `web/bootstrap.mjs` seeds backends. `src/browser-shim/` has the shims; `src/components/renderers/LiveGridRenderer.tsx` + `src/hooks/useReconnectingSocket.ts` open `buildWidgetWsUrl(backend,widget)` and send `{"params":{"symbol":…}}`.
- **Socket shim donor (clone `~/Developer/adventures-in-openbb-articles/openbq-relaunch/bdobb`):** `git show origin/release/v8:src/browser-shim/socket.ts`, `src/test/fakeSocket.ts`, and the socket cases in `src/browser-shim/shims.test.ts`; `web/bootstrap.mjs` sets `window.__bdobbSocketTickets`; `src/browser-shim/http.ts` does `import "./socket";`.

## Global Constraints

- **House header on every source file** (`.ts/.tsx/.js/.mjs/.cjs/.py/.sh/.css/.html`): the two lines `Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.` and `SPDX-License-Identifier: Apache-2.0`, in the first five lines (comment syntax per language). Data and docs are not checked, but this plan file and the gateway's `.md`/compose docs carry the `<!-- ... -->` form.
- **No private deployment details in any committed file.** No tailnet hostname, IP, machine token, or home path. Use placeholders: `https://openbq.<your-tailnet>.ts.net:10000`, `YOUR-TAILNET.ts.net`, `~/...`. In test/code build a tailnet name at run time (`["example-tailnet","ts","net"].join(".")`) as the donor tests do. openbq-docker commits are gated by `scripts/check-public.py` (run it, or `.githooks/pre-commit`); BDOBB commits by `pnpm scrub` (`scripts/scrub-check.sh` + `scripts/header-check.sh`) — it must print clean.
- **Gateway tests run on Node 22** (`node --test funnel-gateway/*.test.mjs`); `ws` is pinned to `8.21.3`.
- **The vendored contract is canonical and one-directional.** BDOBB never edits `web/policy.mjs` by hand; it runs `pnpm gateway:vendor <tag>`. The vendored tag must be at or below `package.json` `openbbDocker` (`web/security.test.mjs` enforces it).
- **Gateway image:** local build `openbq-funnel-gateway:3.0.0`, `package.json` `"version": "3.0.0"`; GHCR `ghcr.io/adventures-openbq/openbq-funnel-gateway:3.0.0`.
- **The reference is keyless.** `openbq-reference` (the `episode3-demo` service) runs with no auth, unlike `openbq-api` (Basic pair). The `/ref` upstream injects **no** credential. This is deliberate and is the one structural difference from `/api`.
- **POSTs stay refused.** The door forwards GET only. Every Omni route (`/ref/omni*`) is refused at the door regardless of method.
- **The desktop app and native paths are untouched.** `vite --mode browser`, the e2e suite, and help:shots keep the native `WebSocket`; the shim is inert unless the bootstrap sets `window.__bdobbSocketTickets`.

## Review Focus

The spec's explicit contract is the authority; these are inputs its prose implies but no single task's happy-path test exercises. Each line names the input and the behaviour a reasonable operator/user expects; the owning task adds the test.

- **Dotted reference documents and the logo asset** (Task 2). RULED 2026-10-15 (user: "allow all four exact paths"): `/ref/agents.json`, `/ref/bundle.apps.json`, `/ref/market-examples.apps.json` and `/ref/assets/bdobb-logo.svg` are admitted as EXACT paths with no query (`REF_DOCUMENTS`), beside `/ref/widgets.json` and `/ref/apps.json`. Any other dotted path stays refused by the no-dot rule — pin `/ref/assets/other.svg` and `/ref/agents.json?x=1` refused.
- **A multi-symbol watchlist frame on the socket** (Task 3). `LiveGridRenderer` sends `{params:{symbol}}` where `symbol` may be a comma list. `refSubscription` must admit the list grammar (`SYMBOL_LIST_RE`), or a legitimate watchlist frame silently closes the socket. Pin both a single symbol and `AAPL,MSFT`, and that a second key / extra property / wrong shape closes it.
- **A replayed or expired ticket, and a wrong Origin** (Task 3). The upgrade must 401 a reused nonce and an expired ticket, and 403 an Origin that is neither `previewOrigin` nor refused outright; `previewOrigin` unset refuses every ticketed upgrade (401). Pin each.
- **An open socket that never sends a frame, or outlives its welcome** (Task 3). A client that connects and says nothing must be dropped at `firstFrameMs`; any socket must be torn down at 240 s (`socketMs`), and the slot returned (`sockets--`). Pin both deadlines against injected `socketMs`/`firstFrameMs`.
- **The reference being down or the `web` profile run without the v3 overlay** (Task 2). `/ref/*` must answer 502 when `openbq-reference` is unreachable (never hang, never leak the upstream body). Pin a 502 against a dialler that fails.

---

## Task 1: Port the v4 gateway skeleton into openbq-docker v3 (minus tables, minus socket)

Lands the HTTP gateway — `/_gateway/health`, `/api/**`, `/state/**` — exactly as the walk's v4, but with PR #10's table machinery removed. No socket and no `/ref` yet.

**Files (all in the openbq-docker v3 worktree):**
- Create `funnel-gateway/policy.mjs`, `config.mjs`, `server.mjs`, `entry.mjs`, `healthcheck.mjs`, `verify.mjs`, `check-upstreams.mjs`, `Dockerfile`, `README.md`, `settings.example.json`, `package.json`, `package-lock.json`.
- Create `funnel-gateway/policy.test.mjs`, `gateway.test.mjs`.

**Interfaces (produced, consumed by later tasks and by BDOBB):**
- `policy.mjs` exports `upstreamPath(url, config)`, `stateFile(name)`, `socketTicket(token, target, now?)`, `socketTicketNonce(token, target, ticket, now?)`, `socketTicketValid(...)`, `socketTarget(raw, origin)`.
- `config.mjs` exports `validateConfig(settings, secrets)`, `readConfig(dir?, env?)`.
- `server.mjs` exports `createGateway(config, { requestJson?, now? })`, `getJson(path, config, signal)`.

- [ ] **Step 1: Copy the v4 files verbatim, then delete the table machinery**

Copy each file from `claude/walk-ssrm-v4:funnel-gateway/<f>` (clone `openbq-docker-v11`). Then remove PR #10's table pieces:
- `policy.mjs`: delete the exports `TABLE_RESPONSE_BYTES`, `TABLE_DEADLINE_MS`, `validSsrmRoutes`, `tableRoute`, `TABLE_CONTROL_CONCURRENCY`, `tableControlRoute` (the block after `stateFile`). Keep everything else (the `/api` rules, `stateFile`, the ticket signer/verifier, and `socketTarget` which returns `null` at this step).
- `config.mjs`: in `SETTINGS_KEYS` keep only `["origin","stateDir","quoteDailyLimit","requestsPerMinute","maxConcurrent"]`; delete the table settings (`tableService`, `tableDesktopPrincipal`, `ssrmRoutes`, `tableTimeoutMs`) and their validation, the table secrets (`tableGatewayToken`, `tableRelayToken`), the `validSsrmRoutes` import, and `tableOrigin`/table fields from the returned object.
- `server.mjs`: delete the `tableRoute`/`tableControlRoute`/… import, `tablePrincipal`, `tableBody`, `tableExchange`, and the table branch in the request handler. Replace the two-lane `budgets`/`spend(cost, lane)` with v8's single-budget form — copy the `let budget = config.requestsPerMinute, resetAt = now()+60000, quoteCount = 0, day = …; let inflight = 0; function spend(cost){…}` block from `origin/release/v8:funnel-gateway/server.mjs`. Keep the `/state`, `/_gateway/health`, and `/api` branches and the `upgrade` handler that refuses every socket (`reject(socket, authorized(req,config) ? 404 : 401)`).
- `Dockerfile`: keep the v4 Dockerfile (it already runs `npm ci --omit=dev`); no change yet (the `ws` dependency arrives in Task 3). `package.json`: set `"version": "3.0.0"`.
- `settings.example.json`: keep as-is (origin placeholder `https://openbq.YOUR-TAILNET.ts.net:10000`, `stateDir`, quota/rpm/concurrency).
- `README.md`: copy v4's; drop any table paragraphs.
- Tests: copy `policy.test.mjs` and `gateway.test.mjs` from v4; **delete** the `"managed table routes …"` test in `policy.test.mjs` and every table test in `gateway.test.mjs`. Do **not** copy `control-admission.test.mjs`.

- [ ] **Step 2: Run the gateway unit tests — expect PASS**

Run: `cd funnel-gateway && npm ci --ignore-scripts && npm test` (Node 22).
Expected: PASS. `policy.test.mjs`'s `"no socket is a target …"` case still holds (`socketTarget` returns `null` for every input), and `gateway.test.mjs`'s upgrade-refusal cases hold.

- [ ] **Step 3: Run the public-content gate — expect clean**

Run: `python3 scripts/check-public.py`
Expected: no findings. (`settings.example.json` uses `YOUR-TAILNET`; no token or home path is committed.)

- [ ] **Step 4: Commit**

```bash
git add funnel-gateway
git commit -m "feat(v3): port the v4 funnel-gateway (HTTP only, no tables)"
```

---

## Task 2: Add the `/ref` HTTP family (reference backend, keyless, GET-only, no Omni)

Forwards the whole reference backend under `/ref`, under the same structural bounds as `/api`, with no credential injected and every Omni route refused.

**Files:**
- Modify `funnel-gateway/policy.mjs` (add the `/ref` block to `upstreamPath`; add `REF_ROUTE_RE`).
- Modify `funnel-gateway/config.mjs` (add fixed `refOrigin`).
- Modify `funnel-gateway/server.mjs` (extend `target()` for `/ref`).
- Modify `funnel-gateway/policy.test.mjs`, `gateway.test.mjs` (new cases).

**Interfaces:**
- Consumes `upstreamPath`, `getJson`, `target` from Task 1.
- Produces `config.refOrigin === "http://openbq-reference:17783"`; `upstreamPath` returns a `/ref/...` string for an admitted reference path.

- [ ] **Step 1: Write the failing policy tests**

Add to `policy.test.mjs`:

```js
test("the reference root documents forward exactly, with no query", () => {
  assert.equal(route("/ref/widgets.json"), "/ref/widgets.json");
  assert.equal(route("/ref/apps.json"), "/ref/apps.json");
  assert.equal(route("/ref/widgets.json?x=1"), null);
});

test("every reference GET forwards under the shape bounds, re-serialised; Omni refused", () => {
  assert.equal(route("/ref/metric_widget"), "/ref/metric_widget");
  assert.equal(route("/ref/table_widget"), "/ref/table_widget");
  assert.equal(route("/ref/data/prices"), "/ref/data/prices");
  assert.equal(route("/ref/pdf_widget_base64"), "/ref/pdf_widget_base64");
  // Omni routes (code-executing or not) are refused at the door.
  for (const bad of ["/ref/omni-widget", "/ref/omni-sql-widget", "/ref/omni-python-widget"]) {
    assert.equal(route(bad), null, bad);
  }
  // The four exact dotted documents (ruled 2026-10-15) forward, no query; other dotted paths stay refused.
  for (const ok of ["/ref/agents.json", "/ref/bundle.apps.json",
    "/ref/market-examples.apps.json", "/ref/assets/bdobb-logo.svg"]) {
    assert.equal(route(ok), ok, ok);
  }
  for (const bad of ["/ref/agents.json?x=1", "/ref/assets/other.svg", "/ref/assets/bdobb-logo.svg/x"]) {
    assert.equal(route(bad), null, bad);
  }
  // Same structural refusals as /api: uppercase, dot, control char, duplicate key, 41 pairs.
  for (const bad of [
    "/ref/Metric_Widget", "/ref/metric_widget.json",
    "/ref/metric_widget?x=a%0d%0aY:1", "/ref/metric_widget?a=1&a=2",
    "/ref/metric_widget?" + "a=1&".repeat(41).slice(0, -1),
  ]) assert.equal(route(bad), null, bad);
});
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `cd funnel-gateway && node --test policy.test.mjs`
Expected: FAIL — `route("/ref/widgets.json")` is `null` (no `/ref` rule yet).

- [ ] **Step 3: Add the `/ref` block to `upstreamPath`**

In `policy.mjs`, add near `OPENBB_ROUTE_RE`:

```js
// The reference backend's routes (Episode 3): same lowercase-segment class as /api/api/v1.
const REF_ROUTE_RE = /^\/ref\/[a-z0-9_/-]{1,200}$/;
// Its root documents and logo, forwarded as exact paths with no query (dotted, so outside
// REF_ROUTE_RE; the four extra ones ruled in 2026-10-15).
const REF_DOCUMENTS = new Set(["/ref/widgets.json", "/ref/apps.json", "/ref/agents.json",
  "/ref/bundle.apps.json", "/ref/market-examples.apps.json", "/ref/assets/bdobb-logo.svg"]);
```

In `upstreamPath`, after the `/api` blocks and before `return null;`:

```js
// --- the reference backend (Episode 3), offered whole through /ref. The upstream is
// openbq-reference:17783, a keyless local fixture, so NO credential is injected
// (server.mjs target()). The two root documents exactly, no query; every other GET
// under the SAME structural bounds as /api/api/v1 (lowercase segments, no dot, no %,
// bounded query, re-serialised). /ref/omni* is refused so no code-executing Omni route
// is ever forwarded. Dotted paths pass only as the exact REF_DOCUMENTS.
if (REF_DOCUMENTS.has(url.pathname)) {
  if (url.search) return null;
  return url.pathname;
}
if (url.pathname.startsWith("/ref/")) {
  if (url.pathname.startsWith("/ref/omni")) return null;
  if (!REF_ROUTE_RE.test(url.pathname)) return null;
  const pairs = [...params];
  if (pairs.length > MAX_QUERY_PAIRS) return null;
  for (const [name, value] of pairs) {
    if (!PARAM_NAME_RE.test(name) || value.length > MAX_VALUE_CHARS || hasControlChar(value)) return null;
  }
  const forwarded = url.pathname + (pairs.length ? "?" + params.toString() : "");
  return forwarded.length <= MAX_URL_CHARS ? forwarded : null;
}
```

- [ ] **Step 4: Add `refOrigin` to config and the `/ref` upstream to `target()`**

In `config.mjs`, add to the object `validateConfig` returns (beside `apiOrigin`):

```js
    // The Episode 3 reference (the episode3-demo service, network alias openbq-reference):
    // a keyless local fixture on the same bridge, so a fixed service name like apiOrigin,
    // never a setting, and NO credential is presented on the bridge.
    refOrigin: "http://openbq-reference:17783",
```

In `server.mjs`, replace `target()` with the two-upstream form:

```js
function target(path, config) {
  if (path.startsWith("/api/")) {
    return { url: new URL(path.slice(4), config.apiOrigin),
      headers: { Authorization: config.apiAuthorization, Accept: "application/json" } };
  }
  // The reference: strip "/ref" -> its own path; keyless, so no Authorization header.
  return { url: new URL(path.slice(4), config.refOrigin), headers: { Accept: "application/json" } };
}
```

- [ ] **Step 5: Run the policy tests — expect PASS**

Run: `cd funnel-gateway && node --test policy.test.mjs`
Expected: PASS.

- [ ] **Step 6: Add the gateway integration cases (upstream fixture, 502-on-down)**

In `gateway.test.mjs`, model a loopback upstream exactly as the existing `/api` upstream test (`"the OpenBB root documents and every api/v1 route forward…"`): stand a fixture HTTP server, point the gateway at it (inject `requestJson` or spin an `http` server and set `refOrigin` via `getJson`'s `target`), and assert:

```js
test("a reference GET forwards with no credential; Omni and unlisted dotted paths 404; a down reference is 502", async t => {
  // Fixture that records the Authorization header it receives and echoes {ok:true}.
  // Drive /ref/metric_widget with the token+Origin and assert 200 and that NO
  // Authorization header reached the fixture (keyless upstream).
  // Drive /ref/omni-sql-widget and /ref/assets/other.svg and assert 404 (refused by policy); /ref/assets/bdobb-logo.svg returns the fixture's body with 200.
  // Point refOrigin at a dead port and assert /ref/metric_widget is 502, body is the
  // door's own {"error":"Request refused"}, never the upstream's.
});
```

Write the body following the existing `/api` fixture test's structure (same `fixture(t, overrides, injections)` helper, same `http`/`wsConnect` helpers already in the file).

- [ ] **Step 7: Run all gateway tests + public gate — expect PASS / clean, then commit**

Run: `cd funnel-gateway && npm test` then `cd .. && python3 scripts/check-public.py`
Expected: PASS; clean.

```bash
git add funnel-gateway
git commit -m "feat(v3): forward the keyless reference backend under /ref"
```

---

## Task 3: Add the socket door and the `/ref/live_grid_ws` relay

Brings down v8's socket door (ticketed upgrades, `previewOrigin`, `maxSockets`, 240 s lifetime, the `ws` dependency) and the v10 grid-relay pattern, specialised for the keyless reference socket with per-frame re-validation.

**Files:**
- Modify `funnel-gateway/policy.mjs` (`refSubscription`; `socketTarget` admits `/ref/live_grid_ws`).
- Modify `funnel-gateway/config.mjs` (`previewOrigin`, `maxSockets`).
- Modify `funnel-gateway/server.mjs` (`WebSocketServer`, the upgrade handler, `connectRef`, the relay; `createGateway` gains `openRef`, `socketMs`, `firstFrameMs`).
- Modify `funnel-gateway/package.json`, `package-lock.json` (add `ws@8.21.3`), `Dockerfile` (comment), `verify.mjs` (socket probes), `settings.example.json` (optional `previewOrigin`/`maxSockets` comment — keep placeholders).
- Modify `funnel-gateway/policy.test.mjs`, `gateway.test.mjs` (socket + ticket cases).

**Interfaces:**
- Consumes Task 1/2 `policy.mjs`, `config.mjs`, `server.mjs`.
- Produces: `policy.mjs` `refSubscription(data) -> string|null`; `socketTarget("/ref/live_grid_ws", origin) -> "/ref/live_grid_ws"`; `config.previewOrigin` (origin|null), `config.maxSockets` (1–32, default 4); `server.mjs` `connectRef(config) -> WebSocket`; `createGateway(config, { …, openRef, socketMs, firstFrameMs })`.

- [ ] **Step 1: Write the failing policy tests for the socket contract**

In `policy.test.mjs`, add `refSubscription` and `socketTarget` to the import, and:

```js
import { refSubscription } from "./policy.mjs";

test("socketTarget admits exactly /ref/live_grid_ws, no query", () => {
  assert.equal(socketTarget("/ref/live_grid_ws", ORIGIN), "/ref/live_grid_ws");
  for (const bad of ["/ref/live_grid_ws?x=1", "/ref/live_grid_ws#x", "/news/ws/news",
    "/grid/live_grid_ws", "/ref/other_ws", "/", "//x", "x", 7, null]) {
    assert.equal(socketTarget(bad, ORIGIN), null, String(bad));
  }
});

test("refSubscription relays only a symbol params frame, rebuilt, else null", () => {
  assert.equal(refSubscription('{"params":{"symbol":"AAPL"}}'), '{"params":{"symbol":"AAPL"}}');
  assert.equal(refSubscription('{"params":{"symbol":"AAPL,MSFT"}}'), '{"params":{"symbol":"AAPL,MSFT"}}');
  for (const bad of ['{"params":{"symbol":"AAPL","x":1}}', '{"params":{"ticker":"AAPL"}}',
    '{"params":{"symbol":123}}', '{"subscribe":[]}', '{"params":{"symbol":""}}',
    '{"params":{"symbol":"' + "A".repeat(241) + '"}}', 'not json', '']) {
    assert.equal(refSubscription(bad), null, bad);
  }
  // A caller's extra top-level key never survives the rebuild.
  assert.equal(refSubscription('{"params":{"symbol":"AAPL"},"admin":1}'), null);
});
```

Replace the v4 `"no socket is a target …"` test's expectation for `/ref/live_grid_ws` (it is now admitted; the other listed sockets stay `null`).

- [ ] **Step 2: Run — expect FAIL**

Run: `cd funnel-gateway && node --test policy.test.mjs`
Expected: FAIL — `refSubscription` is not exported; `socketTarget("/ref/live_grid_ws")` is `null`.

- [ ] **Step 3: Add `refSubscription` and extend `socketTarget`**

In `policy.mjs`, add the symbol grammar (the list form, so a multi-symbol watchlist is admitted — see Review Focus) and the validator (the v10 `liveGridSubscription`, renamed):

```js
// The reference live grid's symbol grammar: one symbol, or a comma watchlist. `^` for an
// index symbol (^GSPC), `.` for an exchange suffix (AAPL.US).
const SYMBOL_LIST_RE = /^[A-Za-z0-9.^_,-]{1,240}$/;

/**
 * A /ref/live_grid_ws frame: `{"params":{"symbol":"A,B"}}`, sent on open and again on
 * every symbol change over the same open socket. Re-validated on every frame (not just the
 * first). The frame that reaches the reference is rebuilt from the one value that passed,
 * so no extra property, no second key and no display name of the caller's is ever forwarded.
 * Returns the frame to forward, or null to close the socket.
 */
export function refSubscription(data) {
  let frame;
  try { frame = JSON.parse(data.toString()); } catch { return null; }
  if (!frame || typeof frame !== "object" || Object.keys(frame).join() !== "params") return null;
  const params = frame.params;
  if (!params || typeof params !== "object" || Object.keys(params).join() !== "symbol") return null;
  const raw = params.symbol;
  if (typeof raw !== "string" || !SYMBOL_LIST_RE.test(raw)) return null;
  return JSON.stringify({ params: { symbol: raw } });
}
```

Replace `socketTarget` with:

```js
/**
 * The socket a ticket may name, under exactly the rules the upgrade handler applies -- and
 * the SAME function the web layer's ticket signer calls, so the two can never drift. One
 * route at this tag, and it takes no query: the whole subscription is the frame.
 */
export function socketTarget(raw, origin) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let url; try { url = new URL(raw, origin); } catch { return null; }
  if (url.origin !== origin || url.hash) return null;
  if (url.pathname === "/ref/live_grid_ws") return url.search ? null : url.pathname;
  return null;
}
```

- [ ] **Step 4: Add `previewOrigin` and `maxSockets` to config**

In `config.mjs`, copy the `httpsOrigin(value, tailnet, allowedPort)` signature from `origin/release/v10:funnel-gateway/config.mjs` (it takes a `tailnet` flag; `previewOrigin` is validated with `tailnet=false` so a non-tailnet Vercel origin is accepted). Add `"previewOrigin"` and `"maxSockets"` to `SETTINGS_KEYS`, and in `validateConfig`:

```js
  const maxSockets = settings.maxSockets ?? 4;
  if (!Number.isInteger(maxSockets) || maxSockets < 1 || maxSockets > 32) {
    throw new Error("Max sockets must be between 1 and 32");
  }
  // The web preview's own origin. Naming it turns on socket tickets (server.mjs): the one
  // Origin, besides the gateway's own, a WebSocket may arrive from. Unset = off.
  const previewOrigin = settings.previewOrigin === undefined ? null : httpsOrigin(settings.previewOrigin, false);
```

Add `maxSockets, previewOrigin` to the returned object.

- [ ] **Step 5: Add `ws`, the socket door and the `/ref` relay to `server.mjs`**

- `package.json`: add `"dependencies": { "ws": "8.21.3" }`. `package-lock.json`: copy the `ws` entries from `origin/release/v8:funnel-gateway/package-lock.json` so `npm ci` is reproducible. `Dockerfile`: change the "no npm dependencies" comment to note `ws`; the `npm ci --omit=dev` line already installs it.
- `server.mjs`: add `import { WebSocket, WebSocketServer } from "ws";`, `const MAX_SOCKET = 65536;`, and `connectRef`:

```js
/**
 * The reference's socket, opened once a client's first params frame has passed
 * refSubscription -- so a client that opens and says nothing, or says something invalid,
 * never opens anything upstream. ws:// (the reference listens on the bridge, no TLS), no
 * credential (it is keyless). Same bounds as any relayed socket: MAX_SOCKET on the push,
 * compression off, no redirect, a 10s handshake deadline.
 */
export function connectRef(config) {
  const url = new URL("/live_grid_ws", config.refOrigin);
  return new WebSocket(url, { handshakeTimeout: 10000, followRedirects: false,
    maxPayload: MAX_SOCKET, perMessageDeflate: false });
}
```

Take the socket-door scaffolding from `origin/release/v8:funnel-gateway/server.mjs` — the `const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_SOCKET, perMessageDeflate: false });`, the `createGateway(config, { requestJson = getJson, openRef = connectRef, now = Date.now, socketMs = 240000, firstFrameMs = 10000 } = {})` signature, the `const admitted = new Map();` nonce set, `server.maxConnections = 64`, `server.on("clientError", …)`, and the whole `server.on("upgrade", …)` handler — and make these substitutions (v8 is news-only; there is no grid/news/feeds concept at v3):

```js
server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => {});
  socket.setTimeout(10000, () => socket.destroy());
  let url = requestUrl(req, config);
  const tickets = url?.searchParams.getAll("ticket") ?? [];
  if (tickets.length && !req.headers.authorization) {
    // The browser's own socket: the web layer signed a 30s ticket (policy.mjs socketTicket)
    // and appended it LAST. Off until previewOrigin is set.
    if (!config.previewOrigin) return reject(socket, 401);
    if (req.headers.origin !== config.previewOrigin) return reject(socket, 403);
    const cut = req.url.search(/[?&]ticket=/);
    const want = req.url.slice(0, cut);
    const nonce = cut >= 0 && tickets.length === 1 && req.url.slice(cut + 8) === tickets[0]
      ? socketTicketNonce(config.token, want, tickets[0], now()) : null;
    for (const [used, until] of admitted) if (until <= now()) admitted.delete(used);
    if (!nonce || admitted.has(nonce)) return reject(socket, 401);
    admitted.set(nonce, Number(tickets[0].split(".")[0]));
    url = new URL(want, config.origin);
  } else {
    if (!authorized(req, config)) return reject(socket, 401);
    if (!url || req.headers.origin !== config.origin) return reject(socket, 403);
  }
  const want = socketTarget(url.pathname + url.search, config.origin);
  if (req.method !== "GET" || !want || req.headers["sec-websocket-protocol"]) return reject(socket, 404);
  // A socket occupies the door while open: six units, charged before handleUpgrade so a
  // refusal costs the same whether the handshake would have succeeded or not.
  if (sockets >= config.maxSockets || !spend(6)) return reject(socket, 429);
  wss.handleUpgrade(req, socket, head, client => {
    sockets++;
    socket.setTimeout(0);
    let upstream, pending = null;
    const close = () => { client.terminate(); upstream?.terminate(); };
    const lifetime = setTimeout(close, socketMs);
    const initial = setTimeout(close, firstFrameMs);
    client.once("close", () => { sockets--; clearTimeout(lifetime); clearTimeout(initial); upstream?.terminate(); });
    client.on("error", close);
    const connect = () => {
      try { upstream = openRef(config); } catch { close(); return false; }
      upstream.on("message", (message, isBinary) => {
        if (isBinary || message.length > MAX_SOCKET || client.readyState !== WebSocket.OPEN ||
            client.bufferedAmount > 262144) return close();
        client.send(message, { binary: false });
      });
      upstream.on("error", close);
      upstream.once("close", close);
      return true;
    };
    client.on("message", (data, binary) => {
      // A params frame on open AND on every symbol change over the same socket, re-validated
      // each time. The reference is a keyless local fixture, so there is no vendor meter here;
      // the upgrade's six units, maxSockets and the 240s lifetime are the whole budget.
      if (binary) return close();
      const frame = refSubscription(data);
      if (!frame) return close();
      clearTimeout(initial);
      if (!upstream) {
        if (!connect()) return;
        upstream.once("open", () => {
          if (pending !== null && client.readyState === WebSocket.OPEN) upstream.send(pending);
          pending = null;
        });
      }
      if (upstream.bufferedAmount > 262144) return close();
      if (upstream.readyState === WebSocket.OPEN) { pending = null; return upstream.send(frame); }
      pending = frame;
    });
  });
});
```

Import `refSubscription`, `socketTicketNonce`, `socketTarget` from `./policy.mjs` at the top. Keep `server.closeGateway` in the v8 form that also terminates `wss.clients`.

- [ ] **Step 6: Add the socket integration tests**

In `gateway.test.mjs`, import `socketTicket` from `./policy.mjs` and `WebSocket` from `ws` (the v8 test already has the `fixture`, `wsConnect`, `ticketed` helpers — copy them from `origin/release/v8:funnel-gateway/gateway.test.mjs`'s socket section). Add, with the news target swapped for `/ref/live_grid_ws` and `openNews` → `openRef`:

```js
const PREVIEW = "https://preview.example.com";
const path = "/ref/live_grid_ws";

test("a browser socket is admitted on a ticket: right target, right Origin, once", async t => {
  const { port } = await fixture(t, { previewOrigin: PREVIEW }, { openRef: () => new WebSocket("ws://127.0.0.1:9") });
  const browser = { Origin: PREVIEW };
  const ticket = socketTicket(TOKEN, path);
  assert.equal((await wsConnect(port, browser, ticketed(path, ticket))).status, 101);
  assert.equal((await wsConnect(port, browser, ticketed(path, ticket))).status, 401);           // replay
  assert.equal((await wsConnect(port, { Origin: "https://evil.example.com" }, ticketed(path, socketTicket(TOKEN, path)))).status, 403);
  assert.equal((await wsConnect(port, browser, ticketed(path, socketTicket(TOKEN, "/grid/live_grid_ws")))).status, 404); // wrong target
  assert.equal((await wsConnect(port, browser, ticketed(path, socketTicket(TOKEN, path, Date.now() - 31_000)))).status, 401); // expired
  assert.equal((await wsConnect(port, browser, ticketed(path, "junk"))).status, 401);
});

test("tickets are off until the operator names the preview origin", async t => {
  const { port } = await fixture(t, {}, { openRef: () => new WebSocket("ws://127.0.0.1:9") });
  assert.equal((await wsConnect(port, { Origin: PREVIEW }, ticketed(path, socketTicket(TOKEN, path)))).status, 401);
});

test("the reference socket relays a valid frame, closes on a bad one, and expires", async t => {
  // Stand a loopback ws upstream (an echo server) as openRef; connect with the token+Origin
  // (desktop path), send {"params":{"symbol":"AAPL"}} and assert the upstream received the
  // rebuilt frame; send a second-key frame and assert the client socket closes. Inject a
  // short socketMs and assert the socket closes at the deadline; inject a short firstFrameMs
  // and assert a silent client is dropped. Follow the v8 news-socket test's structure.
});
```

- [ ] **Step 7: Add the verify.mjs socket probes**

In `verify.mjs`, replace the two trailing news-upgrade probes with reference ones:

```js
  expect(await status("/ref/live_grid_ws", { ...upgrade, Origin: config.origin }), 401, "an upgrade without a token");
  expect(await status("/ref/live_grid_ws", { ...good, ...upgrade, Origin: config.origin }),
    config.previewOrigin ? 426 : 426, "an upgrade with the token reaches the ws layer");
```

(The authorized-but-non-ticket upgrade reaches `wss.handleUpgrade`; `verify.mjs` only checks the pre-socket refusals, so prove the two refusals it can see without opening a socket: no token → 401, and a wrong Host/Origin → 421/403 as the existing probes already do. Keep the probe set that returns before `handleUpgrade`; do not assert a 101 here — that belongs in `gateway.test.mjs`.) Confirm against the v8 `verify.mjs` which keeps its socket assertion inside the unit test, not the operator probe.

- [ ] **Step 8: Run all gateway tests + public gate — expect PASS / clean, then commit**

Run: `cd funnel-gateway && npm ci --ignore-scripts && npm test` then `cd .. && python3 scripts/check-public.py`
Expected: PASS; clean.

```bash
git add funnel-gateway
git commit -m "feat(v3): ticketed socket door and the /ref/live_grid_ws relay"
```

---

## Task 4: Compose, Serve, env, CI and docs for the `web` profile

Wires the gateway into openbq-docker's compose (`web` profile, no table-service), the Funnel Serve configs, the env example, the compose test, the CI steps, and a `gateway-down`-style doc.

**Files:**
- Modify `docker-compose.yml` (add `funnel-gateway` under the `web` profile; add `gateway-state` volume).
- Create `gateway.env.example`, `ts-config/serve-funnel.json`, `ts-config/serve-v3-funnel.json`.
- Create `tests/test_web_profile.py`.
- Modify `.github/workflows/public-content.yml` (add the `tests` pytest step and the Node gateway step).
- Create `docs/v3/gateway.md`.

- [ ] **Step 1: Add the `funnel-gateway` service**

Copy the `funnel-gateway` service block from `claude/walk-ssrm-v4:docker-compose.yml` into the v3 `docker-compose.yml`, with these removals (no tables at v3): drop `table-private` from the service's `networks` (leave `[openbq-internal]`); do **not** copy the `table-service` service, the `table-private`/`table-egress` networks, or the `table-sources` volume. Set `image: openbq-funnel-gateway:3.0.0`. Keep `profiles: [web]`, `build: ./funnel-gateway`, `expose: ["8091"]`, `depends_on: [openbq-api]`, `env_file: [{ path: ./gateway.env, required: true }]`, `read_only: true`, `user`, `cap_drop`, `security_opt`, limits, the `gateway-config` bind, the `gateway-state` volume, `tmpfs`, `logging`. Add `gateway-state:` to the top-level `volumes:`.

- [ ] **Step 2: Add the env example and the two Funnel Serve configs**

- `gateway.env.example`: copy `claude/walk-ssrm-v4:gateway.env.example` and **delete** the `TABLE_GATEWAY_TOKEN`/`TABLE_RELAY_TOKEN` lines and their paragraph. Keep `GATEWAY_TOKEN`, `OPENBB_API_USERNAME`, `OPENBB_API_PASSWORD`, all empty.
- `ts-config/serve-funnel.json`: copy `claude/walk-ssrm-v4:ts-config/serve-funnel.json` verbatim (443 → openbq-api, 10000 → funnel-gateway, `AllowFunnel` on 10000).
- `ts-config/serve-v3-funnel.json`: copy `claude/walk-ssrm-v4:ts-config/serve-v3-funnel.json` verbatim (443 → openbq-api, 8443 → openbq-reference, 10000 → funnel-gateway, `AllowFunnel` on 10000).

- [ ] **Step 3: Add the compose profile test**

Create `tests/test_web_profile.py` from `claude/walk-ssrm-v4:tests/test_web_profile.py` verbatim (it already asserts: the gateway is `profiles: ['web']`, publishes no host port, loads only `gateway.env`, never `credentials.env`; the tailnet-only configs funnel nothing; each funnel config is its tailnet config plus only the `:10000` gateway; 443 stays the API; `serve-v3*.json` keep the reference on `:8443`; the examples hold placeholders only). It references no table service, so no edit is needed.

- [ ] **Step 4: Run the compose test — expect PASS**

Run: `python3 -m pytest tests -q`
Expected: PASS.

- [ ] **Step 5: Add the CI steps**

In `.github/workflows/public-content.yml`, after the existing `v3/tests` pytest step add (mirroring `claude/walk-ssrm-v4:.github/workflows/public-content.yml`):

```yaml
      - name: Test the web profile wiring
        run: python3 -m pytest tests -q -p no:cacheprovider
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Test the funnel-gateway route contract, server and preflights
        working-directory: funnel-gateway
        run: |
          npm ci --ignore-scripts
          npm test
```

- [ ] **Step 6: Write the `gateway-down`-style doc**

Create `docs/v3/gateway.md` (two-line `<!-- -->` header), modelled on `claude/walk-ssrm-v4:docs/v4/gateway-down.md`. State: the gateway is brought down from the walk's v4 (which came from v8) **minus** PR #10's table routes/service/`control-admission.test.mjs`, **plus** v8's socket door (ticketed upgrades, `previewOrigin`, `maxSockets`, 240 s lifetime, `ws`); the new `/ref` family (two root documents, the structural GET rule, Omni refused, the dotted-doc/logo consequence) and the `/ref/live_grid_ws` socket (`refSubscription`, keyless `connectRef`, no vendor metering); routes served (`/_gateway/health`, `/api/**`, `/state/**`, `/ref/**`, the socket); and a "Stayed up" table noting news/RSS/grid/tables are not at v3. No tailnet name, token or home path.

- [ ] **Step 7: Public gate, compose test — expect clean/PASS, then commit**

Run: `python3 scripts/check-public.py && python3 -m pytest tests -q`
Expected: clean; PASS.

```bash
git add docker-compose.yml gateway.env.example ts-config/serve-funnel.json ts-config/serve-v3-funnel.json tests/test_web_profile.py .github/workflows/public-content.yml docs/v3/gateway.md
git commit -m "feat(v3): wire the funnel-gateway web profile, Funnel Serve, CI and docs"
```

- [ ] **Step 8: Record the gateway commit SHA**

Run: `git rev-parse HEAD`
Note it; BDOBB vendors `policy.mjs` by this openbq-docker **tag** (Task 5 vendors by the paired tag, `v3.0.0`, after the gateway is tagged; until a tag exists, vendor against this worktree via `OPENBB_DOCKER_DIR`).

---

## Task 5: Re-vendor `policy.mjs` into BDOBB and pin it

Copies the gateway's canonical `policy.mjs` into the BDOBB web layer, updates the pin and the paired-tag, and extends `security.test.mjs` with `/ref` coverage.

**Files (BDOBB v3 worktree):**
- Modify `web/policy.mjs` (regenerated), `web/policy.vendored.json` (regenerated), `package.json` (`openbqDocker`).
- Modify `web/security.test.mjs` (new `/ref` and socket assertions).

**Interfaces:**
- Consumes the Task 1–3 `funnel-gateway/policy.mjs` (now exporting the `/ref` `upstreamPath`, `refSubscription`, and `socketTarget` admitting `/ref/live_grid_ws`).
- Produces a `web/policy.mjs` whose `upstreamPath` admits `/ref/**` and whose `socketTarget` admits `/ref/live_grid_ws`; `web/server.mjs` and `src/browser-shim/socket.ts` consume these unchanged.

- [ ] **Step 1: Vendor the gateway policy**

Run (from the BDOBB v3 worktree), pointing the vendor script at the openbq-docker v3 worktree. The script reads `git show <tag>:funnel-gateway/policy.mjs`, so the gateway must be tagged `v3.0.0` first (coordinator step, Task 8/9); for a pre-tag dry run, temporarily tag the gateway worktree head `v3.0.0` locally or vendor from a tag once cut:

```bash
OPENBB_DOCKER_DIR=<openbq-docker v3 worktree> pnpm gateway:vendor v3.0.0
```

This rewrites `web/policy.mjs` (header line names tag + sha256) and `web/policy.vendored.json`.

- [ ] **Step 2: Set the paired stack tag**

In `package.json`, set `"openbqDocker": "v3.0.0"` (the reference line's paired tag) and leave `"openbbDocker"` at or above the vendored tag (currently `v3.0.1` — the at-or-below rule compares the pin to `openbbDocker`, which stays ≥ `v3.0.0`).

- [ ] **Step 3: Add `/ref` and socket assertions to `security.test.mjs`**

Add `socketTarget` and `refSubscription`-via-policy coverage. After the existing `"the generic api/v1 rule …"` test, add:

```js
test("the reference family is admitted under /ref and the live grid socket is a valid target", () => {
  const cfg = configuration();
  for (const ok of ["/ref/widgets.json", "/ref/apps.json", "/ref/metric_widget", "/ref/data/prices"]) {
    assert.equal(upstreamPath(new URL(ok, cfg.origin), cfg), ok, ok);
  }
  for (const ok of ["/ref/agents.json", "/ref/assets/bdobb-logo.svg"]) {
    assert.equal(upstreamPath(new URL(ok, cfg.origin), cfg), ok, ok);
  }
  for (const bad of ["/ref/widgets.json?x=1", "/ref/omni-sql-widget", "/ref/assets/other.svg", "/ref/Metric_Widget"]) {
    assert.equal(upstreamPath(new URL(bad, cfg.origin), cfg), null, bad);
  }
  assert.equal(socketTarget("/ref/live_grid_ws", cfg.origin), "/ref/live_grid_ws");
  assert.equal(socketTarget("/ref/live_grid_ws?x=1", cfg.origin), null);
  assert.equal(socketTarget("/news/ws/news", cfg.origin), null);
});
```

Import `socketTarget` from `./policy.mjs` at the top of the test (it already imports `socketTicket`, `socketTicketValid`, `upstreamPath`).

- [ ] **Step 4: Run the web tests — expect PASS**

Run: `pnpm test:web`
Expected: PASS. The `"web/policy.mjs is the stack's contract, verbatim …"` test recomputes the sha256 from `policy.vendored.json` and checks the pin is at or below `openbbDocker`; the new `/ref` test passes against the re-vendored policy.

- [ ] **Step 5: Scrub and commit**

Run: `pnpm scrub` (must print clean).

```bash
git add web/policy.mjs web/policy.vendored.json package.json web/security.test.mjs
git commit -m "feat(v3): vendor the /ref gateway contract and pin it"
```

---

## Task 6: Seed the reference backend and turn on socket tickets

Adds the second preview backend and sets the ticket flag so the browser opens the reference socket on the door.

**Files:** Modify `web/bootstrap.mjs`, `web/security.test.mjs`.

**Interfaces:**
- Consumes `config.origin` (preview origin), `config.backend` (gateway origin, null when unconfigured).
- Produces, in the seeded `backends.json`, a `"preview-ref"` backend at `config.origin + "/ref"` present only when `config.backend` is set; and `window.__bdobbSocketTickets=true` in the bootstrap output when `config.backend` is set.

- [ ] **Step 1: Write the failing bootstrap tests**

In `security.test.mjs`, extend the bootstrap test:

```js
test("the reference backend is seeded only with a gateway, and tickets turn on with it", () => {
  const withGw = bootstrap(configuration());
  assert.ok(withGw.includes("OpenBQ Reference (preview)"));
  assert.ok(withGw.includes('"preview-ref"'));
  assert.match(withGw, /window\.__bdobbSocketTickets=true;/);
  const cfg = configuration(); cfg.backend = null; cfg.token = null;
  const noGw = bootstrap(cfg);
  assert.ok(!noGw.includes("preview-ref"));
  assert.doesNotMatch(noGw, /__bdobbSocketTickets/);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test:web`
Expected: FAIL — no `preview-ref`, no ticket flag.

- [ ] **Step 3: Seed the backend and set the flag**

In `web/bootstrap.mjs`, build the `backends.json` seed as the OpenBB API backend plus the reference when a gateway is configured:

```js
    "backends.json": JSON.stringify([
      { id: "preview-api", name: "OpenBB API (preview)", baseUrl: config.origin + "/api",
        authLocation: "header", validateWidgets: false },
      ...(config.backend ? [{ id: "preview-ref", name: "OpenBQ Reference (preview)",
        baseUrl: config.origin + "/ref", authLocation: "header", validateWidgets: false }] : []),
    ]),
```

Add the ticket flag to the returned output (mirroring `origin/release/v8:web/bootstrap.mjs`), beside the `persist` prefix:

```js
  // Read by src/browser-shim/socket.ts: same-origin sockets fetch a ticket and open on the
  // gateway instead of here. Without a gateway there is no socket to ticket.
  const tickets = config.backend ? "window.__bdobbSocketTickets=true;\n" : "";
```

and prepend `${tickets}` to the returned template literal (before `${persist}`).

- [ ] **Step 4: Run — expect PASS; scrub; commit**

Run: `pnpm test:web` (PASS), then `pnpm scrub` (clean).

```bash
git add web/bootstrap.mjs web/security.test.mjs
git commit -m "feat(v3): seed the reference preview backend and enable socket tickets"
```

---

## Task 7: Port the socket shim into the browser build

Adds v8's `TicketSocket` shim so the app's `WebSocket` for a same-origin socket fetches a ticket from `/socket-ticket` and opens on the gateway; inert unless `window.__bdobbSocketTickets` is set.

**Files (BDOBB v3 worktree):**
- Create `src/browser-shim/socket.ts`, `src/test/fakeSocket.ts`.
- Modify `src/browser-shim/http.ts` (`import "./socket";`), `src/browser-shim/registry.ts` (type), `src/browser-shim/shims.test.ts` (socket cases).

**Interfaces:**
- Consumes `fetch` from `./http`, `window.__bdobbSocketTickets` (Task 6), and `/socket-ticket` (already in `web/server.mjs`).
- Produces: in a browser build with the flag set, `globalThis.WebSocket === TicketSocket`.

- [ ] **Step 1: Add the shim and the fake**

Copy `git show origin/release/v8:src/browser-shim/socket.ts` into `src/browser-shim/socket.ts`, changing only the doc comment: the one socket target at v3 is `/ref/live_grid_ws` (not `/news/ws/news`), and the app's construction site is `useReconnectingSocket`, which `LiveGridRenderer` runs on. Copy `git show origin/release/v8:src/test/fakeSocket.ts` into `src/test/fakeSocket.ts` verbatim (both keep the house header).

- [ ] **Step 2: Import the shim from the http shim**

In `src/browser-shim/http.ts`, add `import "./socket";` (replacing the current comment that says there is no socket.ts). This is the carry point — there is no `@tauri-apps` socket module to alias, and `http.ts` is the network stand-in the app always loads. The `fetch`↔`socket` cycle is benign (hoisted `fetch`).

- [ ] **Step 3: Declare the flag on the registry type**

In `src/browser-shim/registry.ts`, replace the comment that says "this line's gateway has no socket route" with a `__bdobbSocketTickets?: boolean;` member on the `Window` interface (mirroring `__bdobbPersist`), documented: set by the bootstrap only when a gateway is configured; `socket.ts` then swaps `globalThis.WebSocket` for the ticketing one.

- [ ] **Step 4: Add the shim tests**

Copy the `describe("socket shim (web preview tickets)", …)` block from `git show origin/release/v8:src/browser-shim/shims.test.ts` into `src/browser-shim/shims.test.ts`, changing the target URL in each case from `/news/ws/news` to `/ref/live_grid_ws`. The cases: inert without the flag; with the flag, a same-origin socket opens on the ticketed gateway URL and relays; a fresh ticket per socket; another origin's socket goes to the native constructor; a ticket-fetch failure surfaces as a close.

- [ ] **Step 5: Run the unit tests — expect PASS**

Run: `pnpm exec vitest run src/browser-shim/shims.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, scrub; commit**

Run: `pnpm typecheck && pnpm lint && pnpm scrub` (all clean).

```bash
git add src/browser-shim/socket.ts src/test/fakeSocket.ts src/browser-shim/http.ts src/browser-shim/registry.ts src/browser-shim/shims.test.ts
git commit -m "feat(v3): port the ticketed socket shim into the browser build"
```

---

## Task 8: Docs and full-gate verification (BDOBB)

Documents the `/ref` family and the socket, and runs the whole v3 gate.

**Files:** Modify `web/README.md`, `src/help/guide/web-preview.md`.

- [ ] **Step 1: Document the ingress contract**

In `web/README.md`, under "Backend ingress contract", add a `/ref` block to the upstream-paths table and a socket row:

- `GET /ref/widgets.json`, `/ref/apps.json`, `/ref/agents.json`, `/ref/bundle.apps.json`, `/ref/market-examples.apps.json`, `/ref/assets/bdobb-logo.svg` — exact paths, no query, no credential injected (the reference is keyless).
- `GET /ref/**` — every other reference GET under the same structural bounds as `/api/api/v1/**`; `/ref/omni*` refused; any other dotted path refused.
- `WSS /ref/live_grid_ws` — one ticketed socket; the browser opens it on the gateway with a thirty-second single-use ticket from `/socket-ticket`; each client frame is re-validated (`{"params":{"symbol":…}}` only) and the socket lives at most 240 s.

Update the "Sockets:" checklist line: the reference's live grid socket **is** served at this version; the ticket machinery is now live behind `previewOrigin`.

- [ ] **Step 2: Update the Help page**

In `src/help/guide/web-preview.md`, add that openbq-docker v3 now carries the `funnel-gateway` (`web` profile): it offers the whole Episode 3 reference backend under `/ref` and relays the reference's Live Grid socket (`/ref/live_grid_ws`) through the Funnel door; the preview itself is still deployed only once a Vercel project and OAuth app are approved. Update the `*Source:*` line to name `web/bootstrap.mjs`, `src/browser-shim/socket.ts` and `web/policy.mjs` (vendored from openbq-docker `v3.0.0`).

- [ ] **Step 3: Run the full v3 gate — expect PASS**

Run: `pnpm test:web && pnpm exec vitest run && pnpm typecheck && pnpm lint && pnpm build:web && pnpm test:web:browser`
Expected: all PASS. (Run `pnpm build:web` immediately before `pnpm test:web:browser`; nothing that rebuilds the web dist may run between them.)

- [ ] **Step 4: Scrub and commit**

Run: `pnpm scrub` (clean).

```bash
git add web/README.md src/help/guide/web-preview.md
git commit -m "docs(v3): name the /ref family and the reference socket"
```

---

## Task 9: Build and publish the gateway image to GHCR (controller)

Builds the gateway for both architectures and pushes it, then tags the openbq-docker line so BDOBB can vendor `v3.0.0`.

- [ ] **Step 1: Multi-arch build and push**

From the openbq-docker v3 worktree (gateway committed, Task 1–4):

```bash
docker buildx build --builder rss-ticker-builder \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/adventures-openbq/openbq-funnel-gateway:3.0.0 \
  --push funnel-gateway
```

(The GHCR token is a classic token; fine-grained is denied. The image is keyless at build; no secret is baked in.)

- [ ] **Step 2: Confirm both platforms**

Run: `docker buildx imagetools inspect ghcr.io/adventures-openbq/openbq-funnel-gateway:3.0.0`
Expected: a manifest list with `linux/amd64` and `linux/arm64`. Record the index digest for the compose pin (Task 10).

- [ ] **Step 3: Tag the line (enables `pnpm gateway:vendor v3.0.0`)**

Tag the openbq-docker v3 gateway commit `v3.0.0` on the reference line per the repo's tag conventions, so Task 5's vendor-by-tag is reproducible. (Coordinator confirms placement against the line map before pushing the tag.)

---

## Task 10: Deploy on the NAS (controller)

Adds the gateway to the hand-curated NAS compose and publishes the door on `:10000`.

NAS facts (real values in the "QNAP stack operations" memory note; placeholders here keep the plan scrub-clean): `ssh nas`; docker at `<nas-docker>` (the container-station docker binary); compose dir `<nas-compose-dir>` (the hand-curated, flattened `openbq-episode1` stack — **edit it in place, do not overwrite from the repo**); sidecar `TS_SERVE_CONFIG` currently `/config/serve-regression.json` serving 443/8443/9443; pulls need `export DOCKER_CONFIG=<nas-docker-config>`.

- [ ] **Step 1: Back up the compose and Serve config**

```bash
ssh nas 'cd <nas-compose-dir> && cp docker-compose.yml docker-compose.yml.bak.$(date +%Y%m%d-%H%M%S) && cp -r ts-config ts-config.bak.$(date +%Y%m%d-%H%M%S)'
```

- [ ] **Step 2: Add the gateway service, pinned by digest**

Edit the NAS `docker-compose.yml` in place: add a `funnel-gateway` service on the `openbq-internal` network with `image: ghcr.io/adventures-openbq/openbq-funnel-gateway:3.0.0@sha256:<index digest from Task 9>`, `expose: ["8091"]`, `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, the `env_file: ./gateway.env`, the `gateway-config` bind (`/run/bdobb`, read-only), and the `gateway-state` volume — matching the committed service minus `build:` (use the pinned image). Confirm `openbq-reference` resolves on the NAS bridge (the reference service must be in this stack).

- [ ] **Step 3: Write `gateway.env` (0600) and `settings.json`**

```bash
ssh nas 'cd <nas-compose-dir> && umask 077 && cat > gateway.env <<"EOF"
GATEWAY_TOKEN=<generate: node -e "console.log(require(\"crypto\").randomBytes(32).toString(\"base64url\"))">
OPENBB_API_USERNAME=<same as credentials.env>
OPENBB_API_PASSWORD=<same as credentials.env>
EOF
chmod 600 gateway.env && ls -l gateway.env'
```

Create `gateway-config/settings.json` from `funnel-gateway/settings.example.json` with `"origin": "https://openbq.<your-tailnet>.ts.net:10000"`, `"stateDir": "/var/lib/bdobb/state"`, and `previewOrigin` **unset** (ticketed upgrades refused until a Vercel project exists, per spec). The token is never echoed to logs.

- [ ] **Step 4: Add `:10000` with `AllowFunnel` to the Serve config in use**

The sidecar uses `/config/serve-regression.json` (443/8443/9443). **Add** the `:10000` door to that file in place — do not replace it:

```json
"TCP": { …, "10000": {"HTTPS": true} },
"Web": { …, "${TS_CERT_DOMAIN}:10000": {"Handlers": {"/": {"Proxy": "http://funnel-gateway:8091"}}} },
"AllowFunnel": { …, "${TS_CERT_DOMAIN}:10000": true }
```

- [ ] **Step 5: Stop-and-ask if the funnel attribute is missing**

If the tailnet policy lacks the node's `funnel` attribute (Serve reports Funnel is not permitted for the node), **stop** and ask the user to add it in the admin console — it is their step, not ours. Do not proceed to pull/up until it is confirmed.

- [ ] **Step 6: Pull and bring the gateway up**

```bash
ssh nas 'export DOCKER_CONFIG=<nas-docker-config> && cd <nas-compose-dir> && <nas-docker> compose pull funnel-gateway && <nas-docker> compose up -d funnel-gateway tailscale'
```

Expected: the gateway container is healthy (its healthcheck hits `/_gateway/health` through the lock); the sidecar reloads Serve with `:10000`.

---

## Task 11: Live verification through the public Funnel ingress (controller)

Proves the door from the Mac over the public Internet path, pinning the public IP so MagicDNS is skipped. `previewOrigin` is set to a scratch origin **for this test only**.

**Files:** Create `scripts/verify-ref-funnel.mjs` (scratchpad, not committed) in the openbq-docker v3 worktree's scratch area.

- [ ] **Step 1: Set a scratch `previewOrigin` for the socket test**

On the NAS, set `"previewOrigin": "https://scratch.example.com"` in `gateway-config/settings.json` and restart the gateway. (Removed again after the test.)

- [ ] **Step 2: The probe script**

The Mac resolves `*.ts.net` to the tailnet address via MagicDNS, so the probe must hit the **public** Funnel ingress: resolve the door host with public DNS and pin that IP with SNI = host.

```js
// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
// SPDX-License-Identifier: Apache-2.0
// Usage: HOST=openbq.<your-tailnet>.ts.net TOKEN=<gateway token> \
//        PREVIEW=https://scratch.example.com node verify-ref-funnel.mjs
import { execFileSync } from "node:child_process";
import { request } from "node:https";
import { WebSocket } from "ws";

const HOST = process.env.HOST, TOKEN = process.env.TOKEN, PREVIEW = process.env.PREVIEW;
const PORT = 10000;
// Public DNS, so MagicDNS is skipped: the public Funnel ingress IP.
const ip = execFileSync("dig", ["@1.1.1.1", "+short", HOST]).toString().trim().split("\n").pop();
if (!ip) throw new Error("no public A record for the door host");

const base = { host: ip, servername: HOST, port: PORT,
  headers: { Host: `${HOST}:${PORT}` }, rejectUnauthorized: true };
const get = (path, headers = {}) => new Promise((res, rej) => {
  const req = request({ ...base, path, headers: { ...base.headers, ...headers } },
    r => { r.resume(); res(r.statusCode); });
  req.on("error", rej); req.end();
});
const auth = { Authorization: `Bearer ${TOKEN}`, Origin: `https://${HOST}:${PORT}` };

console.log("anonymous /ref/widgets.json:", await get("/ref/widgets.json"));          // expect 401
console.log("token /ref/widgets.json:", await get("/ref/widgets.json", auth));          // expect 200
console.log("token /ref/metric_widget:", await get("/ref/metric_widget", auth));        // expect 200
console.log("token /ref/omni-sql-widget:", await get("/ref/omni-sql-widget", auth));    // expect 404

// The socket: a ticket this script signs cannot be forged (it has no gateway key), so drive
// the door the way the browser does — mint the ticketed URL via the preview's /socket-ticket
// in a real deployed run (Task spec Verification 4). For this Task's check, connect with the
// scratch Origin and a ticket minted by the SAME policy signer the gateway uses, proving the
// Origin and replay rules. (Import socketTicket from the vendored policy with the gateway token.)
```

For the socket leg, import `socketTicket` from the gateway's `policy.mjs` (same signer, same token) and mint `?ticket=`; connect `wss://` with `servername: HOST`, `Origin: PREVIEW`, asserting: a right-Origin ticket streams rows after a `{"params":{"symbol":"AAPL"}}` frame; the same ticket replayed is 401; a wrong Origin is 403.

- [ ] **Step 3: Run and record results**

Run the probe from the Mac. Expected, per spec Verification 3: anonymous 401; with the token `/ref/widgets.json` 200, a `/ref` data route 200, `/ref/omni-sql-widget` 404; a ticketed socket with the right Origin streams rows, a replayed ticket 401, a wrong Origin 403.

- [ ] **Step 4: Unset the scratch `previewOrigin`**

Remove `previewOrigin` from the NAS `settings.json` and restart the gateway (ticketed upgrades refused again until a real Vercel project exists — spec Out of scope / open item).

---

## Out of scope (from the spec)

POST routes through the door; a Vercel project, OAuth app or DNS; any other socket family (news stays v8, the grid v10). The deployed-Vercel run (GitHub sign-in, the card ticking in a browser) is the user's open item, once a Vercel project and OAuth app are approved.

## Self-review notes (for the executor)

- **Spec coverage.** Gateway `/ref` routes + socket → Tasks 2–3; policy `upstreamPath`/`socketTarget`/`refSubscription` → Tasks 2–3; compose/env/Serve/CI/docs → Task 4; BDOBB policy re-vendor + pin + hash → Task 5; seed → Task 6; socket shim → Task 7; `connect-src`/upgrade-refusal "unchanged" → no code task (verified in Tasks 5/8 via existing tests); docs → Task 8; deployment → Tasks 9–10; live verification → Task 11.
- **Ambiguity 1 (dotted docs/logo) — RULED 2026-10-15:** the four dotted paths are admitted as exact paths (`REF_DOCUMENTS`, Task 2); other dotted paths stay refused.
- **Ambiguity 2 (symbol grammar).** The spec writes the frame as `{"params":{"symbol":"<symbol>"}}` (singular), but `LiveGridRenderer` can send a comma watchlist; the plan admits the list grammar (`SYMBOL_LIST_RE`) so a real watchlist frame is not rejected. RULED 2026-10-15: admit lists.
- **No per-frame vendor metering on the `/ref` socket** (unlike v10's grid): the reference is a keyless local fixture, so the spec's socket budget (upgrade `spend(6)`, `maxSockets`, 240 s lifetime) is the whole accounting. An open socket can send unlimited valid frames within 240 s; acceptable for a local fixture.
- **`security.test.mjs` "pins the new hash"** is satisfied by re-vendoring: `policy.vendored.json` records the new sha256 and the existing test recomputes and enforces it — no literal hash is hand-edited.
- **`refOrigin` is a fixed compose address, not a setting** (like `apiOrigin`), because the reference (`episode3-demo` / `openbq-reference`) is a mandatory part of the v3 overlay; running the `web` profile without the v3 overlay makes `/ref/*` answer 502.
