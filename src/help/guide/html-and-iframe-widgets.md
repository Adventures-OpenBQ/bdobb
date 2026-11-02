---
type: Note
tags: [bdobb, help, widgets, html, iframe, website, embed]
---

# HTML and iframe Widgets

Two kinds of widget put a web page inside a card.

An **HTML widget** fetches markup from its backend and renders it in a sandboxed frame. A non-string payload reads *This payload is not HTML.*

An HTML widget that declares `raw: true` — and a YouTube widget that does — gets a **Raw** view that asks its endpoint again with `raw=true` added to the card's parameters. A list of records, or an object whose `results` is one, is shown as a table; anything else as JSON. The normal view never sends `raw`, and **Refresh** while Raw is showing repeats the raw request. Without `raw: true`, Raw shows the payload already fetched, as on every other card.

An **iframe widget** — including the **Website** built-in — points at a real address and fetches nothing. The address *is* the widget. An address that is not `http` or `https` reads *This address is not a valid http or https URL.*

## Why some sites refuse to be framed

Plenty of sites send a header telling a browser not to embed them. The app makes no check of its own — there is no out-of-band probe, and no header is ever read — so a card cannot know in advance, and it cannot tell a refusal apart from a page that simply rendered nothing. A refused frame is just blank.

Every **iframe** card therefore carries the same permanent footer, on every address, reading **Blank? The site may refuse to be embedded.** beside an **Open externally ↗** button, which opens the address in your default browser. An HTML widget has no footer: its markup comes from the backend, so there is no address to open.

The only address check is the http/https one above. Nothing about a loopback, link-local or private-range address is treated differently.

## Talking to the app from inside the frame

A cooperating page can exchange four messages with the card it sits in, following OpenBB Workspace's iframe protocol. Messages are ignored unless they come from that card's own frame, so two framed cards on one dashboard can never speak for each other.

- **`openbb-connect`**, sent by the page, announces it. The app answers with **`openbb-auth`** carrying `headers` — the same header map the backend's own requests use — but only when all of these hold: the message's origin exactly matches the frame's own, that origin is nameable (so never a server-rendered HTML widget, which has no origin), **the frame's origin is the backend's own**, and the backend actually has header credentials. Auth is always posted to that exact origin, never broadcast.

  That third condition is the one worth dwelling on. A backend iframe widget frames whatever address its `widgets.json` gave, and nothing stops a manifest naming a third-party page. Were the credential handed to any frame that asked from its own origin, a backend could hand your credential to someone else's website simply by listing it. So the headers are chosen only when the framed page sits on the same origin as the backend itself; **any other origin gets an empty header map** and is none the wiser. It still receives the parameters, so a cooperating page on a third-party origin keeps working — it simply never sees a credential.

  Two further consequences: an HTML widget is never sent auth, and neither is the **Website** built-in, because a hand-typed address names no backend.
- Whether or not auth was sent, a connect is always answered with an **`openbb-params-update`** carrying the card's full effective parameter map, so the page starts in sync; it is sent again whenever the parameters change. It carries no credential.
- **`openbb:widget-params:update`**, sent by the page, asks the card to change a parameter. Only parameters the widget actually declares are accepted; a value is truncated at 4096 characters, and a `null` becomes the empty string. Accepted values commit through the card's normal path, so a grouped parameter propagates to the whole group and a run-button card marks itself stale rather than fetching.

Any other message is dropped in silence — sub-widget data and theme messages are not parsed at all.

---
*Source: BDOBB v3.0.1 in-app manual, "HTML and iframe widgets"; `BDOBB` `src/components/WidgetCard.tsx` at `v3.0.1`.*
*See also: [[built-in-widgets|Built-in Widgets]] · [[card-parameters|Card Parameters]] · [[troubleshooting-using-bdobb|Using BDOBB]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
