# GitHub-gated browser preview

This is the GitHub-gated browser preview, targeting the funnel-gateway of Adventures-OpenBQ/openbq-docker v9.0.0 (the commit `package.json` `openbqDocker` names) — its opt-in `web` compose profile, the same door as v8.0.0's. `web/policy.vendored.json` records the tag, that commit and the hash of the vendored copy in `web/policy.mjs`, so the app and the stack cannot disagree about what is admitted. The door serves four families and nothing else: `/api` (openbq-api's own root documents, the whole widget catalogue under structural bounds, and the one narrow route the trading calendar needs), `/ref` (the whole Episode 3 reference backend, keyless, since v3, with its Live Grid socket `/ref/live_grid_ws`), `/news` — the first family served over a **socket** as well as over HTTP, which is why the policy has a second kind of rule beside its path-and-query ones: `newsSubscription`, which validates the single frame a client may send — and `/state`, the per-user store. `socketTarget` names `/ref/live_grid_ws` and `/news/ws/news` and nothing else, so a ticket asked for any other target 404s. There is **no `/ai`**: openbq-docker does not serve Rita, so the preview has no Rita. It prepares deployment code only: no Vercel project, OAuth app, DNS record, public backend ingress, subscription upgrade, or NAS change is created by these scripts.

## What is included

- **Login:** Auth.js with GitHub OAuth, state and PKCE, CSRF-protected sign-in/sign-out, encrypted Secure/HttpOnly host-only cookies. Only the `read:user` scope is requested, not repository access.
- **Admission:** `GITHUB_ALLOWED_USER_IDS` is a comma-separated allowlist of immutable numeric GitHub IDs, not display names, email addresses, or organization membership. Resolve each username to its ID and review it before admission. Empty means nobody, including the owner. Invalid configuration fails closed.
- **Session policy:** admission, session epoch and absolute one-hour expiry are checked for every protected HTTP request and WebSocket upgrade. Auth.js session polling cannot extend that absolute deadline. No provider token is included in the client session response.
- **News:** HTTPS history for approved feed IDs (`/news/api/news`), a same-origin `/news/ws/news` relay, and approved feed subscriptions only. The seeded dashboard gets a News tab only when `NEWS_APPROVED_FEEDS_JSON` and the gateway (`BACKEND_GATEWAY_ORIGIN`) are both configured, and `/preview-feeds.json` publishes those URLs to the page. The one frame a client may send is parsed and REBUILT from the approved URLs alone (`newsSubscription`), so display names and any extra property are stripped rather than forwarded, an unapproved feed is dropped instead of failing the whole card, and a second subscription frame, a control frame or a binary frame closes the socket.
- **The OpenBB catalogue (2026-09-20):** the `/api` side is no longer curated. `widgets.json` and `apps.json` are openbq-api's own documents, forwarded as-is — the bounds below were verified against a 331-widget, 181-endpoint OpenBB catalogue — plus the example dashboards the backend serves, which is how they appear on the web at all. Each widget's data call is admitted by one structurally-bounded rule instead of a per-route contract: path `^/api/api/v1/[a-z0-9_/-]{1,200}$` (lowercase route segments; no dot, so neither `..` nor `.json`; no `%`, so no encoded traversal), at most 4096 characters forwarded, at most 40 query pairs, each name `^[A-Za-z_][A-Za-z0-9_.\[\]-]{0,63}$`, each value at most 1024 characters with no control character, CR or LF — and the query is re-serialised from the parsed pairs, never relayed as the caller's raw string. Everything else under `/api/` is still refused, `/api/docs`, `/api/openapi.json` and `/api/redoc` included. `api/v1/calendar/trading` keeps its own narrower grammar because no widget calls it — only the client's own `bd` helper — so a four-letter MIC and a year in the client's 1990–2040 window is the whole legitimate parameter space, and that block refuses definitively rather than falling through to the generic rule. The GitHub allowlist, not a curated manifest, is what gates the preview.
- **Managed tables:** with the stack's `table` profile, `/table/**` and the registered standard SSRM `POST` routes relay to the gateway with a session-derived principal (`TABLE_RELAY_TOKEN`), and the seeded connections include **Managed tables** at this origin's `/table`. See `deploy/table-service/README.md`.
- **One auth boundary:** HTML, JavaScript, metadata, REST and WebSocket handshakes are protected together. The bundle lives inside a Vercel Function, not in a public static directory. No browser-visible backend credential, CORS wildcard, unauthenticated rewrite, query-token login or desktop-command shim is introduced.
- **Desktop isolation:** `pnpm build` and Tauri commands are unchanged. `pnpm build:web` opts into the existing browser shims and suppresses source maps only for this build.

The preview is deliberately NOT full desktop parity. Dashboards, settings, backends, folders, chat and chart presets are saved per GitHub user (below) when a backend gateway with a state store is configured; otherwise they are in-memory and reset on reload. The banner says which. Uploaded documents (`files/`) are never saved. Native file workflows, arbitrary external iframe/RSS sources, Rita (no `/ai` route: a `POST /ai/v1/query` is a 405 here and `/ai/agents.json` a 404 at the gateway), MCP tool servers a user adds, keys, stores and admin paths are not supported by this gateway. Some desktop controls remain visible but cannot connect through the restricted web policy. `frame-src` admits `https://www.youtube.com` and `https://docs.openbb.co` (the seeded Website card) and nothing else, and `connect-src` admits, beyond the page's own origin, only `https://rss.nytimes.com` (the seeded NYT Business RSS card), so both seeded cards work and a Website or RSS card pointed anywhere else is refused. A News feed reaches the preview only as an APPROVED feed through `/news`, never as a URL the card names. Any further family would need a reviewed route-and-parameter contract in the stack's policy and its own tests, while the `/api` side takes structural bounds instead, because 181 endpoints have no reviewable key list.

Two things to know before opening the preview to anyone:

- **Cost.** Every widget load is a Vercel function invocation plus its bandwidth (the gateway itself meters nothing since 2026-10-17; EODHD's own plan limits apply). The full `widgets.json` is about 1.7 MB and is fetched per session.
- **Scope.** The catalogue is unfiltered: every widget openbq-api advertises is offered, including ones whose provider has no key configured on the stack. Those load fine and then fail at their data call, with the backend's error on the card — nothing screens them out beforehand. And because both layers are GET-only, `multi_file_viewer` widgets (five in the current catalogue: FOMC documents, three Congress text viewers, the commodity weather bulletins) and any form widget cannot work — they `POST` their selection or their field values, so the card renders and the document fetch fails.

The dashboard remains desktop-oriented. The sign-in page fits a phone viewport, but the inherited dashboard/card controls can overflow at 375 px; full mobile dashboard support is not part of this PR.

## Date and datetime parameters

Date and datetime parameters carry the client's expression grammar
(`src/lib/dateExpressions.ts`): named anchors, period anchors, signed offsets whose units
include `bd` business days, `@` session times and ranges. **None of it reaches this layer.**
Every expression is resolved against the exchange calendar by the client BEFORE the wire,
and a value the sticky parser cannot consume whole is passed through as a literal and logged
once — so what leaves the browser is an ISO literal, a projected period label, or the
user's own literal string. This layer does not parse dates: it is the client's resolution,
not a server-side check, that keeps expression strings off the wire, and the grammar itself
is specified in that module's header and in the app's own Date Expression help page rather
than duplicated here.

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

There must be no `.vercel/output/static` directory. `web/entry.mjs` exports a Node HTTP server (its upgrade handler admits only the `/news/ws/news` relay); the function uses Node 22, response streaming and a 300-second duration. Every path routes to the function, including deployment aliases, which are refused unless their actual Host equals the configured canonical origin.

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
| `BACKEND_GATEWAY_ORIGIN` | Dedicated publicly reachable HTTPS ingress origin, no path. Omit both gateway variables until that ingress is approved and configured. |
| `BACKEND_GATEWAY_TOKEN` | Dedicated random base64url-format machine credential, at least 32 characters. Never the user's Basic-auth password. |
| `NEWS_APPROVED_FEEDS_JSON` | Object mapping approved, already-provisioned HTTPS feed URLs to numeric RSS feed IDs. Defaults to `{}`, which means no News tab, no `/news/api/news` id admitted and a 503 for a news socket ticket. At most 50 entries, and no two may share an id (the gateway refuses that too). Example shape: `{"https://feeds.example.com/news.xml":7}`. |
| `TABLE_RELAY_TOKEN` | Optional, with the stack's `table` profile: a distinct server-only credential the gateway trusts for the session-derived table principal. Never equal to `BACKEND_GATEWAY_TOKEN`. |
| `SSRM_ROUTES_JSON` | Optional reviewed standard SSRM `POST` paths, mirroring the gateway's `ssrmRoutes`. Unset, it is the stack's list vendored in `ssrm-routes.vendored.json` (the OpenBQ API's largest datasets); `[]` admits none. |
| `TABLE_TIMEOUT_MS` | Table request deadline, 1000–65000 ms. Defaults to 65000. |
| `SSRM_TIMEOUT_MS` | Deadline for the SSRM `POST` routes, 1000–300000 ms. Defaults to 170000. Managed `/table/` routes use `TABLE_TIMEOUT_MS`. |

Feed URLs/IDs are intentionally shown to admitted users; they are not credentials. Verify these IDs on the backend before adding entries. There is no invitation auto-discovery, self-enrolment or “any GitHub user” fallback.

Auth.js handles OAuth, cookies and CSRF; this project pins `@auth/core` because its JWT helper API can change ([Auth.js core](https://authjs.dev/reference/core), [Auth.js JWT reference](https://authjs.dev/reference/core/jwt)). Review upgrades with the web security tests.

## Backend ingress contract

Vercel cannot use the tailnet-only stack as its public upstream. The ingress is openbq-docker's funnel-gateway (the `web` compose profile, on the stack node's Funnel port 10000, `GATEWAY_TOKEN` = `BACKEND_GATEWAY_TOKEN`): it validates the dedicated Bearer token BEFORE forwarding any request and translates to internal service authentication itself. Its `feeds` setting and this layer's `NEWS_APPROVED_FEEDS_JSON` must name the same feeds, and its `previewOrigin` must be this preview's `APP_ORIGIN`. Opening it is a separate, approved step; nothing here does.

Only these upstream paths are used:

| Method/path | Backend responsibility |
|---|---|
| `GET /api/widgets.json`, `GET /api/apps.json` | Validate the gateway credential, inject internal OpenBB authentication, forward to openbq-api's own root documents. No query parameters. These are the only two root documents the client fetches from a backend. |
| `GET /ref/widgets.json`, `/ref/apps.json`, `/ref/agents.json`, `/ref/bundle.apps.json`, `/ref/market-examples.apps.json`, `/ref/assets/bdobb-logo.svg` | Exact paths, no query. No credential is injected: the reference is keyless. |
| `GET /ref/**` | Every other reference GET, under the same structural bounds as `/api/api/v1/**`. `/ref/omni*` is refused; any other dotted path is refused. |
| `WSS /ref/live_grid_ws` | One ticketed socket. The browser opens it on the gateway with a thirty-second single-use ticket from `/socket-ticket`; each client frame is re-validated (`{"params":{"symbol":…}}` only). The socket has no lifetime: it stays open while the browser answers the gateway's 30 s ping, so it can outlive the viewer's session. |
| `GET /api/api/v1/calendar/trading?exchange=...&year=...` | Narrower than the generic rule below, and matched before it: a four-letter MIC and a year inside the client's 1990–2040 window, because no widget calls this route — only the client's own `bd` helper. Serves the EODHD v2 envelope; a 404 from an older backend is the designed "no calendar" answer. |
| `GET /news/api/news?feed_id=...&limit=...` | Validate credential and approved feed ID, strip `/news`, forward to RSS history. `feed_id` must be one of the approved ids and `limit` 1–50; anything else fails closed rather than being clamped. |
| `GET /news/ws/news` with Upgrade | Validate credential and ingress Origin (Bearer with the gateway's own Origin, or a socket ticket with `previewOrigin`); strip `/news`; relay to RSS. Only pre-provisioned approved subscriptions may pass, and only the one rebuilt subscribe frame is ever forwarded. |
| `GET /state/<id>`, `PUT`/`DELETE /state/<id>/<file>` | The per-user store (below): validate credential, an allow-listed file name, JSON, 256 KiB. |
| `/table/**`, registered SSRM `POST`s | The managed table service and standard SSRM routes, with the relayed principal. |
| `GET /api/api/v1/**` | Validate the gateway credential, enforce the structural bounds (path class, 4096 characters, 40 pairs, name class, 1024-character values, no control characters), re-serialise the query, inject internal OpenBB authentication, forward to OpenBB. The first `/api` is the service prefix, the second is OpenBB's actual API root. |

All responses used as data must be JSON; redirects are refused, requests have a 12-second timeout, REST bodies are capped at 2 MiB (3 MiB for the state read that seeds a page), except the four root manifests (`/api` and `/ref` `widgets.json`, `apps.json`): those are streamed at up to 16 MiB and gzipped when the browser accepts it, which keeps openbq-api's 5.0 MB catalogue under a Vercel Function's ~4.5 MB response limit, and a manifest found over the cap only mid-stream is cut off, never delivered short. Socket messages are capped at 64 KiB in both directions, with compression off. Client Cookie, Authorization and arbitrary headers never reach the upstream. Backend errors, redirects, Set-Cookie and authentication challenges are not forwarded to viewers.

Do not repoint the existing Tailscale `:443` route, enable Funnel on existing service ports, or expose tick/kdb+ as part of this PR. Prefer a separately scoped ingress identity/service; retain the existing private preview and all current routes unchanged. An Internet request with no/incorrect machine token must fail at that ingress, even if the caller knows its hostname.

## Activation blockers and acceptance checklist

No deployment is authorized by this document. Resolve these items before a separate go-live approval:

- **Vercel access/plan:** confirm the account can import this private organization repository without making it public. Hobby teams cannot deploy private organization repositories through Git integration ([Vercel Git/Hobby guidance](https://vercel.com/docs/git#using-hobby-teams)). Any plan change requires approval.
- **OAuth and identity:** register the viewer OAuth app, configure exact callback/domain, supply secrets through the platform, and confirm the first approved IDs. Until then, keep the allowlist empty.
- **Ingress:** start the stack's `web` profile, run the gateway's preflights, then swap in the Funnel serve file (openbq-docker `funnel-gateway/README.md`). Missing upstream configuration yields 503 rather than falling back to internal URLs.
- **Rate/cost controls:** configure shared edge/ingress limits, per-viewer/provider budgets and monitoring before Internet exposure. This implementation has none: the per-viewer 240-request/minute budget was removed (2026-10-17), and the gateway behind it has no daily or per-minute budget either. Only the GitHub allowlist, the gateway's `maxConcurrent`/`maxSockets` and EODHD's own plan limits bound a viewer. Anonymous OAuth attempts also need edge limits.
- **Redistribution:** confirm market-data and feed redistribution rights for the intended users before granting access.
- **Sockets open on the gateway, not here (socket tickets):** a socket relayed through a Vercel Function bills function time for as long as it stays open, and the preview's news socket is always open. So the browser build swaps in a socket shim (`src/browser-shim/socket.ts`): for a same-origin socket it first asks `GET /socket-ticket?for=<path+query>` — session required, the target validated by exactly the rules the upgrade handler applies — and gets back `wss://<gateway>/<target>&ticket=<expiry>.<nonce>.<HMAC>`. The ticket is signed with a key derived from `BACKEND_GATEWAY_TOKEN` (no new secret; the token itself never reaches a browser), lasts thirty seconds, names one exact target and is single-use at the gateway. **`/ref/live_grid_ws` (since v3) and `/news/ws/news` are the only targets this line will ticket** — `socketTarget` names no others, so anything else 404s, and an empty approved-feed map is a 503 rather than a ticket a subscription could only close. `connect-src` gains the gateway's `wss:` origin and nothing else (beside the seeded RSS card's `https://rss.nytimes.com`, which it always admits). The gateway must name this preview in its `previewOrigin` setting or it refuses every ticket. A lapsed session cannot get a ticket, but a socket already open has no lifetime at the gateway: it stays open while the browser answers the gateway's 30 s ping, so it can outlive the viewer's session.
- **Saved configuration (per-user state):** the browser build's file shim is memory, so `src/browser-shim/fs.ts` mirrors the app's own JSON stores to `PUT`/`DELETE /state/<file>` — with the table relay and `POST /auth/*` (the CSRF sign-out), the only non-GET routes here. They ask for more than a GET does: a session, an `Origin` that is present and ours, `Sec-Fetch-Site: same-origin` when sent, `application/json`, 256 KiB, an allow-listed file name (`policy.mjs` `stateFile`). The gateway path is `/state/<GitHub id>/<file>`, and the id is the session's, never anything the browser sent. `/preview-bootstrap.js` reads `GET /state/<id>` and seeds the page with it (saved state replaces the default seed; an empty store seeds the defaults). The page is told it may save (`window.__bdobbPersist`) **only when that read succeeded** — a first save over a store that could not be read would replace the user's dashboards with the defaults. **Backends are saved as typed, credentials included** (owner's ruling 2026-09-20); they live in the gateway's `runtime/state`, not on Vercel.
- **WebSocket runtime (the relay, for a plain Node host):** the same-origin upgrade relay is what `web/local.mjs` and any non-Vercel host use. The handler checks the canonical Host, the method, the `Origin` and the session, admits `/news/ws/news` alone (the reference's socket opens on the gateway only; a 503 without a gateway or without approved feeds), and then relays one validated subscribe frame upstream and server pushes back — a second client frame, a binary frame, a frame that is not exactly `{"subscribe":[…]}`, or a client that sends nothing within ten seconds closes the socket. It closes at session expiry; the News hook reconnects and reseeds. On Vercel it would need Fluid compute and the WebSockets permission; Vercel documents native Node WebSocket support, but connections are instance-pinned and close at function duration, so do not assume it is available until tested in the target project ([Vercel WebSockets](https://vercel.com/docs/functions/websockets)).
- **DNS:** add only the exact GoDaddy record returned by Vercel after the approved project/domain exists; do not guess the CNAME target or change unrelated records.
- **Independent network test:** from off-tailnet, check login and logout, allowed/denied GitHub accounts, empty allowlist, all deployment aliases, unauthenticated asset URLs, browser Network logs for credentials, REST data, WS 101, wrong-Origin WS refusal, a `/socket-ticket` request for anything but `/ref/live_grid_ws` and `/news/ws/news` being refused, and reconnect/reseed across a deployment.
- **Data accuracy:** verify the separately controlled backend quote percentage fix is actually installed before describing the quote display as corrected.

Removing an ID or changing the epoch requires the runtime configuration to be updated/redeployed. Signing out clears the browser cookie but does not revoke a stolen JWT across instances. For emergency revocation, disable the ingress token and deployments immediately, rotate `AUTH_SECRET`/epoch and disable old deployment URLs; for immediate per-user revocation, add a shared session store before launch. Do not promise instantaneous distributed logout with these bounded JWT sessions.

## Test scope

`pnpm test:web` covers configuration fail-closed behavior, GitHub ID admission, session tampering/expiry/revocation, CSRF/PKCE/state initiation, cookie-only authentication, private static files, Host/Origin/traversal checks, the exact `/api` route/query policy (the two root documents, and the structural bounds on `api/v1`), the per-user state route, the news subscription frame (renames stripped, arbitrary feeds and control frames refused), the news upgrade's cookie/Origin/path checks and its refusal to grant a navigation-shaped exemption, the relay forwarding an approved subscription and no arbitrary client frame, the ticket route issuing only to a session and only for `/ref/live_grid_ws` and `/news/ws/news`, the 16 MiB gzipped manifests, the calendar/trading grammar, the absence of every `/ai` path, the vendored-policy hash matching its pinned tag and commit, server credential isolation and error/body limits. It does not contact GitHub for a real OAuth exchange, query live market-data providers, change the NAS, or deploy to Vercel.

Local tests do not prove platform-specific routing or OAuth completion. Keep the activation checklist open until those live checks have been completed with explicit approval.

`pnpm test:web:browser` runs a reproducible Playwright smoke test against a real loopback HTTPS server and a synthetic session. It verifies the sign-in form, denied anonymous metadata, the backend discovered through the forwarded `/api` manifest (`equity_price_quote_eodhd_obb`, stubbed in the same shape the live manifest serves it), the built-ins dashboard the preview seeds, the Grouping tab's Parameter echo card edited from AAPL to MSFT and saved to the user's state and reseeded after a reload, a lapsed session sending the next edit to sign-in, the seeded News card's headlines arriving over a **ticketed gateway socket** for `/news/ws/news` plus its `/news/api/news` seed, that `/socket-ticket` refuses any other target, CSRF sign-out clearing the cookie and returning to login, and mobile login width. It stays off the seed's Website and RSS tabs, whose cards name external URLs; it blocks external requests, so it does not complete a real GitHub OAuth exchange. Run `pnpm build:web` first and install Playwright Chromium. CI runs it in the `e2e` job after `pnpm build:web`.
