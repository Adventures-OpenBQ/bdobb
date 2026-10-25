# Troubleshooting

![A card on an unreachable backend, showing Retry](./shots/troubleshooting.png)

## A server-side table card cannot export or chart

OpenBB's server-side tables (`ssrm_table`, also spelled `table_ssrm`) are
served. A managed table from the configured table service shows **Server
snapshot**; a standard OpenBB SSRM provider shows **LIVE · paged**.

A standard SSRM table is LIVE only: the app asks the provider for each page as
you scroll, so loaded rows never stand for the whole result. Whole-result
formulas, selection, charts, exports and linked tables need the complete
result, so they are unavailable on a LIVE card. Sorting, filtering and grouping
follow what the provider declares it supports. A warning from the backend,
such as FINRA's 250,000-record cap, shows as a notice line under the header.
For those features, use a
managed source instead. See **Tables**.

## A card shows raw JSON instead of what you expected

An unfamiliar widget type falls through to the raw-JSON view rather than
erroring, and so does a Highcharts or Vega-Lite specification the app cannot
translate into a chart. That is the app telling you it fetched something fine
and does not know how to draw it.

## A framed page is blank

Many sites refuse to be embedded. The card cannot tell, so it always carries a
footer reading *Blank? The site may refuse to be embedded.*
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

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v4.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
