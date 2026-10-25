---
type: Note
tags: [bdobb, help, web, vercel, github, preview]
---

# Web Preview

From v3.1.0 a read of the app's own dashboard grid — not the desktop app itself — can be deployed as a private, GitHub-gated web page. It exists so someone without the desktop app installed can be shown what BDOBB looks like, on a page only approved GitHub accounts can open. It is a preview, not a second way to run the app day to day: it needs a browser, it needs a connected stack behind a Tailscale-published door to show real data, and what it saves is limited by design. From v4.0.0 it is offered with the openbq-docker stack, over HTTP, through that stack's gateway; v8 adds the News wire and its socket.

## Signing in

The page opens on a sign-in screen naming **Continue with GitHub**. A GitHub account not on the operator's allow-list can complete OAuth but is still refused — the session is issued, the app is not shown. There is no other way in: no password, no invite link, no anonymous read.

## What it can reach

At this version the preview relays these families through the gateway it is paired with (openbq-docker v9.0.0's `funnel-gateway`, the same door as openbq-docker v8.0.0's, started by that stack's `web` compose profile):

- **`/api`** — the whole OpenBB widget catalogue, forwarded to openbq-api behind the GitHub gate. Every request is bounded structurally (path shape, query-pair count, value length, no control characters) rather than by a per-route list, so the app's own dashboards work against it exactly as they do against any other backend.
- **`/state`** — a signed-in user's own saved dashboards, workspaces, saved layouts and settings, one JSON file at a time, kept per GitHub account. Nothing is saved until this route has proven it can be read back; a preview that could not confirm the store works never pretends changes are being kept.

- **`/table`** — with the stack's `table` profile (from v4), the managed server tables. The seeded connections include **Managed tables** at the preview's own `/table`. See [[tables|Tables]].

- **`/ref`** — the whole Episode 3 reference backend, keyless (from v3). The seeded connections include "OpenBQ Reference (preview)" at the preview's own `/ref`; a preview profile that already has saved connections does not get it added automatically, so add it under Connections with that URL. Its Live Grid socket, `/ref/live_grid_ws`, opens on the gateway with a thirty-second, single-use ticket, like the News socket below.

- **`/news`** — the News wire, for the operator's **approved feeds** only (`NEWS_APPROVED_FEEDS_JSON`, approved feed URL to rss-ticker feed id; no two feeds may share an id, as the gateway refuses that too). Each feed's recent headlines come over HTTPS from `/news/api/news`, for an approved id and a limit of 1 to 50 and nothing else. The live socket is `/news/ws/news`: the page asks the preview for a short-lived, single-use ticket at `/socket-ticket` and opens the socket **on the gateway** with it, so no credential ever sits in the browser. The one frame a card may send — its subscription — is rebuilt from the approved feeds alone: an unapproved feed is dropped, a display name is stripped, and a second frame closes the socket. Coming back, the gateway passes only the server's feed-id reply and the approved feeds' stories; anything else is dropped. There is no per-viewer request budget at either layer. Without approved feeds, or without a gateway, the socket answers 503.

There is **no Rita or MCP route**, and no `/ai` family at all. The gateway relays neither, and the page is handed no Rita URL, so the Rita pane and the AI Library's agent features have nothing to talk to in the preview; they are for the desktop app. See [[rita-chat|Rita (AI Chat)]].

The reference's Live Grid socket and the News socket are the **only socket routes**. Any other upgrade request is refused outright rather than half-answered.

From v3.2.1 the page's content security policy allows framing `https://www.youtube.com`, so a YouTube card such as the Video Library plays in the preview (see [[example-dashboards|Example Dashboards]]); before it, the policy allowed no framed content at all. The seeded Website card's `https://docs.openbb.co` is the only other origin it frames, and the seeded RSS card's `https://rss.nytimes.com` is the only outside origin the page may fetch from directly; any other framed page or directly fetched feed is refused.

## What it shows on first open

With no saved state yet, the preview seeds the **built-in widgets** example dashboard (see [[example-dashboards|Example Dashboards]]) — the one thing it can show correctly with no backend configured at all, no key and no sign-up. When the operator has configured **both** approved feeds and the gateway, the seed gains a **News** tab: one News card subscribed to every approved feed. That card names no server of its own; a News card with no server in the preview uses the preview's own `/news` relay. See [[news-widget|The News Widget]]. Once a change is saved, that becomes what reopens instead.

## What resets

A layout tweak, a parameter edit, a view toggle — anything the desktop app would normally write to disk — is written here to the per-user store behind `/state` instead, and reloads with it. If that store cannot be reached, the page still works but says so: changes made in that session are memory-only and are gone on reload, exactly as if nothing had been saved.

*Source: BDOBB v3.1.0 `web/server.mjs`, `web/bootstrap.mjs`, `web/policy.mjs` and `web/security.test.mjs` at `v3.1.0`; the `frame-src` directive in `web/server.mjs` at `v3.2.1`; at 8.0.0, `web/config.mjs`, `web/bootstrap.mjs`, `web/server.mjs`, `src/browser-shim/socket.ts` and `web/policy.mjs` (vendored from openbq-docker v8.0.0's `funnel-gateway/policy.mjs`), and `web/README.md`; the `/ref` family and its socket from v3.0.0.*
*See also: [[news-widget|The News Widget]] · [[openbq-docker-stack|The openbq-docker Stack]] · [[tailscale-networking|Tailscale Networking]] · [[example-dashboards|Example Dashboards]] · [[backends-and-connections|Backends and Connections]]*
