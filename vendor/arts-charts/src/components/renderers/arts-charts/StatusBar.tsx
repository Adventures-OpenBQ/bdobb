// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

import { Fragment } from "react";

import { openUrl } from "../../../host/opener";

import type { TickStatus } from "../../../hooks/useTickCache";
import { formatClock, zoneAbbreviation } from "../../../lib/chart/formats";

/**
 * TradingView's attribution, and where it points.
 *
 * Lightweight Charts is Apache-2.0 and its README asks for the NOTICE text
 * plus "a link to <https://www.tradingview.com/> to the page of your website
 * or mobile application that is available to your users". The on-chart
 * `attributionLogo` is offered as one way that "will satisfy the link
 * requirement" -- a convenience, not the mandated placement. So the credit
 * reads here, in the card's own status line, once per card.
 *
 * The href is the Lightweight Charts product page rather than the site root:
 * it is the thing actually being credited, and it is a tradingview.com URL,
 * so it satisfies the link either way.
 *
 * Text, not their logo mark. Apache-2.0 §6 grants no trademark rights, and
 * `attributionLogo` is TradingView drawing their OWN mark; redrawing it
 * ourselves would be using the trademark outside what they sanctioned.
 */
const TRADINGVIEW_URL = "https://www.tradingview.com/lightweight-charts/";

const STATE_LABEL: Record<TickStatus, string> = {
  live: "Live",
  connecting: "Reconnecting…",
  // ponytail: the spec's "Disconnected after three failed retries" needs a
  // retry counter in useTickCache; today every failure reads Disconnected
  // and the next attempt reads Reconnecting…, which is what the user sees
  // happen anyway at a three-second cadence.
  error: "Disconnected",
  idle: "Idle",
};

/** Where the bars came from: the two planes name themselves here. */
// Both routes, both planes: in EODHD mode the bars come over /series but the
// studies still arrive over /ta_series_ws, so naming only /series would make
// the study socket vanish exactly where a reader looks for it.
const PLANE_LABEL = { kdb: "kdb+ · /ta_series_ws", eodhd: "eodhd · /series + /ta_series_ws", series: "/series + /ta_series_ws" };

/**
 * v12.4.2: which of the two sources the EODHD plane's bars actually came
 * from -- the tick vault kept every requested weekday (`"vault"`), EODHD's
 * own history filled in some or all of the window (`"mixed"` when the vault
 * served at least one row, `"history"` when it served none) -- read off
 * `useSeriesBars`' `meta`. The kdb plane has no vault at all, so this only
 * ever overrides `PLANE_LABEL.eodhd`.
 */
const BARS_SOURCE_LABEL: Record<"vault" | "mixed", string> = {
  vault: "Tick vault",
  mixed: "Tick vault + EODHD",
};

/**
 * The status bar (spec §10.1). Left: stream state, the two data planes,
 * tick latency, the last bar's time. Right: session, persistence, counts.
 *
 * The session (slice 4) reads the filter in force -- "extended hours", or
 * "regular · XNYS" naming the exchange whose session it is -- and the
 * last-bar clock reads the exchange's zone when the symbol has one, the
 * viewer's otherwise. The persistence entry is the stub the spec allows:
 * kdb+ sends no Delta-flush heartbeat frame today, so "pending…" is the
 * honest reading and the frame is a recorded follow-up, not a fake.
 */
export function StatusBar({
  status, latencyMs, lastBarTime, intervalSeconds, series, tools, timeZone, session = "extended", exchange = null,
  plane = "kdb", error = null, warning = null, barsSource = null, summary, paramsOpen, onOpenParams,
}: {
  status: TickStatus;
  latencyMs: number | null;
  lastBarTime: number | null;
  intervalSeconds: number;
  /** How many SERIES the card draws (v12.4.0): the strip's chips, studies and price rows alike. */
  series: number;
  tools: number;
  /** The clock's zone; none means the viewer's. */
  timeZone?: string;
  session?: "extended" | "regular" | "24hr";
  exchange?: string | null;
  /** The chart's one source (v12.3.1): the tick plane, EODHD's history, or a server's /series (arts-charts-openbq). */
  plane?: "kdb" | "eodhd" | "series";
  /** The plane's last failure, if it has one: the state reading's tooltip. */
  error?: string | null;
  /**
   * A layout problem the card is living with rather than refusing (v12.4.0):
   * today only `panel links: circular (P1 → P2 → P1)`, when a `panels`
   * parameter arrives from outside the editor with a reference loop in it.
   * Beside the planes, not in place of them -- the feed is fine, the layout
   * is what is odd.
   */
  warning?: string | null;
  /**
   * Which of the EODHD plane's two sources answered (v12.4.2): `"vault"`
   * (the tick vault covered the whole window), `"mixed"` (EODHD's history
   * filled in the rest), `"history"` or `null` (nothing came from the
   * vault) leave the existing `PLANE_LABEL.eodhd` reading in place. Unused
   * on the kdb plane, which has no vault.
   */
  barsSource?: "vault" | "history" | "mixed" | null;
  /**
   * The collapsed row's centred summary (spec 2026-09-24, D7), built by the
   * renderer from the interval, resolved range, session and exchange. Rendered
   * only while the Parameters row is CLOSED, so it always describes what the
   * chart is showing rather than an unsaved edit.
   */
  summary?: string;
  /** Whether the card's Parameters row is showing; the summary hides while it is. */
  paramsOpen?: boolean;
  /** Reopen the Parameters row (the card's transient open flag): double-click, or Enter/Space on the summary. */
  onOpenParams?: () => void;
}) {
  return (
    <div className="chart-status" role="status" aria-live="off">
      <span className="chart-status-group">
        {/* The plane's error hangs off the state reading rather than the dot
            itself, which is aria-hidden and so would carry the title where
            nothing could read it. */}
        <span title={error ?? undefined}>
          <span className="chart-status-dot" data-state={status} aria-hidden="true" />
          {STATE_LABEL[status]}
        </span>
        <span>
          {plane === "eodhd" && (barsSource === "vault" || barsSource === "mixed")
            ? BARS_SOURCE_LABEL[barsSource]
            : PLANE_LABEL[plane]}
        </span>
        {warning === null || warning === "" ? null : <span className="chart-status-warning">{warning}</span>}
        {/* Only while the stream is live, and only on the tick plane: an
            EODHD chart polls a REST route and has no per-trade latency to
            report at all.
            A median measured before a drop is
            not a reading about the connection the bar is now describing, and
            "Disconnected · tick latency 38 ms" read as a working feed.
            ponytail: a live but quiet stream keeps its last median until the
            next trade. A timer that ages the samples out (rather than only
            filtering them on arrival) is the upgrade if a thin book makes
            that number look stale. */}
        {plane !== "kdb" || status !== "live" || latencyMs === null ? null : <span>tick latency {Math.round(latencyMs)} ms</span>}
        {lastBarTime === null ? null : (
          <span>last bar {formatClock(lastBarTime, intervalSeconds, timeZone)} {zoneAbbreviation(timeZone, new Date(lastBarTime * 1000))}</span>
        )}
      </span>
      {paramsOpen === false && summary !== undefined && summary !== "" ? (
        // The centred summary (spec 2026-09-24, D7). role/tabIndex make the
        // double-click affordance reachable from the keyboard too (the mockup
        // asks for Enter/Space); the chevron in the card header is the third
        // way in. The full text lives in title + aria-label because the CSS
        // ellipsises this on a narrow card.
         
        <span
          className="chart-status-summary"
          role="button"
          tabIndex={0}
          title={summary}
          aria-label={`Parameters: ${summary}. Double-click to edit.`}
          onDoubleClick={() => onOpenParams?.()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenParams?.();
            }
          }}
        >
          {/* One span per word, each unbreakable (2026-10-01). On a portrait
              card the summary wraps, and a browser treats a hyphen as a break
              point -- the first cut split "2026-10-01" into "2026-" / "10-01".
              Breaking only at the summary's own spaces keeps every date and
              every "5min" whole. Inert on a landscape card, where the whole
              line is nowrap and ellipsised as before. */}
          {summary.split(" ").map((word, i) => (
            <Fragment key={i}>{i === 0 ? null : " "}<span className="chart-status-word">{word}</span></Fragment>
          ))}
        </span>
      ) : null}
      <span className="chart-status-group">
        <span>
          session:{" "}
          {session === "regular" && exchange !== null ? `regular · ${exchange}` : session === "24hr" ? "24 hours" : "extended hours"}
        </span>
        <span>{series} series · {tools} tools</span>
        {/* Unconditional: the licence is about the library that drew the bars,
            so it does not come and go with the feed's state. */}
        <span className="chart-status-credit">
          Rendered by{" "}
          <a
            href={TRADINGVIEW_URL}
            onClick={(event) => {
              // Same shape as every other external link in the app: a real
              // href so it reads and copies as a link, but opened through the
              // opener, because letting the webview follow it would navigate
              // the running app away to tradingview.com.
              event.preventDefault();
              event.stopPropagation();
              // A plain browser build (the Vercel preview) has no Tauri to
              // invoke, and this link in particular must not silently do
              // nothing -- it is the attribution the licence asks for.
              void openUrl(TRADINGVIEW_URL).catch(() => {
                window.open(TRADINGVIEW_URL, "_blank", "noopener,noreferrer");
              });
            }}
          >
            TradingView
          </a>
        </span>
      </span>
    </div>
  );
}
