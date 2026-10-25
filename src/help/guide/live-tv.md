---
type: Note
tags: [bdobb, help, widgets, youtube, live-tv, rss-ticker]
---

# Live TV

**Live TV** plays a YouTube channel's live stream in a card: pick a channel from the card's **Channel** parameter and the card plays whatever that channel is streaming now. It is not a built-in. It is a widget that the companion stack's **rss-ticker** server — the same server the [[news-widget|News widget]] calls the *RSS Aggregator* — publishes once you list channels for it, so you add it the way you add any backend's widget: connect the server, then pick the widget from the library.

## Turning it on in the server

Live TV is **off** until you list channels. openbq-docker's `rss-ticker-config/config.yaml.example` carries a commented-out `live_tv:` list; copy the lines into your `rss-ticker-config/config.yaml`, uncomment them, and keep the channels you want. Each channel has a `key` (the value the card saves), a `label` (what the picker shows) and a `handle`, the channel's YouTube `@handle`. The first channel is the card's default.

```yaml
live_tv:
  - key: bloomberg-tv
    label: Bloomberg TV
    handle: "@markets"
  - key: yahoo-finance
    label: Yahoo Finance
    handle: "@YahooFinance"
```

Then restart the server so it reads the file: `docker compose up -d --force-recreate rss-ticker` (with the same `-f` files you run the stack with). Starting rss-ticker the first time is described under *The server* in [[news-widget|The News Widget]]. The server checks only the handles you list, so a card can never make it fetch any other address.

## Connecting the server

In **Connections**, add a backend whose URL is the rss-ticker server: `https://openbq.<your-tailnet>.ts.net:8088`, the same address a News card uses. It needs no key — rss-ticker has no authentication, and being reachable only on your tailnet is its protection. With no channels listed, the connection succeeds and offers no widgets.

## Adding the card

Open the widget library, find **Live TV** under the rss-ticker connection, and add it. The card's **Channel** parameter lists your channels by label; change it and the card switches stream.

- **When a channel is live**, the card shows its live stream in YouTube's player.
- **When a channel is off-air** — between shows, or before an upcoming stream starts — the server has no video to give and the card reads *Select a video in the widget's parameters.* That is not an error: pick another channel, or come back when it is on.
- The server remembers each channel's live video for five minutes. A stream that has just started may need up to that long, and a **Refresh**, to appear.

In the desktop app the card frames a small page the app serves itself on `127.0.0.1`, which embeds the stream; YouTube refuses an embed framed straight from the app's own pages. The iPad app does the same.

## Not in the web preview

The web preview's door relays only the News wire from rss-ticker (`/news`), not its widgets, so Live TV is a desktop and iPad card. See [[web-preview|Web Preview]].

---
*Source: `src/components/renderers/YouTubeRenderer.tsx`, `src/lib/youtube.ts` and `src-tauri/src/video_wrapper.rs` at 8.0.0; openbq-docker `rss-ticker/README.md` (rss-feedhandler v8.3.1), `rss-ticker-config/config.yaml.example` and `docker-compose.yml` at v8.0.0.*
*See also: [[news-widget|The News Widget]] · [[connecting-a-backend|Connecting a Backend]] · [[widget-library|The Widget Library]] · [[tailscale-networking|Tailscale Networking]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
