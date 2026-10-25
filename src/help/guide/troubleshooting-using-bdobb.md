---
type: Note
tags: [bdobb, help, troubleshooting, using-bdobb, symptoms]
---

# Troubleshooting: Using BDOBB

Symptom-first index of issues you hit while using the app itself — cards, connections, the rail, settings, files. Where a symptom's real cause and fix live in a backend service rather than in the app, this page points to [[troubleshooting-infrastructure|Configuring the Infrastructure]] instead of duplicating the fix.

## Cards

**A server-side table card offers no export, chart or selection.**
OpenBB's server-side tables (`ssrm_table`, also spelled `table_ssrm`) are served. A managed table from the configured table service shows **Server snapshot** and supports the full table toolset over its complete snapshot. A standard OpenBB SSRM provider shows **LIVE · paged** and is LIVE only: pages are requested as you scroll and may change between requests, so loaded rows never stand for the whole result. A card also shows what the backend warned about its result, such as FINRA's 250,000-record cap, as a notice line under the header. Whole-result formulas, selection, charts, exports and linked tables are therefore unavailable on it; sorting, filtering and grouping follow the provider's declared capabilities. Use a managed source when you need them. See [[tables|Tables]].

**A card shows raw JSON instead of what you expected.**
Any widget type the app does not know falls through to the raw-JSON view rather than erroring. The types it draws: `table`, `chart`, `markdown`, `html`, `iframe`, `metric`, `note`, `clock`, `rss`, `keys`, `pdf`, `multi_file_viewer`, `local_table`, `youtube`, `newsfeed`, `live_grid`, `omni`, `chart-vegalite`, `chart-highcharts`, `advanced_charting`, `markdown_editor`, `param_echo`, and the server-side `ssrm_table` and `table_ssrm`. Anything else is the app telling you it fetched something fine and does not know how to draw it.

**An image in a markdown card is missing.**
Inline images a backend sends as `data:image/…` (PNG, JPEG, GIF, WebP or SVG) are drawn. Any other address that is not `http` or `https` is dropped from an image, and every such address is dropped from a link.

**A Live Grid card stopped moving.**
Its stream reconnects on its own. A connection the backend drops is retried after half a second, then after one, two, four seconds and so on, doubling up to a minute between tries, so a backend that keeps accepting and dropping the stream is not asked again every half second. A connection that stays up for 30 seconds counts as recovered, and the next drop is retried after half a second again.

**An omni card says its code language is not allowed.**
The widget sends code (Python, SQL, or another language it declares) for its backend to run, and the backend's server refused that language. Which languages run is the backend's setting, not this app's: ask whoever runs the backend. Omni widgets that send no code are not affected. See [[connecting-a-backend|Connecting a Backend]].

**A framed page is blank.**
Many sites refuse to be embedded, and the app has no way to tell that from a page that rendered nothing — so it never claims to know. Every iframe card carries the footer *Blank? The site may refuse to be embedded.* beside **Open externally ↗**. See [[html-and-iframe-widgets|HTML and iframe Widgets]].

**The whole window went blank.**
At this version the app has no error boundary, so an error thrown while drawing any part of the window — one card's renderer included — takes the whole window down with it, and nothing reaches the log. Restart the app to redraw it. See [[layout-and-navigation|Layout and Navigation]].

**A card is empty but nothing looks wrong.**
*No data for these parameters.* is a correct answer with nothing in it — the backend replied, and replied empty. There is no Retry because retrying would ask the same question. *Enter Commodity, Year, Month to load this widget.* means a required parameter is blank and nothing was requested at all.

**A card in the Widget Library runs off its edge, and its description does not seem to wrap.**
At this version a badge row wider than the card widens the card's layout instead of wrapping, and the overhang is clipped. See [[widget-library|The Widget Library]].

**A card's title shows a dot and *Parameters changed — press Run*.**
It is a run-button widget; edits are recorded but nothing fetches until you press **Run**. See [[running-and-refreshing|Running and Refreshing]].

**A viewer window shows old parameters, or a grouped card there disagrees with the main window.**
At this version a viewer window reads its dashboard once, when it opens, and does not follow changes made in the main window after that. Refreshing it refetches with the parameters it opened with. Close the window and open it again. See [[dashboards-and-folders|Dashboards and Folders]].

**A chart's view dropdown shows a disabled entry.**
The card carries a saved view the data no longer supports — a chart view whose rows lost their time column. Pick another entry; the control never claims to show something it is not.

## Connections

**A backend will not answer.**
Check the dot in **Connections**: red means the app tried and failed, grey means it has not finished trying. Use **Edit** then **Test** to probe exactly what you have typed without saving it — that separates a wrong address from a rejected credential. A card naming a backend that no longer exists reads *Backend not configured* and is never retried on a timer; press its **Retry** once the connection exists again.

**The seeded `Local` backend is always red.**
It points at `http://localhost:6900`, which the openbq-docker stack never publishes to the host. Replace the URL with the stack's Serve address. See [[backends-and-connections|Backends and Connections]].

**A card reads *Widget `<id>` is not on any connected backend.***
Usually an import from another machine. It fixes itself when a backend serving that id connects.

**One unreachable backend used to leave every card unresolved.**
It no longer does. Discovery gives each backend's `widgets.json` ten seconds end to end, so a host that accepts the connection and never answers goes offline by itself while the other backends finish normally. See [[connecting-a-backend|Connecting a Backend]].

**The widget count says `275, 12 skipped`.**
The number counts manifest entries validation found a problem with, not entries dropped: an entry that is not a JSON object is dropped, while an entry with malformed parameters is kept with those parameters removed — all of them if its `params` is not a list. Set **Validate widgets** to No to take the payload as it comes, if you want to see them anyway.

**A widget's parameters are not in sections.**
Some OpenBB backends publish a widget's parameters in sections, as a list of lists rather than one flat list. The app reads every section's controls but has no sections of its own, so they appear as one flat row.

## The rail

**An export or import notice will not leave the rail.**
At this version the rail's notice has no timeout. It stays, on the collapsed rail as well as the expanded one, until the next export or import from the rail clears or replaces it.

**Right-clicking the blank rail below your dashboards does not open the section menu.**
At this version the section menu — **New dashboard**, **New folder**, **New workspace…**, **Import apps.json…** — belongs to the *WORKSPACES* and *MY DASHBOARDS* labels and the lists beneath them, not to the blank rail under the last row. Right-click a label. See [[dashboards-and-folders|Dashboards and Folders]].

## Settings and app data

**Your settings or dashboards reverted.**
If one of the app's own files is present but cannot be *parsed*, or has a field of the wrong type, the app renames it to `<name>.corrupt` and carries on with defaults. Nothing is shown in the UI; the only trace is a `quarantined …` line in **Settings ▸ Logs**, and the `.corrupt` file beside the fresh one is your data. See [[app-data-and-settings|App Data and Settings]].

**Your settings look like defaults, and nothing new was saved this session.**
A file the app could not *read* — no permission, a volume that went away — is left where it is rather than quarantined, and the app spends the session on defaults while refusing to save over it. That refusal is what stops a good `settings.json`, `backends.json` or `folders.json` being replaced by the defaults on screen, and it is logged. Fix the cause and restart; your file is intact. See [[app-data-and-settings|App Data and Settings]].

**Your dashboards are gone after installing BDOBB beside the original BDOBB.**
They are not: the two apps keep data under different bundle identifiers and neither reads the other's. The original's data is still under its own folder.

## Files

**A dropped file says *Unsupported file*.**
Accepted: `.csv`, `.tsv`, `.json`, `.xlsx`, `.xls`. A `.json` that will not parse reads the same. A file over 50 MB is refused by size before the extension is looked at.

**A drop does nothing.**
There is no drop veil in a viewer window, and no drop is taken while a dialog or the widget library is open over the dashboard.

**An `apps.json` import failed.**
*File is … MB; the limit is 10 MB*, *File holds 501 dashboards; the limit is 500*, or *not an apps.json file*. See [[importing-dashboards|Importing Dashboards]].


---
*Source: BDOBB v3.0.1 in-app manual, "Troubleshooting"; the Gotchas section of `docs/specs/v3.0.0-features.md`; `BDOBB` `widgetTypes`, `widgetsJson`, `appsJson`, `bootstrap`, `jsonStore`, `dataClient`, `src/App.tsx`, `src/components/LeftRail.tsx` and `src/styles.css` at `v3.0.1`; `src/lib/widgetTypes.ts` at `v3.3.0`; `BDOBB` `src/components/renderers/MarkdownRenderer.tsx` at `v3.0.5`; `BDOBB` `src/hooks/useReconnectingSocket.ts` at `v3.2.2`; `BDOBB` `src/components/renderers/OmniRenderer.tsx` at `v3.3.2`.*
*See also: [[troubleshooting-infrastructure|Configuring the Infrastructure]] · [[app-data-and-settings|App Data and Settings]] · [[connecting-a-backend|Connecting a Backend]] · [[dashboards-and-folders|Dashboards and Folders]]*
