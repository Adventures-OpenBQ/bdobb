# GitHub-gated browser preview

This is the GitHub-gated browser preview, targeting openbb-docker v12.4.0 (with its live-grid service). The route set serves both v10.1 and v12.4 clients: every v10 route is unchanged and the v12.4 routes below are purely additive, so a 10.1 client against a 12.4 backend (or this preview against a 10.1.2 upstream, which ignores unknown keys it never receives) works unchanged. It prepares deployment code only: no Vercel project, OAuth app, DNS record, public backend ingress, subscription upgrade, or NAS change is created by these scripts.

## What is included

- **Login:** Auth.js with GitHub OAuth, state and PKCE, CSRF-protected sign-in/sign-out, encrypted Secure/HttpOnly host-only cookies. Only the `read:user` scope is requested, not repository access.
- **Admission:** `GITHUB_ALLOWED_USER_IDS` is a comma-separated allowlist of immutable numeric GitHub IDs, not display names, email addresses, or organization membership. Resolve each username to its ID and review it before admission. Empty means nobody, including the owner. Invalid configuration fails closed.
- **Session policy:** admission, session epoch and absolute one-hour expiry are checked for every protected HTTP request and WebSocket upgrade. Auth.js session polling cannot extend that absolute deadline. No provider token is included in the client session response.
- **The OpenBB catalogue (2026-09-20):** the `/api` side is no longer curated. `widgets.json` and `apps.json` are openbb-api's own documents, forwarded as-is — 331 widgets over 181 endpoints at v12.4, plus the example dashboards the backend serves, which is how the v8 and v9 examples appear on the web at all. Each widget's data call is admitted by one structurally-bounded rule instead of a per-route contract: path `^/api/api/v1/[a-z0-9_/-]{1,200}$` (lowercase route segments; no dot, so neither `..` nor `.json`; no `%`, so no encoded traversal), at most 4096 characters forwarded, at most 40 query pairs, each name `^[A-Za-z_][A-Za-z0-9_.\[\]-]{0,63}$`, each value at most 1024 characters with no control character, CR or LF — and the query is re-serialised from the parsed pairs, never relayed as the caller's raw string. Everything else under `/api/` is still refused, `/api/docs`, `/api/openapi.json` and `/api/redoc` included. `api/v1/calendar/trading` keeps its own narrower grammar because no widget calls it. The GitHub allowlist, not a curated manifest, is what gates the preview.
- **News:** HTTPS history for approved feed IDs, a same-origin `/news/ws/news` relay, and approved feed subscriptions only. The initial dashboard gets a News card only when approved feeds are configured. Names are stripped from subscription frames to avoid renaming upstream feeds; arbitrary feeds, second subscription/control frames and binary frames are refused.
- **Live grid (v10):** when the backend gateway is configured, the seeded dashboard adds a live-grid backend (`/grid`) plus live_grid and ta_chart cards. live-grid's own `widgets.json`/`apps.json` pass through untouched (its manifest omits the iframe subscriptions widget when `LIVE_GRID_PUBLIC_URL` is unset, which it is), while every data path (`/grid/live_grid`, `symbol_meta`, `ticks`, `chart`, `ta_chart`) carries a reviewed parameter allowlist. The `/grid/live_grid_ws` socket relay follows useWidgetSocket's protocol: params frames may repeat on the same open socket on param changes; each is revalidated, and anything not shaped exactly like `{"params":{"symbol":…}}` closes the socket.
- **Study system (v12.4):** `/grid/ta_registry` (parameterless study catalogue) and `/grid/live_grid_studies` (symbol list plus an optional resolved anchor string) carry reviewed allowlists; `/grid/ta_chart` gains v12.4's `provider` ∈ {kdb, eodhd} and `basis` ∈ {adjusted, raw}. The seeded arts-charts card uses the EODHD variant of the widget -- the kdb+ tick cache is a q IPC port that takes arbitrary code and is never funneled -- and requests a rolling one week of 5-minute bars via `/grid/series` and the `/grid/ta_series_ws` socket. That socket is query-scoped (the whole contract lives on the connect URL, validated byte for byte) and server-push only: any client frame closes the socket. Client-side date expressions (`T`, `FY`, `bd`, `@14:00`) are resolved to ISO literals before the wire, so raw expression strings are refused, not relayed.

live-grid's `/demo`, `/subscriptions`, `ta_chart_ws` and `/subscribe` are deliberately NOT routed.
- **One auth boundary:** HTML, JavaScript, metadata, REST and WebSocket handshakes are protected together. The bundle lives inside a Vercel Function, not in a public static directory. No browser-visible backend credential, CORS wildcard, unauthenticated rewrite, query-token login or desktop-command shim is introduced.
- **Desktop isolation:** `pnpm build` and Tauri commands are unchanged. `pnpm build:web` opts into the existing browser shims and suppresses source maps only for this build.

The preview is deliberately NOT full desktop parity. Dashboards, settings, backends, folders, chat and chart presets are saved per GitHub user (below) when a backend gateway with a state store is configured; otherwise they are in-memory and reset on reload. The banner says which. Uploaded documents (`files/`) are never saved. Native file workflows, persistence, external iframe/RSS sources, MCP/agents, direct tick/kdb+ access, keys, stores and admin paths are not supported by this gateway. Some desktop controls remain visible but cannot connect through the restricted web policy. Adding a `/news` or `/grid` endpoint still requires a reviewed route-and-parameter contract and tests; the `/api` side takes structural bounds instead, because 181 endpoints have no reviewable key list.

Two things to know before opening the preview to anyone:

- **Cost.** Every widget load is a Vercel function invocation plus its bandwidth, and every data call spends the gateway's daily `/api` budget (`quoteDailyLimit`, default 100, which now counts `widgets.json` and `apps.json` too). A dashboard of ten widgets costs eleven of them on each open. The full `widgets.json` is about 1.7 MB and is fetched per session.
- **Scope.** The catalogue is unfiltered: every widget openbb-api advertises is offered, including ones whose provider has no key configured on the stack. Those load fine and then fail at their data call, with the backend's error on the card — nothing screens them out beforehand. And because both layers are GET-only, `multi_file_viewer` widgets (five in the v12.4 catalogue: FOMC documents, three Congress text viewers, the commodity weather bulletins) and any form widget cannot work — they `POST` their selection or their field values, so the card renders and the document fetch fails.

The dashboard remains desktop-oriented. The sign-in page fits a phone viewport, but the inherited dashboard/card controls can overflow at 375 px; full mobile dashboard support is not part of this PR.

## Date-expression grammar

Date and datetime parameters accept the client's expression grammar (`src/lib/dateExpressions.ts`). Every expression is resolved to an ISO literal by the client BEFORE the wire; the shim accepts only resolved literals, so raw expressions are refused, not relayed.

```text
value      := range | atom
range      := atom ( "/" | ".." ) atom          -- date_range / quarter_range only
atom       := anchor ( sign offset )* at?
anchor     := "T" | "today" | "$currentDate" | "now" | "trade_date" | "prev_trade_date"
            | "session_open" | "session_close" | "S" | "E" | period signed_int
period     := "W" | "M" | "Q" | "Y" | "FQ" | "FY"
offset     := integer unit?
unit       := "s" | "min" | "h" | "d" | "bd" | "w" | "m" | "mo" | "M" | "q" | "y" | "fq" | "fy"
at         := "@" ( HH ":" MM | "open" | "close" )
```

Disambiguation rules worth knowing:

- **Minutes are `min`; `m`, `mo` and `M` are all months.** `T-5min` is five minutes ago; `T-5m` and `T-5mo` are both five months. Capital `M` in offset position is months (OpenBB's dialect, `$currentDate-3M`); it cannot be misread because offsets are only ever read after an anchor, while `M0` / `M-1` anchors are consumed by the period production first. The alternation lists longer spellings first (`min`, `mo`, `bd`, `fq`, `fy`) so nothing is half-read.
- **Period shorthand takes its integer directly.** `Q-4` is the quarter anchor four quarters back; `Q0-4` is the anchor Q0 plus a four-day offset. The period regex consumes a sign only when digits follow it at once.
- **`T` in a symbol field is AT&T; `T@time` is unambiguously an anchor expression.** A bare `T` never matches as an expression in a symbol context, and `T@14:00` can never be the ticker followed by noise — the `@` production only exists inside an atom.
- **Case-sensitive throughout.** `Today` fails (NAMED takes the `T`, and `oday` is no offset), and so do `TSLA` and `SE` — any value the sticky offset loop cannot consume entirely is passed through as a literal and logged once, never half-parsed.
- **`@` is strict:** two digits each side of the colon, hour <= 23, minute <= 59, or the words `open` / `close` (resolved against the exchange calendar's session hours that day, so early closes shorten `@close` by themselves). `T@9:5` and `@25:00` stay literals. Only `datetime` params (and the chart's untyped anchors) carry an `@`.
- **Amounts are capped:** six digits generally, four for `bd`. A seventh digit (or fifth for `bd`) leaves a character the offset loop cannot consume, so the value becomes a literal.

Wire forms after resolution: `date` sends `2026-09-01`; `datetime` sends an offset-bearing ISO string such as `2026-09-14T09:30:15-04:00` (never `Z`, no fractional seconds, no `[zone]` suffix); `week`, `quarter` and `fiscal_year` project to their own labels; ranges join the halves with `/`.

### Business-day resolution

`bd` offsets resolve against the exchange's trading calendar (weekday table or bundled file, plus holidays). Today's client walks one trading day at a time, which is why the four-digit `bd` cap exists (`T-999999bd` took ~1.4 s per resolve before it). The agreed direction is estimate-then-adjust, which minimizes calendar lookups:

1. **Estimate assuming no holidays.** `T-50bd` spans ten trading weeks: start from 50 + 2*floor(50/5) = 70 calendar days back (two weekend days per full trading week), then align the remainder over the anchor's weekday.
2. **Consult the holiday calendar once for that window.** Count the actual exchange holidays inside the estimated span and extend the end by that many days.
3. **Iterate only over the delta.** Each added day is tested for business-day/holiday status, which can expose another holiday (or weekend edge) at the new boundary; repeat until the count is exact. The loop touches the calendar only for the handful of adjustment days, not all 50.

The same structure runs forward for `T+nbd`. With estimate-then-adjust in place the day-walk cost that motivated the caps disappears, but the six-digit general cap and four-digit `bd` cap remain as parse-time safety bounds regardless of resolution strategy. Implementing it in the client is a separate change to `dateExpressions.ts`, outside this shim PR.

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

There must be no `.vercel/output/static` directory. `web/entry.mjs` exports a Node HTTP server with an upgrade handler; the function uses Node 22, response streaming and a 300-second duration. Every path routes to the function, including deployment aliases, which are refused unless their actual Host equals the configured canonical origin.

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
| `NEWS_APPROVED_FEEDS_JSON` | Object mapping approved, already-provisioned HTTPS feed URLs to numeric RSS feed IDs. Defaults to `{}`. Example shape: `{"https://feeds.example.com/news.xml":7}`. |

Feed URLs/IDs are intentionally shown to admitted users; they are not credentials. Verify these IDs on the backend before adding entries. There is no invitation auto-discovery, self-enrolment or “any GitHub user” fallback.

Auth.js handles OAuth, cookies and CSRF; this project pins `@auth/core` because its JWT helper API can change ([Auth.js core](https://authjs.dev/reference/core), [Auth.js JWT reference](https://authjs.dev/reference/core/jwt)). Review upgrades with the web security tests.

## Backend ingress contract: not implemented or opened here

Vercel cannot use the existing tailnet-only preview as its public upstream. This PR expects a future, separately approved HTTPS ingress that validates the dedicated Bearer token BEFORE forwarding any request and translates to internal service authentication itself. The current private Basic-auth gateway does not implement that contract.

Only these upstream paths are used:

| Method/path | Backend responsibility |
|---|---|
| `GET /api/widgets.json`, `GET /api/apps.json` | Validate the gateway credential, inject internal OpenBB authentication, forward to openbb-api's own root documents. No query parameters. These are the only two root documents the client fetches from a backend. |
| `GET /api/api/v1/**` | Validate the gateway credential, enforce the structural bounds (path class, 4096 characters, 40 pairs, name class, 1024-character values, no control characters), re-serialise the query, inject internal OpenBB authentication, forward to OpenBB. The first `/api` is the service prefix, the second is OpenBB's actual API root. |
| `GET /api/api/v1/calendar/trading?exchange=...&year=...` | Narrower than the rule above: a four-letter MIC and a year inside the client's 1990–2040 window, because no widget calls this route — only the client's own `bd` helper. Serves the EODHD v2 envelope; a 404 from an older backend is the designed "no calendar" answer. |
| `GET /news/api/news?feed_id=...&limit=...` | Validate credential and approved feed ID, strip `/news`, forward to RSS history. |
| `GET /news/ws/news` with Upgrade | Validate credential and ingress Origin; strip `/news`; relay to RSS. Only pre-provisioned approved subscriptions may pass. |
| `GET /grid/widgets.json`, `GET /grid/apps.json` | Strip `/grid`, forward to live-grid's manifests, no query parameters. |
| `GET /grid/live_grid`, `symbol_meta`, `ticks`, `chart`, `ta_chart` | Strip `/grid`, enforce the reviewed per-route parameter allowlists, forward to live-grid. The `chart`-type widgets (`chart`, `ta_chart`) also carry the client's `theme=light|dark` resolution; nothing else is accepted. No credential is attached: live-grid authenticates nothing, so the gateway's Bearer token plus this route set is the entire admission boundary. |
| `GET /grid/live_grid_ws` with Upgrade | Strip `/grid`, relay to live-grid's websocket. Params frames may repeat on the same socket and are revalidated each time; raw client frames are never forwarded. |
| `GET /grid/ta_registry` | Strip `/grid`, forward to live-grid's study catalogue; no query parameters. |
| `GET /grid/live_grid_studies` | Strip `/grid`; allowlist is a symbol list plus an optional resolved anchor string. |
| `GET /grid/series` | Strip `/grid`; allowlist is symbol, interval, start, end and provider (`kdb\|eodhd`). |
| `GET /grid/ta_chart` | As above, with v12.4's additional `provider` and `basis` (`adjusted\|raw`) allowlisted. |
| `GET /grid/ta_series_ws` with Upgrade | Query-scoped study socket: the validated connect URL is the entire contract, so the upstream opens immediately on upgrade and any later client frame closes the socket. |

All responses used as data must be JSON; redirects are refused, requests have a 12-second timeout, REST bodies are capped at 2 MiB and socket messages at 64 KiB. Client Cookie, Authorization and arbitrary headers never reach the upstream. Backend errors, redirects, Set-Cookie and authentication challenges are not forwarded to viewers.

Do not repoint the existing Tailscale `:443` route, enable Funnel on existing service ports, or expose tick/kdb+ as part of this PR. Prefer a separately scoped ingress identity/service; retain the existing private preview and all current routes unchanged. An Internet request with no/incorrect machine token must fail at that ingress, even if the caller knows its hostname.

## Activation blockers and acceptance checklist

No deployment is authorized by this document. Resolve these items before a separate go-live approval:

- **Vercel access/plan:** confirm the account can import this private organization repository without making it public. Hobby teams cannot deploy private organization repositories through Git integration ([Vercel Git/Hobby guidance](https://vercel.com/docs/git#using-hobby-teams)). Any plan change requires approval.
- **OAuth and identity:** register the viewer OAuth app, configure exact callback/domain, supply secrets through the platform, and confirm the first approved IDs. Until then, keep the allowlist empty.
- **Ingress:** implement and independently test the machine-authenticated public ingress described above. Missing upstream configuration yields 503 rather than falling back to internal URLs.
- **Rate/cost controls:** configure shared edge/ingress limits, per-viewer/provider budgets and monitoring before Internet exposure. This implementation has only an instance-local 60-request/minute budget per ID; a WS upgrade costs six units. It is a safety brake, NOT a distributed quota or abuse-prevention system. Anonymous OAuth attempts also need edge limits.
- **Redistribution:** confirm market-data and feed redistribution rights for the intended users before granting access.
- **Sockets open on the gateway, not here (socket tickets):** a socket relayed through a Vercel Function bills function time for as long as it stays open, and the preview's sockets (News, live grid, study series) are always open. So the browser build swaps in a socket shim (`src/browser-shim/socket.ts`): for a same-origin socket it first asks `GET /socket-ticket?for=<path+query>` — session required, the target validated by exactly the rules the upgrade handler applies, one budget unit (it cost six until 2026-09-21: every range change on a chart rebuilds its study socket, and five chip clicks spent the whole 60-a-minute budget, after which the chart's bars were refused) — and gets back `wss://<gateway>/<target>&ticket=<expiry>.<nonce>.<HMAC>`. The ticket is signed with a key derived from `BACKEND_GATEWAY_TOKEN` (no new secret; the token itself never reaches a browser), lasts thirty seconds, names one exact target and is single-use at the gateway. `connect-src` gains the gateway's `wss:` origin and nothing else. The gateway must name this preview in its `previewOrigin` setting or it refuses every ticket. A lapsed session cannot get a ticket, so a socket outlives its session by at most one gateway socket lifetime (240 s).
- **Saved configuration (per-user state):** the browser build's file shim is memory, so `src/browser-shim/fs.ts` mirrors the app's own JSON stores to `PUT`/`DELETE /state/<file>` — with Rita, the only non-GET routes here. They ask for more than a GET does: a session, an `Origin` that is present and ours, `Sec-Fetch-Site: same-origin` when sent, `application/json`, 256 KiB, an allow-listed file name (`policy.mjs` `stateFile`), one budget unit. The gateway path is `/state/<GitHub id>/<file>`, and the id is the session's, never anything the browser sent. `/preview-bootstrap.js` reads `GET /state/<id>` and seeds the page with it (saved state replaces the default seed; an empty store seeds the defaults). The page is told it may save (`window.__bdobbPersist`) **only when that read succeeded** — a first save over a store that could not be read would replace the user's dashboards with the defaults. **Backends are saved as typed, credentials included** (owner's ruling 2026-09-20); they live in the gateway's `runtime/state`, not on Vercel.
- **Rita:** the seeded `settings.json` points her at this origin (`ritaUrl: <origin>/ai`) whenever a gateway is configured. `GET /ai/agents.json` rides the ordinary JSON relay. `POST /ai/v1/query` is, with `/state`, the only non-GET route: the same session + present-and-ours `Origin` + `Sec-Fetch-Site` guard, `application/json` up to 1 MiB (a turn carries the widget data she was shown), six budget units of a user's 240 a minute (forty turns), and her `text/event-stream` relayed unbuffered for at most five minutes and 16 MiB. Nothing of the browser's goes upstream but the body; anything from upstream that is not an event stream is a `502`. A turn holds a Vercel Function open for as long as she is answering — unlike the sockets it is short, which is why it is relayed rather than ticketed. MCP tool servers a user adds are NOT relayed.
- **WebSocket runtime (the relay, for a plain Node host):** the same-origin upgrade relay below is what `web/local.mjs` and any non-Vercel host use. On Vercel it would need Fluid compute and the WebSockets permission. Vercel documents native Node WebSocket support, but connections are instance-pinned and close at function duration; do not assume it is available until tested in the target project ([Vercel WebSockets](https://vercel.com/docs/functions/websockets)). This relay closes at 240 seconds or session expiry, whichever is earlier; the News hook reconnects and reseeds.
- **DNS:** add only the exact GoDaddy record returned by Vercel after the approved project/domain exists; do not guess the CNAME target or change unrelated records.
- **Independent network test:** from off-tailnet, check login and logout, allowed/denied GitHub accounts, empty allowlist, all deployment aliases, unauthenticated asset URLs, browser Network logs for credentials, REST data, WS 101, wrong-Origin WS refusal and reconnect/reseed across 240 seconds and a deployment.
- **Data accuracy:** verify the separately controlled backend quote percentage fix is actually installed before describing the quote display as corrected.

Removing an ID or changing the epoch requires the runtime configuration to be updated/redeployed. Existing sockets may live for up to 240 seconds; signing out clears the browser cookie but does not revoke a stolen JWT across instances. For emergency revocation, disable the ingress token and deployments immediately, rotate `AUTH_SECRET`/epoch and disable old deployment URLs; for immediate per-user revocation, add a shared session store before launch. Do not promise instantaneous distributed logout with these bounded JWT sessions.

## Test scope

`pnpm test:web` covers configuration fail-closed behavior, GitHub ID admission, session tampering/expiry/revocation, CSRF/PKCE/state initiation, cookie-only authentication, private static files, Host/Origin/traversal checks, exact route/query policy (including every `/grid/` route's parameter contract), live-grid frame revalidation, server credential isolation, error/body limits and real local WebSocket relays to mock backends. It does not contact GitHub for a real OAuth exchange, query live market-data providers, change the NAS, or deploy to Vercel.

Local tests do not prove platform-specific routing or OAuth completion. Keep the activation checklist open until those live checks have been completed with explicit approval.

`pnpm test:web:browser` runs a reproducible Playwright smoke test against a real loopback HTTPS server with a synthetic session and an in-memory per-user state store. It verifies the sign-in form, denied anonymous metadata, the seeded built-ins dashboard (the Grouping tab's Parameter echo card: AAPL edited to MSFT, saved to the user's state and reseeded after a reload), a lapsed session sending the next edit to sign-in, CSRF sign-out clearing the cookie and returning to login, and mobile login width. It blocks external requests, so it does not complete a real GitHub OAuth exchange. Run `pnpm build:web` first and install Playwright Chromium. CI runs it in the `e2e` job after `pnpm build:web`.
