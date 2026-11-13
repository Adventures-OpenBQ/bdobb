---
type: Note
tags: [bdobb, help, web, vercel, github, preview]
---

# Web Preview

From v3.1.0 a read of the app's own dashboard grid — not the desktop app itself — can be deployed as a private, GitHub-gated web page. It exists so someone without the desktop app installed can be shown what BDOBB looks like, on a page only approved GitHub accounts can open. It is a preview, not a second way to run the app day to day: it needs a browser, it needs a connected stack behind a Tailscale-published door to show real data, and what it saves is limited by design.

## Signing in

The page opens on a sign-in screen naming **Continue with GitHub**. A GitHub account not on the operator's allow-list can complete OAuth but is still refused — the session is issued, the app is not shown. There is no other way in: no password, no invite link, no anonymous read.

## What it can reach

At this version the preview relays three families through the gateway it is paired with (openbq-docker v3.0.0's `funnel-gateway` service, `web` profile):

- **`/api`** — the whole OpenBB widget catalogue, forwarded to the stack's API (`openbq-api`) behind the GitHub gate. Every request is bounded structurally (path shape, query-pair count, value length, no control characters) rather than by a per-route list, so the app's own dashboards work against it exactly as they do against any other backend.
- **`/ref`** — the whole Episode 3 reference backend, keyless. Its root documents are served at exact paths; every other reference GET is bounded like `/api`, and `/ref/omni*` is refused.
- **`/state`** — a signed-in user's own saved dashboards and settings, one JSON file at a time, kept per GitHub account. Nothing is saved until this route has proven it can be read back; a preview that could not confirm the store works never pretends changes are being kept.

There is **one socket**: the reference backend's Live Grid (`/ref/live_grid_ws`). The browser asks the gateway for a thirty-second, single-use ticket and opens the socket on the gateway directly, not through the Vercel Function; each frame it sends is re-validated. The page's own upgrade handler still refuses every socket.

## The reference backend in the preview

The preview seeds a backend named "OpenBQ Reference (preview)" at `<preview origin>/ref`. A preview profile that already has saved connections does not get it added automatically: add it yourself under Connections, with the URL `<preview origin>/ref`.

From v3.2.1 the page's content security policy allows framing exactly one origin, `https://www.youtube.com`, so a YouTube card such as the Video Library plays in the preview (see [[example-dashboards|Example Dashboards]]); before it, the policy allowed no framed content at all.

## What it shows on first open

With no saved state yet, the preview seeds the **built-in widgets** example dashboard (see [[example-dashboards|Example Dashboards]]) — the one thing it can show correctly with no backend configured at all, no key and no sign-up. Once a change is saved, that becomes what reopens instead.

## What resets

A layout tweak, a parameter edit, a view toggle — anything the desktop app would normally write to disk — is written here to the per-user store behind `/state` instead, and reloads with it. If that store cannot be reached, the page still works but says so: changes made in that session are memory-only and are gone on reload, exactly as if nothing had been saved.

*Source: BDOBB v3.1.0 `web/server.mjs`, `web/bootstrap.mjs`, `web/policy.mjs` (vendored from openbq-docker v3.0.0's `funnel-gateway/policy.mjs`), `src/browser-shim/socket.ts` and `web/security.test.mjs` at `v3.1.0`; the `frame-src` directive in `web/server.mjs` at `v3.2.1`.*
*See also: [[openbq-docker-stack|The openbq-docker Stack]] · [[tailscale-networking|Tailscale Networking]] · [[example-dashboards|Example Dashboards]] · [[backends-and-connections|Backends and Connections]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
