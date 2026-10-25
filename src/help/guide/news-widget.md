---
type: Note
tags: [bdobb, help, widgets, news, rss, rss-ticker, wire]
---

# The News Widget

The **News** widget is a headline wire: newest story first — down a list of rows or across a strip of cards, whichever layout you pick — a publisher icon and a time on every headline, headlines sorted into tabs you define, and the keywords you care about painted in the accent colour. It is a **built-in**, so it needs nothing added in Connections, and it reads its headlines from an **rss-ticker** server (the card calls it the *RSS Aggregator*) that polls the feeds you name and pushes new stories to the card over a live connection.

**You own the subscription.** Which feeds, under which tab, is saved on the card itself; the server is a shared feed pool that knows nothing about who is reading, polls what its connected cards ask for, and stops when nobody is asking. Two cards naming the same feed cost the server one poll.

![A News card in the horizontal layout, with its feed tabs](../attachments/news.png)

## Adding it

Add **News** from the widget library's **Built-in** category. It has three parameters:

- **RSS Aggregator Server** — the base URL of the rss-ticker server. Until it is set the card reads *Enter the RSS Aggregator server in Parameters.*; a value that is not `http` or `https` reads *Enter an http or https server URL.*
- **Layout** — **Vertical** (the default), a list of rows, or **Horizontal**, a strip of cards.
- **Auto-scroll** — **Off** (the default), **Slow**, **Medium** or **Fast**, for the horizontal strip only.

With a server and no feeds, the card's body offers **Configure feeds…** directly — except on a locked card or in a viewer window, which read *No feeds configured.* and offer no tab dragging either.

The card is a rail, not a window: it has **no title bar**, so the headlines start at its very top edge. A narrow strip down its right edge reads **RSS Aggregator** — rename the card and it reads your name — and is the handle you drag the card by. The chevron at the top of that strip opens the card's menu, in order: **Rename…**, **Configure feeds…**, **Export feeds…**, **Import feeds…**, **Parameters**, **Duplicate**, **Copy to ▸**, **Maximize**, **Pin widget ▸**, **Refresh** and **Close** — plus **Share with Rita** while Context sharing is on, and **Expand** when the card is minimized, since a rail has no header to expand it from. **Parameters** opens the card's parameter row above the headlines, the same saved panel every card has, and reads **Hide parameters** while it is open. There is no **Export ▸**: the card fetches no table to write out. Its feed list travels instead — see below.

## The two layouts

**Vertical** is the wire as a list: one row per headline, newest at the top, the time and the publisher's icon at the left. It is the shape for a tall card down the side of a dashboard.

**Horizontal** is a strip of cards side by side, newest at the **left**, that scrolls sideways. It is the shape for a wide, short card along the bottom of a tab, which is the widget's own default size (the full 40 columns by 8 rows). A strip headline fills its card: how many lines it may take is measured from the card, so a taller card shows more of each headline instead of cutting it off.

**Auto-scroll** makes the strip glide on its own — about 20, 45 or 90 pixels a second for **Slow**, **Medium** and **Fast**. It starts at the oldest end of the strip and the cards drift right, so the newest headlines come into view last; when its own glide reaches the newest it wraps back to the oldest end. Put the strip at the start yourself — **Beginning**, the wheel, a drag — and it holds on the newest instead, with fresh headlines arriving in view, until you move it away. It **pauses while the pointer is over the strip and while any story in it has focus**, so you are never scrolled away from what you are reading, and a fresh headline arriving does not restart it. Under the vertical layout the setting does nothing.

## Configuring feeds

**Configure feeds…** opens the feed manager: one row per feed with a **Source** (the feed URL; anything not `http` or `https` is flagged *Not an http or https URL*), an optional **Name** shown on its headlines, and an optional **Tab**. Rows can be added, removed and moved up or down. **Highlight keywords** at the bottom is a comma-separated list. A Substack newsletter's feed is `https://<name>.substack.com/feed`.

The card subscribes to each feed URL **once**, and to **at most the first 50** in the list. A second row naming a URL already listed adds nothing — its headlines are the first row's — and a row past the fiftieth is kept on the card but not subscribed. Fifty is the most one subscription may name, and the web preview's relay and the openbq-docker gateway refuse a longer or repeated list outright, which would leave the card blank.

The tabs along the bottom of the card are yours. **All** is always first and shows every feed newest first; every distinct tab name becomes one more tab, two feeds with the same tab name share it, and a feed with no tab appears under All only. **To reorder the tabs, drag one onto another** — dropped on a tab to its right it lands after that tab, on one to its left before it. All cannot be moved. A tab added later joins after the ones you have ordered.

## Reading the wire

Each headline shows its time — followed by `[-1]`, `[-2]`… for a story dated before today, which a weekly newsletter often is — the publisher's icon and the title. A story whose link is a video (a `video` or `videos` segment in its path, which is how most publishers mark one) carries a small **▶** — at the end of the title on the list, beside the time on a strip card. A newsletter post with a distinct author reads *Title - Author*. A headline holding any highlight keyword is coloured. A title its publisher escaped twice is decoded once before it is drawn, so `&amp;` reads as the ampersand that was meant.

**Scrolling, four ways.** The wheel works; over the strip a vertical wheel turns into sideways travel. You can **drag** the list or the strip with the mouse. A finger scrolls both natively. And the **four buttons at the right end of the tab bar** page and jump — **Beginning**, **Page back**, **Page forward** and **End** on the strip; **Top**, **Page up**, **Page down** and **Bottom** on the list. On the list a page is nine tenths of what is in view, so the headline at the edge carries over. On the strip a page lands on a card's left edge, so the first card in view is always whole: the card the right edge cut off leads the next page, and paging back stops at the first card that fits.

**A single click does nothing, on purpose**: rows sit close together, and a drag must never open a story by accident. **Double-click** a headline — **double-tap** it with a finger — or focus it and press **Enter** to open the story in your browser. Always the system browser, never inside the app, so a paywalled story opens with whatever subscription login already lives there; the widget holds none of your publisher credentials.

The dot at the left of the tab bar is the wire: grey while connecting, green when live, red while reconnecting. A drop reconnects after three seconds, and **Refresh** or `⌘R` reconnects at once, as does coming back to the app after it was in the background. A reconnect or a Refresh to the same server keeps the headlines already shown. **Change the server** in Parameters and the card **starts empty** instead, and fills from the new server: each server numbers its own feeds, so another server's headlines kept across the switch could land under the wrong feed.

## Moving a feed list

**Export feeds…** writes the card's feeds, tabs, highlight keywords and tab order to a file named `rss-agg.json`; **Import feeds…** reads one back and replaces the card's configuration with it, all or nothing — a file with a bad row is refused. That is how one wire travels to another dashboard or another machine, an iPad included.

The whole dashboard carries it too. **Save…** in the **BDOBB Workspace** format writes the list in BDOBB's v8 extension, so the file opens in BDOBB 8.0.0 or later; **Save…** in the **Strict OpenBB Workspace** format writes no feeds. The dashboard sync with a Workspace server carries the list to your other devices the same way. See [[import-and-export|Import and Export]].

## The wire along the bottom of every dashboard

A News card on a tab is a card on that tab. To keep it in view while the rest of that tab scrolls, **Pin widget ▸ Pin to bottom**. To have it along the bottom of **every** dashboard, lock it: **Settings ▸ Locked Widgets ▸ Locked at Bottom…**. Locked, it stays connected while you change dashboards, its height is the band's, and nothing that would change it — Parameters, Configure feeds…, Import feeds…, Rename…, Close — is offered outside the band editor. See [[locked-and-pinned-widgets|Locked and Pinned Widgets]].

## The server

On the companion stack the server is openbq-docker's **rss-ticker** container (built locally from openbq-docker's vendored `rss-ticker/` as `openbq-rss-ticker:9.0.0`; nothing is pulled). It is one of the two services of the opt-in `web` compose profile, but **a desktop News card needs only rss-ticker, not the web preview's door**, and the profile cannot start without the door's files (`gateway.env` and `gateway-config/`). So start rss-ticker alone, from the openbq-docker checkout:

1. `cp rss-ticker-config/config.yaml.example rss-ticker-config/config.yaml` — rss-ticker will not start without a `config.yaml`, and the checkout ships only the example.
2. `docker compose up -d rss-ticker` — naming the service starts it without the profile, so none of the gateway's files are needed. Compose builds the image the first time. Add the same `-f` files you run the stack with (for example `-f docker-compose.yml -f docker-compose.v3.yml`).

Every one of the stack's tailnet Serve configurations — `serve.json`, `serve-v3.json`, `serve-v3-keys.json`, `serve-v6.json`, `serve-v6-keys.json` and `serve-v6-services.json` — publishes it on your tailnet at port **8088**, and so do the two Funnel files, which funnel port 10000 alone; 8088 is never funneled. Until rss-ticker runs, 8088 answers 502. The card's server is `https://openbq.<your-tailnet>.ts.net:8088`. rss-ticker has **no authentication**: it relays public RSS, and being reachable only from your tailnet is its whole protection. The card sends no key. See [[openbq-docker-stack|The openbq-docker Stack]] and [[tailscale-networking|Tailscale Networking]].

On connecting, the card opens a socket to the server's `/ws/news`, sends its own feed list as the one and only subscription frame, keeps the feed ids the server replies with, then fetches each feed's latest stories over REST. A changed feed list, a Refresh or a reconnect opens a new connection rather than re-subscribing on the old one. The server sends each connection only the stories of the feeds that connection subscribed to; the card filters incoming stories to its own feeds as well, and the active tab filters further.

**In the web preview** the card does not talk to rss-ticker at all. A News card with no server of its own uses the preview's own `/news` relay; the browser asks the preview for a short-lived ticket and opens the socket on the openbq-docker gateway with it, and only the feeds the operator approved are relayed: the gateway rebuilds the subscription from the approved feeds alone and passes back only those feeds' stories. See [[web-preview|Web Preview]].

## How the server works

rss-ticker is a **user-agnostic shared feed pool**: it knows nothing about who is reading, holds no keys, and polls only what connected cards have asked for.

- **Configuration is operational only.** `config.yaml` takes `retention_days`, `default_poll_interval_s`, `max_concurrent_polls`, `bind_host` and the optional `live_tv` list, and the server refuses to start on any other key. There is no feed list: feeds, tabs and highlight keywords live on each News card and travel with the dashboard.
- **One pool, de-duplicated.** A feed's identity is its canonical URL: scheme and host lowercased, and one trailing slash stripped when nothing follows the path. A URL another card already subscribed is never polled twice.
- **Polled only while watched.** Each feed counts the open connections that name it. A feed is polled while that count is above zero and stops the moment it reaches zero. Every feed starts switched off when the server boots, and a reconnecting card switches its own back on within seconds, so nothing is polled while nobody is connected.
- **Retention.** An article is kept for `retention_days` after the feed last listed it; an hourly sweep deletes older ones.
- **Fan-out.** Each new article goes to every connection whose subscription names its feed. A connection that falls too far behind is closed rather than allowed to hold up the rest.
- **The back catalogue.** A feed's first successful poll caches everything the publisher lists and pushes it to the connections that subscribed it, so a feed you have just added fills straight away. After that, an article dated earlier than the feed's previous successful poll, less an hour's grace, is cached but not pushed live, so an article that aged out and came back does not arrive as breaking news. An article with no date is always pushed.
- **Polite polling.** One interval for every feed, `default_poll_interval_s`, varied by up to 10% either way; conditional requests (ETag and Last-Modified) so an unchanged feed costs the publisher almost nothing; after a failure the interval doubles per consecutive failure up to an hour, and a publisher's `Retry-After` is honoured (at least 5 seconds, at most an hour). Publishers monitor, and an over-eager poller gets throttled, so set the interval deliberately: 90 seconds suits a pool of wires, 300 suits blogs and newsletters.
- **Favicons.** The subscribe reply carries each feed's icon, resolved against the feed's own host, except for the hosts the server knows: Bloomberg's, Dow Jones's and CNBC's syndication hosts map to the publisher's own domain, the FT's icon comes from its image CDN, and a Google News search feed scoped with `site:` takes that site's icon.

## The other RSS widget

There is also a plain **RSS feed** built-in that fetches one feed directly from the app, with no server at all. It is the right choice for one feed on one tab; the News widget is for a wire. See [[built-in-widgets|Built-in Widgets]].

---
*Source: the in-app "News" topic; `src/components/renderers/NewsRenderer.tsx`, `src/components/dialogs/NewsFeedsDialog.tsx`, `src/components/WidgetCard.tsx` (the rail's menu), `src/hooks/useNewsWire.ts`, `src/lib/news.ts`, `src/lib/newsFile.ts` and `src/lib/builtins.ts` at 8.0.0; openbq-docker `docker-compose.yml`, `rss-ticker-config/config.yaml.example`, `funnel-gateway/README.md`, every `ts-config/serve*.json`, and `rss-ticker/src/rss_ticker/` (`store.py`, `broadcast.py`, `poller.py`, `fetch.py`, `favicon.py`, `main.py`) at v8.0.0. Ported from the bdobb-v2 v8.1.2 guide page "The News Widget" and checked against this line's code.*
*See also: [[locked-and-pinned-widgets|Locked and Pinned Widgets]] · [[built-in-widgets|Built-in Widgets]] · [[import-and-export|Import and Export]] · [[web-preview|Web Preview]] · [[example-dashboards|Example Dashboards]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
