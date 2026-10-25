# News

The **News** card is a headline wire: the newest story first, a publisher icon
and a time on every headline, the headlines sorted into tabs you define, and
keywords you choose painted in the accent colour. It is a built-in — add it
from the widget library's **Built-in** category — and it reads its headlines
from an **rss-ticker** server (an *RSS Aggregator*), which polls the feeds you
name and pushes new stories to the card over a live connection.

![A News card in the horizontal layout, with its feed tabs](./shots/news.png)

## Setting it up

The card has three parameters. **RSS Aggregator Server** is the server's base
URL; until it is set the card reads *Enter the RSS Aggregator server in
Parameters.* **Layout** is **Vertical** (the default), a list of rows, or
**Horizontal**, a strip of cards newest at the left that scrolls sideways.
**Auto-scroll** — **Off**, **Slow**, **Medium** or **Fast** — makes the
horizontal strip glide on its own, about 20, 45 or 90 pixels a second, and
pauses while the pointer is over it or a story in it has focus; it does
nothing in the vertical layout. The glide starts at the oldest end and drifts
toward the newest, then wraps back to the oldest end; put the strip at the
start yourself (**Beginning**, the wheel, a drag) and it holds on the newest
until you move it away.

With a server and no feeds, the body offers **Configure feeds…**. The feed
manager has one row per feed: a **Source** (the feed's URL; anything not
`http` or `https` is flagged *Not an http or https URL*), an optional **Name**
shown on its headlines, and an optional **Tab**. Rows can be added, removed
and moved. **Highlight keywords** below them is a comma-separated list. The
card subscribes to each feed URL once and to at most the first 50 feeds; a
repeated URL adds nothing, and rows past the fiftieth stay on the card
unsubscribed.

## The card is a rail

A News card has no title bar, so the headlines start at its top edge. The
narrow strip down its right edge carries the card's name — *RSS Aggregator*
until you rename it — and is the handle you drag the card by. The chevron at
the top of the strip opens the card's menu: **Rename…**, **Configure feeds…**,
**Export feeds…**, **Import feeds…**, **Parameters**, **Duplicate**,
**Copy to ▸**, **Maximize**, **Pin widget ▸**, **Refresh** and **Close**, with
**Share with Rita** while Context sharing is on and **Expand** when the card is
minimized. **Parameters** opens the card's parameters above the headlines and
reads **Hide parameters** while they are open. There is no **Export ▸**: the
card fetches no table to write out; its feed list travels instead.

## Reading it

The tabs along the bottom start with **All**, every feed newest first; each
distinct tab name you gave a feed becomes one more tab, and a feed with no tab
appears under All only. Drag a tab onto another to reorder them; All never
moves.

Each headline shows its time — followed by `[-1]`, `[-2]`… for a story dated
before today — its publisher's icon, and the title. A story whose link is a
video carries a small **▶**. A headline holding a highlight keyword is
coloured.

A single click does nothing, so a drag never opens a story by accident.
**Double-click** a headline (double-tap it with a finger), or focus it and
press **Enter**, to open the story in your system browser — never inside the
app, so a paywalled story opens with the login your browser already has.

Scroll with the wheel, by dragging the list or the strip with the mouse, or
with a finger. The four buttons at the right end of the tab bar page and jump:
**Beginning**, **Page back**, **Page forward** and **End** on the strip;
**Top**, **Page up**, **Page down** and **Bottom** on the list. A page on the
list is nine tenths of the view; a page on the strip lands on a card's edge,
so the first card in view is whole.

The dot at the left of the tab bar is the wire: grey while connecting, green
when live, red while reconnecting. A dropped connection retries after three
seconds; **Refresh**, or `⌘R`, reconnects at once, keeping the headlines
shown. Point the card at a different server and it starts empty and fills
from the new one.

## Moving a feed list

**Export feeds…** writes the card's feeds, tabs, highlight keywords and tab
order to `rss-agg.json`; **Import feeds…** replaces the card's list with a
file's, all or nothing — a file with a bad row is refused. A dashboard's
**Save…** in the **BDOBB Workspace** format carries the list too, in BDOBB's v8
extension, and the dashboard sync carries it to your other devices; a plain
OpenBB export does not. See **Import and export**.

The example *Example Dashboard - Version 8.0.0*,
`docs/examples/v8.0.0-news.apps.json`, is one News card with fourteen feeds
under four tabs. It opens in BDOBB 8.0.0 or later and asks for your server.

## Where the server lives

On the companion stack the server is openbq-docker's `rss-ticker` container,
reached on your tailnet at port 8088 — for example
`https://openbq.<your-tailnet>.ts.net:8088`. Every one of the stack's Serve
files publishes 8088 on the tailnet, and none funnels it. It belongs to the
`web` compose profile, but a desktop card needs only rss-ticker, and the
profile also needs the web preview's gateway files. Start it alone from the
openbq-docker checkout: `cp rss-ticker-config/config.yaml.example
rss-ticker-config/config.yaml`, then `docker compose up -d rss-ticker`.
Naming the service starts it without the profile. It has no login: the feeds
it relays are public, and being reachable only from your tailnet is its
protection. The card sends no key. The server sends each connection only the
feeds it subscribed to.

In the **web preview** a News card with no server of its own uses the
preview's own `/news` relay instead, and the preview seeds a News tab when it
is configured with approved feeds and a gateway. The browser never talks to
rss-ticker directly: it asks the preview for a short-lived ticket and opens the
wire on the gateway with it, and only the operator's approved feeds, and
only their stories, are relayed.

To keep a wire in view while the rest of a tab scrolls, pin it — see
**Pinned cards**. To keep it along the bottom of every dashboard, lock it —
see **Locked widgets**. For one feed on one tab with no server at all, the
plain **RSS feed** built-in reads the feed directly; see **Built-in widgets**.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
