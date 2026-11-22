# Accepted-data chart stream consumer

A `live_chart` widget opts in with `extra_metadata.chart_stream_v1: true` and
`wsEndpoint: "chart_stream_ws"`. The normalized capability is `chartStreamV1`.
Without that explicit boolean the existing `/series` seed and quote folding
remain unchanged. With it the renderer uses only the new snapshot/change wire:
server candles replace complete OHLCV values, including historical buckets.
The lightweight-charts adapter uses `setBars` for supported historical redraws;
its first-fit-only behavior preserves pan and zoom on subsequent redraws.

The UI currently draws candle views. The model also handles raw tick identities
and equal event times, but a raw tick UI requires a separate, explicitly labeled
trade-ordinal axis. No exchange timestamps are fabricated for that purpose.

The model stages snapshot chunks until `snapshot_end`, bounds retained candles
to 2,000 and ticks to 10,000, preserves/advances `view_floor`, and compares decimal
int64 sequence strings through `BigInt`. Generation and epoch are separate.
Acknowledgments describe fully installed model progress. Partial overlap is
idempotent, while a gap, wrong epoch, malformed sequence, or explicit resync
starts a fresh subscription. Quiet candle status uses its own sequence; resume
installs the server's authoritative status baseline under its new generation.

Each reconnect gets a fresh gateway ticket. Desktop header authentication uses
`ticketedWsUrl`; HTTPS gateway bases produce WSS. In the authenticated browser
preview, the existing WebSocket shim asks the same-origin `/socket-ticket`
endpoint and opens its returned cross-origin Funnel WSS URL. The gateway token
remains on the preview server. The canonical gateway policy must admit
`/grid/chart_stream_ws` and validate the chart controls. Credentials for q never
enter frontend code. There is no deployment implied by this implementation.

Frozen chart golden examples are copied byte-for-byte from the KDB package's
`openbq_kdb/resources/chart-stream-v1.examples.json`; tests apply those transcripts
with sequences above JavaScript's safe integer range. The complete schema and
manifest remain owned by that package.

## v12 integration status

BDOBB's v12 Live Chart uses this accepted-data path when the backend advertises
it. The Art's Charts host also exposes `chartStreamUrl(backend)` so each native
reconnect can mint a fresh gateway ticket, while browser preview connections use
the existing authenticated ticket shim. The host reads the source's current
configured credential rather than putting a gateway token into its socket URL.

The pinned Art's Charts foundation includes its original BUSL protocol model,
capability discovery and connection hook. Its embedded renderer is **not yet
wired to that consumer**. Study/anchor authority and renderer migration remain
separate work; this host addition changes neither the existing anchor UI nor
its calculation authority. The shared study-subscription ownership/fan-out boundary
remains pending too: this adapter resolves a transport URL and does not create
study sessions or compute aggregates. No v12 production deployment is implied.
