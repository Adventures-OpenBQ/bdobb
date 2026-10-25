# Troubleshooting

![A refused ssrm_table card beside a card on an unreachable backend](./shots/troubleshooting.png)

## A card says server-side tables are not supported

**Server-side tables (ssrm_table) are not supported in this version.**

OpenBB's server-side row model is a different contract end to end: the widget's
endpoint expects a POST carrying the row range the grid wants, plus its sort,
filter and grouping state, and answers with just that slice. This app's table is
a client-side grid over rows fetched with a GET. A GET against such an endpoint
is at best a `405` and at worst an answer that cannot be read — which would
surface as an error card, or as an empty table that looks like missing data.
Saying so plainly is better than either.

No request is made, so there is no error state and no **Retry**. The card
offers no raw view and no export. Everything else about it works normally.

These widgets are **not** hidden from the library: they are listed with an
`ssrm_table` type badge, and that type appears in the **Type** filter, so you
can find them or filter them out. Hiding them would make a manifest entry vanish
with no explanation.

## A card shows raw JSON instead of what you expected

An unfamiliar widget type falls through to the raw-JSON view rather than
erroring. `live_grid`, news feeds, and the Highcharts and Vega-Lite chart
variants all land here. That is the app telling you it fetched something fine
and does not know how to draw it.

## A framed page is blank

Many sites refuse to be embedded. The card says so when it can prove it, and
otherwise carries a footer reading *Blank? The site may refuse to be embedded.*
with an **Open externally ↗** button. See **HTML and iframe widgets**.

## A backend will not answer

Check the dot in **Connections**. Red means the app tried and failed; grey means
it has not finished trying yet. Use **Edit** and then **Test** to probe exactly
what you have typed without saving it — that separates a wrong address from a
rejected credential.

A card naming a backend that no longer exists reads *Backend not configured*
and is deliberately never retried on a timer; use **Retry** on the card once
the connection is configured again.

A card whose widget no backend currently serves reads
*Widget `<id>` is not on any connected backend.* — usually an import from
someone else's machine. It fixes itself when a backend serving that id connects.

## A card is empty but nothing looks wrong

*No data for these parameters.* is a correct answer with nothing in it — the
backend replied, and replied empty. It is not an error, and there is no Retry,
because retrying would only ask the same question again.

*Enter Commodity, Year, Month to load this widget.* means a required parameter
is blank. Nothing was requested at all.

## Your settings or dashboards reverted

If one of the app's own files — `settings.json`, `backends.json`,
`folders.json`, a file under `dashboards/` — is present but cannot be parsed,
or has a field of the wrong type, the app **renames it to `<name>.corrupt`**
(then `.corrupt.1`, `.corrupt.2`, and so on) and carries on with defaults.
Nothing is ever overwritten and the original is still there.

Nothing is shown in the UI when this happens. The only trace is a log line
reading `quarantined <path> -> <path>.corrupt`, which you can find in
**Settings ▸ Logs**. If your settings or dashboards have apparently reset
themselves, that is the first place to look.

Smaller problems are handled more gently: an unrecognised theme, font size or
auto-refresh value, or an out-of-range decimal-places number, is downgraded to
its default rather than quarantining the whole file. One bad entry in
`backends.json` does quarantine the file, deliberately — dropping it silently
would look like mystery data loss.

## Where the log is

**Settings ▸ Logs** shows the file's full path and its last hundred lines. On
disk it is `logs/bdobb.log` inside the app's data directory, with up to five
rotated generations beside it. It rotates at 10 MB.

[shot-pending]: #23
