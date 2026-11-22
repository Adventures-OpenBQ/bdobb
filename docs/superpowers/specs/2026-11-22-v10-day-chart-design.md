# Day Chart for v10

## Intent

One widget named **Day Chart** shows a horizontally scrollable strip of simple
intraday charts for a list of symbols. The user's supplied watchlist screenshot
is the visual reference. Reuse the horizontal News/RSS strip interaction and the
existing v10 data infrastructure. This feature belongs in v10; v12 can inherit it.

## Symbol input — confirmed by the user

- A `symbol` parameter accepts one or more comma-separated symbols.
- The same parameter can bind to an existing dashboard symbol parameter group.
  A group may contain one symbol or a comma-separated list.
- Preserve input order, trim whitespace, normalize names through existing rules,
  and deduplicate. An explicitly empty list means no subscriptions or charts.
- Group edits immediately replace membership and cancel obsolete requests; late
  answers cannot repopulate removed symbols. Group deletion/disable follows the
  existing parameter-binding behavior; do not create a second group system.
- Literal `$list:0`/`$list:1` tokens were not found in the inspected v10 or v12
  source. They are not needed for the confirmed input/group behavior and are not
  introduced as aliases for unstable group positions.

## Approach

Use one strip renderer with small, lightweight line-chart tiles. Reuse existing
chart/line rendering primitives and scroll interactions where appropriate, with
shared bounded data acquisition. Keep the exact rendering choice with the builder
subject to measured resize/scroll behavior.

Separate full Live Chart widgets would repeat card chrome, controls and requests.
A full Plotly instance per tile adds interaction machinery the requested simple
strip does not need. Plotly remains available for larger analytical views.

## Tile and interaction

Each tile contains logo (or initials fallback), symbol, company name when available,
latest available price, absolute/percentage change against previous close, and a
simple intraday close-price line with sparse time/price labels. Preserve the app's
theme. Use a neutral previous-close reference and consistent up/down colors.
Chart hover may show the actual bar time/price; no drawing tools or study editor.

Tiles have a readable minimum width instead of shrinking the entire watchlist into
one viewport. Support touch/trackpad, mouse-wheel horizontal movement and previous/
next controls, borrowing the News strip behavior. Manual scrolling is the default;
no automatic movement of charts while someone reads them.

## Day/session and data semantics — proposed defaults

- Equities: current regular trading session when open, latest completed session
  when closed, including weekends/holidays. Display the actual session date and
  market/data status; never label historical data as live ticks.
- Default bars: one minute. The backend selects and clips the session; the browser
  does not infer it from a fixed UTC date or a naive "last 24 hours" window.
- Historical intraday data is necessary for a complete day, especially after a
  backend restart. The recently accepted q tape alone cannot be assumed to contain
  the prior session. Reuse the existing backend historical bar acquisition and
  preserve source/coverage metadata; do not invent accepted-tick cursors for it.
- Initial delivery refreshes backend-owned day snapshots every 15 seconds. Existing
  quote acquisition can supply price/change information, with honest timestamps.
  It does not fabricate line points from quote deltas. Tick-by-tick day-line updates
  require an explicitly qualified history/live boundary, not an implicit splice.
- Non-equities use their actual supported session policy, labeled explicitly;
  unsupported symbols/providers fail per tile, without blanking the strip.
- Requests/cache work are shared and bounded. Load visible/nearby tiles first;
  scrolling must not open unbounded sockets or trigger a full-watchlist refetch.
- A missing day has an explicit empty/error state, not a synthetic zero-price line.

## Logos and web access

Reuse EODHD metadata, taking the returned logo URL rather than guessing a filename.
The current Vercel CSP permits same-origin images, so add a narrow authenticated
same-origin logo relay with an approved EODHD origin/path, MIME/size/time limits,
no credential forwarding and no arbitrary caller-selected URL. Failed/missing
logos leave initials and the chart usable. Existing gateway/auth protections stay.

## Persistence and qualification

Store symbols, group binding and any tile/display settings using existing dashboard
state and native/portable import/export. Do not create a separate saved-list store.

Qualify direct and group inputs, single/multiple/empty/duplicate symbols, edits while
requests are pending, partial tile failures, current/prior session selection and
holidays, cold history, missing logos, scroll/lazy acquisition, resize, persistence,
web authentication and relay bounds. Verify with deterministic fixtures first,
then real v10 backend data and the Vercel browser after an authorized deployment.

## Scope

No new `$list:n` language, study registry migration, Plotly dashboard replacement,
automatic trading, or changes to the existing Live Chart. New deployment/publication
is a separate final step after the implementation is qualified.
