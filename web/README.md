# GitHub-gated browser preview

This is the GitHub-gated browser preview for BDOBB v4, served through openbq-docker v4's `funnel-gateway` (the `web` profile; see `funnel-gateway/README.md` there). Its route contract is vendored from that door (`web/policy.mjs`, hash-pinned by `web/security.test.mjs`). The door forwards `/api` (openbq-api), `/ref` (the whole Episode 3 reference backend, keyless), `/state` and, with the `table` profile, `/table`. It also serves **one socket**, `/ref/live_grid_ws`: the browser asks `/socket-ticket` for a thirty-second single-use ticket and opens the socket on the gateway directly; this layer's own upgrade handler still refuses every socket. The news wire arrives at v8 and the live-grid sockets at v10. It prepares deployment code only: no Vercel project, OAuth app, DNS record, Funnel swap or NAS change is created by these scripts.

## What is included

- **Login:** Auth.js with GitHub OAuth, state and PKCE, CSRF-protected sign-in/sign-out, encrypted Secure/HttpOnly host-only cookies. Only the `read:user` scope is requested, not repository access.
- **Admission:** `GITHUB_ALLOWED_USER_IDS` is a comma-separated allowlist of immutable numeric GitHub IDs, not display names, email addresses, or organization membership. Resolve each username to its ID and review it before admission. Empty means nobody, including the owner. Invalid configuration fails closed.
- **Session policy:** admission, session epoch and absolute one-hour expiry are checked for every protected HTTP request and WebSocket upgrade. Auth.js session polling cannot extend that absolute deadline. No provider token is included in the client session response.
- **The OpenBB catalogue (2026-09-20):** the `/api` side is no longer curated. `widgets.json` and `apps.json` are openbb-api's own documents, forwarded as-is — the catalogue plus the example dashboards the backend serves. Each widget's data call is admitted by one structurally-bounded rule instead of a per-route contract: path `^/api/api/v1/[a-z0-9_/-]{1,200}$` (lowercase route segments; no dot, so neither `..` nor `.json`; no `%`, so no encoded traversal), at most 4096 characters forwarded, at most 40 query pairs, each name `^[A-Za-z_][A-Za-z0-9_.\[\]-]{0,63}$`, each value at most 1024 characters with no control character, CR or LF — and the query is re-serialised from the parsed pairs, never relayed as the caller's raw string. Everything else under `/api/` is still refused, `/api/docs`, `/api/openapi.json` and `/api/redoc` included. `api/v1/calendar/trading` keeps its own narrower grammar because no widget calls it. The GitHub allowlist, not a curated manifest, is what gates the preview.
- **Managed tables:** with the stack's `table` profile, `/table/**` and the registered standard SSRM `POST` routes relay to the gateway with a session-derived principal (`TABLE_RELAY_TOKEN`), and the seeded connections include **Managed tables** at this origin's `/table`. See `deploy/table-service/README.md`.
- **One socket at v4:** `/socket-ticket` signs a ticket only for `/ref/live_grid_ws`, the one target the vendored policy names (the gateway admits it only once its `previewOrigin` is set); every other target answers 404. The browser opens the socket on the gateway, never through this layer.
- **One auth boundary:** HTML, JavaScript, metadata, REST and WebSocket handshakes are protected together. The bundle lives inside a Vercel Function, not in a public static directory. No browser-visible backend credential, CORS wildcard, unauthenticated rewrite, query-token login or desktop-command shim is introduced.
- **Desktop isolation:** `pnpm build` and Tauri commands are unchanged. `pnpm build:web` opts into the existing browser shims and suppresses source maps only for this build.

The preview is deliberately NOT full desktop parity. Dashboards, settings, backends, folders and chart presets are saved per GitHub user (below) when a backend gateway with a state store is configured; otherwise they are in-memory and reset on reload. The banner says which. Uploaded documents (`files/`) are never saved. Native file workflows, persistence, external iframe/RSS sources, MCP/agents, direct tick/kdb+ access, keys, stores and admin paths are not supported by this gateway. Some desktop controls remain visible but cannot connect through the restricted web policy. Adding a route family still requires a reviewed route-and-parameter contract and tests; the `/api` side takes structural bounds instead, because its endpoints have no reviewable key list.

Two things to know before opening the preview to anyone:

- **Cost.** Every widget load is a Vercel function invocation plus its bandwidth (the gateway itself meters nothing since 2026-10-17; EODHD's own plan limits apply).
- **Scope.** The catalogue is unfiltered: every widget openbb-api advertises is offered, including ones whose provider has no key configured on the stack. Those load fine and then fail at their data call, with the backend's error on the card — nothing screens them out beforehand. And because both layers are GET-only, `multi_file_viewer` widgets and any form widget cannot work — they `POST` their selection or their field values, so the card renders and the document fetch fails.

The dashboard remains desktop-oriented. The sign-in page fits a phone viewport, but the inherited dashboard/card controls can overflow at 375 px; full mobile dashboard support is not part of this PR.

## Build and inspect without deployment

Use the repository's pinned pnpm version through Corepack if `pnpm` is not installed:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm test:web
corepack pnpm typecheck
corepack pnpm test:run
corepack pnpm build
corepack pnpm build:web
corepack pnpm scrub
```

The web build produces:

```text
.vercel/output/config.json
.vercel/output/functions/preview.func/.vc-config.json
.vercel/output/functions/preview.func/index.mjs
.vercel/output/functions/preview.func/ui/...
```

There must be no `.vercel/output/static` directory. `web/entry.mjs` exports a Node HTTP server (its upgrade handler refuses every socket at this version); the function uses Node 22, response streaming and a 300-second duration. Every path routes to the function, including deployment aliases, which are refused unless their actual Host equals the configured canonical origin.

Vercel's Build Output API documents that private files inside a function are not directly exposed, while files in `static` are publicly served ([Vercel primitives](https://vercel.com/docs/build-output-api/primitives)). The catch-all uses the documented Build Output routing configuration ([Vercel configuration](https://vercel.com/docs/build-output-api/configuration)).

`pnpm web:serve` is an optional loopback-only server behind a local HTTPS reverse proxy. It requires the canonical Host and secure cookies; it intentionally has no insecure-login switch. Tests use signed synthetic sessions and injected mock upstreams, not a production authentication bypass.

## Runtime configuration

`web/.env.example` lists names only. Put secrets in Vercel's server-side environment configuration, scoped to the intended deployment environment. Never use `VITE_*`, commit a populated `.env`, print credentials, pass them as command-line arguments, or copy NAS/OpenBB administrator credentials into the frontend.

| Variable | Meaning |
|---|---|
| `APP_ORIGIN` | One canonical HTTPS origin, without path/query. Configure the intended custom domain at activation. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | A separate GitHub OAuth app for viewer sign-in, not the Perplexity connector grant. Callback is `APP_ORIGIN/auth/callback/github`. |
| `AUTH_SECRET` | Independently generated random secret, at least 32 characters. |
| `GITHUB_ALLOWED_USER_IDS` | Reviewed numeric IDs separated by commas. Empty by default; no implicit owner exception. |
| `SESSION_EPOCH` | Nonempty deployment-controlled session revision. Change when invalidating sessions. |
| `BACKEND_GATEWAY_ORIGIN` | The stack's funnel-gateway origin, `https://<node>.<tailnet>.ts.net:10000`, no path. Omit both gateway variables until the door is approved and published. |
| `BACKEND_GATEWAY_TOKEN` | The gateway's `GATEWAY_TOKEN`: a random base64url machine credential, at least 32 characters. Never the user's Basic-auth password. |
| `TABLE_RELAY_TOKEN` | Optional, with the stack's `table` profile: a distinct server-only credential the gateway trusts for the session-derived table principal. Never equal to `BACKEND_GATEWAY_TOKEN`. |
| `SSRM_ROUTES_JSON` | Optional reviewed standard SSRM `POST` paths, mirroring the gateway's `ssrmRoutes`. Unset, it is the stack's list vendored in `ssrm-routes.vendored.json` (the OpenBQ API's largest datasets); `[]` admits none. |
| `TABLE_TIMEOUT_MS` | Table request deadline, 1000–65000 ms. Defaults to 65000. |
| `SSRM_TIMEOUT_MS` | Deadline for the SSRM `POST` routes, 1000–300000 ms. Defaults to 170000. Managed `/table/` routes use `TABLE_TIMEOUT_MS`. |

Auth.js handles OAuth, cookies and CSRF; this project pins `@auth/core` because its JWT helper API can change ([Auth.js core](https://authjs.dev/reference/core), [Auth.js JWT reference](https://authjs.dev/reference/core/jwt)). Review upgrades with the web security tests.

## Backend ingress: openbq-docker v4's funnel-gateway

openbq-docker v4's `funnel-gateway` implements this contract: it validates the Bearer token (`BACKEND_GATEWAY_TOKEN` here, `GATEWAY_TOKEN` there) BEFORE forwarding any request and injects the API's Basic pair itself. It is published on the stack node's Funnel port 10000 only after the operator swaps in the Funnel serve file, so `BACKEND_GATEWAY_ORIGIN` is `https://<node>.<tailnet>.ts.net:10000`. `web/policy.mjs` is vendored from its `policy.mjs` at the commit `package.json` names as `openbqDocker` (`scripts/gateway-vendor.mjs`).

Only these upstream paths are used:

| Method/path | Backend responsibility |
|---|---|
| `GET /api/widgets.json`, `GET /api/apps.json` | Validate the gateway credential, inject internal OpenBB authentication, forward to openbb-api's own root documents. No query parameters. These are the only two root documents the client fetches from a backend. |
| `GET /ref/widgets.json`, `/ref/apps.json`, `/ref/agents.json`, `/ref/bundle.apps.json`, `/ref/market-examples.apps.json`, `/ref/assets/bdobb-logo.svg` | Exact paths, no query. No credential is injected: the reference is keyless. |
| `GET /ref/**` | Every other reference GET, under the same structural bounds as `/api/api/v1/**`. `/ref/omni*` is refused; any other dotted path is refused. |
| `WSS /ref/live_grid_ws` | One ticketed socket. The browser opens it on the gateway with a thirty-second single-use ticket from `/socket-ticket`; each client frame is re-validated (`{"params":{"symbol":…}}` only). The socket has no lifetime: it stays open while the browser answers the gateway's 30 s ping, so it can outlive the viewer's session. |
| `GET /api/api/v1/**` | Validate the gateway credential, enforce the structural bounds (path class, 4096 characters, 40 pairs, name class, 1024-character values, no control characters), re-serialise the query, inject internal OpenBB authentication, forward to OpenBB. The first `/api` is the service prefix, the second is OpenBB's actual API root. |
| `GET /api/api/v1/calendar/trading?exchange=...&year=...` | Narrower than the rule above: a four-letter MIC and a year inside the client's 1990–2040 window, because no widget calls this route — only the client's own `bd` helper. A 404 from an older backend is the designed "no calendar" answer. |
| `GET /state/<id>`, `PUT`/`DELETE /state/<id>/<file>` | The per-user saved configuration (below). |
| `/table/**`, registered SSRM `POST`s | The managed table service and standard SSRM routes, with the relayed principal. |

All responses used as data must be JSON; redirects are refused, requests have a 12-second timeout and REST bodies are capped at 2 MiB, except the four root manifests (`/api` and `/ref` `widgets.json`, `apps.json`): those are streamed at up to 16 MiB and gzipped when the browser accepts it, which keeps openbq-api's 5.0 MB catalogue under a Vercel Function's ~4.5 MB response limit. A manifest found over the cap only mid-stream is cut off, never delivered short. Client Cookie, Authorization and arbitrary headers never reach the upstream. Backend errors, redirects, Set-Cookie and authentication challenges are not forwarded to viewers.

Do not repoint the stack's `:443` route or enable Funnel on any other port. An Internet request with no/incorrect machine token fails at the gateway, even if the caller knows its hostname.

## Activation blockers and acceptance checklist

No deployment is authorized by this document. Resolve these items before a separate go-live approval:

- **Vercel access/plan:** confirm the account can import this private organization repository without making it public. Hobby teams cannot deploy private organization repositories through Git integration ([Vercel Git/Hobby guidance](https://vercel.com/docs/git#using-hobby-teams)). Any plan change requires approval.
- **OAuth and identity:** register the viewer OAuth app, configure exact callback/domain, supply secrets through the platform, and confirm the first approved IDs. Until then, keep the allowlist empty.
- **Ingress:** start the stack's `web` profile, run the gateway's preflights, then swap in the Funnel serve file (openbq-docker `funnel-gateway/README.md`). Missing upstream configuration yields 503 rather than falling back to internal URLs.
- **Rate/cost controls:** configure shared edge/ingress limits, per-viewer/provider budgets and monitoring before Internet exposure. This implementation has none: the per-viewer 240-request/minute budget was removed (2026-10-17), and the gateway behind it has no daily or per-minute budget either. Only the GitHub allowlist, the gateway's `maxConcurrent`/`maxSockets` and EODHD's own plan limits bound a viewer. Anonymous OAuth attempts also need edge limits.
- **Redistribution:** confirm market-data and feed redistribution rights for the intended users before granting access.
- **Sockets:** the reference's Live Grid socket (`/ref/live_grid_ws`) is served at this version, behind the gateway's `previewOrigin`: the browser asks this layer for a thirty-second, single-use ticket and opens the socket on the gateway directly (a socket relayed through a Vercel Function would bill function time while open), and `connect-src` gains the gateway's `wss:` origin.
- **Saved configuration (per-user state):** the browser build's file shim is memory, so `src/browser-shim/fs.ts` mirrors the app's own JSON stores to `PUT`/`DELETE /state/<file>` — with the table relay, the only non-GET routes here. They ask for more than a GET does: a session, an `Origin` that is present and ours, `Sec-Fetch-Site: same-origin` when sent, `application/json`, 256 KiB, an allow-listed file name (`policy.mjs` `stateFile`). The gateway path is `/state/<GitHub id>/<file>`, and the id is the session's, never anything the browser sent. `/preview-bootstrap.js` reads `GET /state/<id>` and seeds the page with it (saved state replaces the default seed; an empty store seeds the defaults). The page is told it may save (`window.__bdobbPersist`) **only when that read succeeded** — a first save over a store that could not be read would replace the user's dashboards with the defaults. **Backends are saved as typed, credentials included** (owner's ruling 2026-09-20); they live in the gateway's `runtime/state`, not on Vercel.
- **DNS:** add only the exact GoDaddy record returned by Vercel after the approved project/domain exists; do not guess the CNAME target or change unrelated records.
- **Independent network test:** from off-tailnet, check login and logout, allowed/denied GitHub accounts, empty allowlist, all deployment aliases, unauthenticated asset URLs, browser Network logs for credentials, REST data and saved state across a reload and a deployment, that a WebSocket upgrade on this layer is refused, and that the ticketed `/ref/live_grid_ws` opens on the gateway.
- **Data accuracy:** verify the separately controlled backend quote percentage fix is actually installed before describing the quote display as corrected.

Removing an ID or changing the epoch requires the runtime configuration to be updated/redeployed. Signing out clears the browser cookie but does not revoke a stolen JWT across instances. For emergency revocation, disable the ingress token and deployments immediately, rotate `AUTH_SECRET`/epoch and disable old deployment URLs; for immediate per-user revocation, add a shared session store before launch. Do not promise instantaneous distributed logout with these bounded JWT sessions.

## Test scope

`pnpm test:web` covers configuration fail-closed behavior, GitHub ID admission, session tampering/expiry/revocation, CSRF/PKCE/state initiation, cookie-only authentication, private static files, Host/Origin/traversal checks, exact route/query policy, the refusal of every socket upgrade on this layer, the `/ref/live_grid_ws` socket ticket, the 16 MiB gzipped manifests, the table relay and its control lane, the vendored policy's pairing with `openbqDocker`, server credential isolation and error/body limits, against mock backends. It does not contact GitHub for a real OAuth exchange, query live market-data providers, change the NAS, or deploy to Vercel.

Local tests do not prove platform-specific routing or OAuth completion. Keep the activation checklist open until those live checks have been completed with explicit approval.

`pnpm test:web:browser` runs a reproducible Playwright smoke test against a real loopback HTTPS server with a synthetic session and an in-memory per-user state store. It verifies the sign-in form, denied anonymous metadata, the seeded built-ins dashboard (the Grouping tab's Parameter echo card: AAPL edited to MSFT, saved to the user's state and reseeded after a reload), a lapsed session sending the next edit to sign-in, CSRF sign-out clearing the cookie and returning to login, and mobile login width. It blocks external requests, so it does not complete a real GitHub OAuth exchange. Run `pnpm build:web` first and install Playwright Chromium. CI runs it in the `e2e` job after `pnpm build:web`.
