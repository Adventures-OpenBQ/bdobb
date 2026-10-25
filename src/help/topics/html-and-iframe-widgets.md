# HTML and iframe widgets

Two kinds of widget put a web page inside a card.

An **HTML widget** fetches markup from its backend and renders it in a
sandboxed frame. A non-string payload reads *This payload is not HTML.*

An **iframe widget** — including the **Website** built-in — points at a real
address and fetches nothing. The address *is* the widget. An address that is
not `http` or `https` reads
*This address is not a valid http or https URL.*

![An iframe widget and an HTML widget side by side](./shots/html-and-iframe-widgets.png)

## Why some sites refuse to be framed

Many sites send `X-Frame-Options` or `Content-Security-Policy: frame-ancestors`
and will not be shown inside another app. A cross-origin frame a site refused
to serve looks exactly like one that merely rendered nothing, and the card
cannot tell the two apart. So every iframe card carries a permanent footer
under the frame reading **Blank? The site may refuse to be embedded.**, beside
an **Open externally ↗** button. At this version the app makes no check of its
own before framing an address.

**Open externally ↗** opens the address in your default browser.

## Talking to the app from inside the frame

A cooperating page can exchange four messages with the card it sits in.
Messages are ignored unless they come from that card's own frame, so two framed
cards on one dashboard can never speak for each other.

`openbb-connect`, sent by the page, announces it. The app answers with
`openbb-auth` carrying `headers` — the same header map the backend's own
requests use — but only when all three of these hold: the message's origin
exactly matches the frame's own, that origin is nameable (so never a
server-rendered HTML widget, which has no origin), and the backend actually has
header credentials. Auth is always posted to that exact origin, never
broadcast. Two consequences worth knowing: an HTML widget is never sent auth,
and neither is the **Website** built-in, because a hand-typed address names no
backend.

Whether or not auth was sent, a connect is always answered with an
`openbb-params-update` so the page starts in sync.

`openbb:widget-params:update`, sent by the page, asks the card to change a
parameter. It takes either `params` as a map, or a `paramName` and a `value`.
Only parameters the widget actually declares are accepted; anything else is
dropped. Accepted values commit through the card's normal path, so a grouped
parameter propagates to the whole group and a run-button card marks itself
stale rather than fetching. A page echoing back a value it was just given
writes nothing.

`openbb-params-update`, sent by the app, carries the card's full effective
parameter map. It is sent on connect and again whenever the parameters change.
It carries no credential — these are the same values the header's controls row
shows and every request puts in a query string.

Sub-widget data messages are recognised and ignored.

[shot-pending]: #21
