---
type: Note
tags: [bdobb, help, widgets, youtube, live-tv, rss-ticker]
---

# Live TV

**Live TV** puts YouTube live streams and **Picture in Picture grab** in one card. Pick a source from **Channel**: a YouTube choice plays that channel's current stream; the grab choice uses Chrome's existing floating player. The companion stack's **rss-ticker** server — the same server used by [[news-widget|News]] — publishes this widget. Connect the server, then add **Live TV** from the library.

## Turning it on in the server

Copy openbq-docker's `rss-ticker-config/config.yaml.example` to `rss-ticker-config/config.yaml`. Its `live_tv:` list includes the three YouTube sources below. Each channel has a stable `key`, a picker `label` and a YouTube `@handle`. The first channel is the default. Removing the list, or setting it to `[]`, turns Live TV off.

```yaml
live_tv:
  - key: bloomberg-tv
    label: YouTube - Bloomberg Live
    handle: "@markets"
  - key: schwab-network
    label: YouTube - Schwab Network Live
    handle: "@SchwabNetwork"
  - key: yahoo-finance
    label: YouTube - Yahoo Finance 24/7 Stream
    handle: "@YahooFinance"
```

Then restart the server so it reads the file: `docker compose up -d --force-recreate rss-ticker` (with the same `-f` files you run the stack with). Starting rss-ticker the first time is described under *The server* in [[news-widget|The News Widget]]. The server checks only the handles you list, so a card can never make it fetch any other address.

## Connecting the server

In **Connections**, add a backend whose URL is the rss-ticker server: `https://openbq.<your-tailnet>.ts.net:8088`, the same address a News card uses. It needs no key — rss-ticker has no authentication, and being reachable only on your tailnet is its protection. With no channels listed, the connection succeeds and offers no widgets.

## Adding the card

Open the widget library, find **Live TV** under the rss-ticker connection, and add it. The card's **Channel** parameter lists your channels by label; change it and the card switches stream.

Live TV opens with its parameter panel hidden. Use **Show parameters** to change playback preferences; the row 0 speaker button mutes or unmutes a YouTube stream. YouTube playback stays inline, with no outgoing Picture in Picture button. Chrome grab uses Chrome's own audio controls.

The picker also includes **Picture in Picture grab**. On macOS or Windows, pop a video out in Chrome, then choose this source to fit that floating player over the card. Switching to a YouTube source releases Chrome's player. See [[picture-in-picture|Picture in Picture]] for permission, ownership and platform limits.

To keep the video across dashboards, open **Settings ▸ Locked Widgets**, edit **Locked at Top…** or **Locked at Bottom…**, and add a Live TV card there. Choose its source while editing the band, make the band tall enough for the player, and choose **OK**. A locked card plays without changing its saved height. See [[locked-and-pinned-widgets|Locked and Pinned Widgets]].

- **When a channel is live**, the card shows its live stream in YouTube's player.
- **When a channel is off-air** — between shows, or before an upcoming stream starts — the card reads *No video is currently available for the selected source.* Pick another channel, or come back when it is on.
- The server remembers each channel's live video for five minutes. A stream that has just started may need up to that long, and a **Refresh**, to appear.

In the desktop app the card frames a small page the app serves itself on `127.0.0.1`, which embeds the stream; YouTube refuses an embed framed straight from the app's own pages. The iPad app does the same.

## Not in the web preview

The web preview's door relays only the News wire from rss-ticker (`/news`), not its widgets, so Live TV is a desktop and iPad card. See [[web-preview|Web Preview]].

---
*Source: `src/components/renderers/YouTubeRenderer.tsx`, `src/lib/youtube.ts` and `src-tauri/src/video_wrapper.rs` at 8.0.0; openbq-docker `rss-ticker/README.md` (rss-feedhandler v8.3.1), `rss-ticker-config/config.yaml.example` and `docker-compose.yml` at v8.0.0.*
*See also: [[news-widget|The News Widget]] · [[connecting-a-backend|Connecting a Backend]] · [[widget-library|The Widget Library]] · [[tailscale-networking|Tailscale Networking]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
