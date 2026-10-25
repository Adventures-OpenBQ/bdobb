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
Inline images a backend sends as `data:image/…` (PNG, JPEG, GIF, WebP or SVG) are drawn. At this version an image at an `http` or `https` address is not fetched: it shows as a link with its own address, which you can click to open. The same holds in note cards and in Rita's answers. Any other address is dropped from an image and from a link.

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

## Rita and the AI Library

**No Rita tab on the right edge.**
No Rita URL is committed. Set it in **AI Library ▸ Agents** and click **Done**; an address you typed but did not commit with Return, or a dialog you closed with **Cancel**, does not count. A fresh profile has none. See [[ai-library|The AI Library]].

**The header reads *Rita offline*.**
`agents.json` did not answer at the configured URL. Check that the URL is the one the services publish on your tailnet (not a bare port on the host), that you are on the tailnet, and that the Rita service is up. Rita takes no client credential, so a missing password is not the cause. See [[rita-ai-agent-setup|Setting Up the Rita AI Agent]].

**Rita answers oddly, repeats an old mistake, or every message errors right after an upgrade.**
The whole conversation is sent back to Rita with each message, so a stale or contaminated chat poisons every later turn. A conversation saved by an earlier build can hold tool messages in a shape Rita's current build reads differently, and a long thread full of earlier failures steers the model toward them. Start a fresh chat: **Clear** in the pane's **⋯** menu deletes the saved `chat.json` and releases every card you had shared. See [[rita-chat|Rita (AI Chat)]].

***Tool call failed* appears in the middle of a conversation.**
A tool Rita called was rejected, errored or timed out. The line names the server, the tool and the reason, the trail counts it as an error, and Rita is told too and carries on with what she has, so the turn does not end there. Rejected calls come back with a code worth reading:

- `TOOL_DISABLED` — the tool, or the tool behind `call_tool` or `run_pipeline`, is switched off for that server in **AI Library ▸ MCP Servers**; nothing was sent. Switch it back on, or leave it off on purpose. `INVALID_PROXY_CALL` means a `call_tool` or `run_pipeline` call was malformed and was not forwarded.
- `unknown card` — the card is not on the active dashboard; or it is an off-limits card (the Provider API Keys table, a settings widget, any widget on a key-maint backend, or a Linked table fed by one), which Rita can never touch; or **Context sharing** is off and Rita did not create the card herself this session.
- `stale-revision` — a table changed between `describe_table` and `arrange_table`; Rita describes it again and retries.
- `runtime-not-ready` — the card's tab has not been opened, so its table is not running. Open the tab, then ask again.
- `viewer-scope` — the table is in viewer (read-only) mode, where only its existing viewer controls can change; any authoring change is refused and nothing changes.
- `view-not-tabular` — the table card is showing a Chart or another non-table view; switch it to Table or Statement view and ask again.
- `validation-failed` or `invalid-arrangement` — the engine refused the arrangement; the error list says what, and Rita corrects it.

**Rita says it cannot arrange a table: *server-execution-pending*.**
That card is a standard LIVE table, whose paging runs on the server, so its table model cannot be inspected or arranged; `describe_table` and `arrange_table` work on CSV/XLS tables, managed server tables, linked tables and backend tables. A standard LIVE table answers `server-execution-pending`; choose a managed server source for full analytical scope. Rita can still read the card with `describe_widget` and `get_widget_data`. A backend table too large for the table engine answers `runtime-not-ready` with the reason (*This table is too large for the table engine*). See [[tables|Tables]].

**Undo fails with *nothing was restored*.**
A failed Undo is shown in the edit bar and changes nothing. For a table arrangement it refuses when you edited the table after Rita did, when the card is no longer on the active dashboard or its tab is closed, when the dashboard is read-only, or when the previous configuration no longer fits the data. The failed entry is dropped, so the older changes beneath it can still be undone. See [[rita-chat|Rita (AI Chat)]].

**A reply ends with *Stopped at the N-round tool limit* (N is your configured limit), or a WARNING about a tool limit.**
That turn reached the round limit. Each time Rita asks BDOBB to run a tool counts as a round, and **Maximum tool rounds** in **AI Library ▸ Agents** caps them (default 40, range 1–40). BDOBB stopped running tools and kept every completed result, so work already done is on the dashboard and the Undo bar. Review it before retrying, so a repeat does not duplicate changes, then either raise the limit (up to 40) or split the request into smaller ones. The new value applies to the next message.

**A turn stops after 45 seconds with a message.**
The request went quiet: no bytes at all arrived for 45 seconds. Rita's keepalive comments count as bytes, so a long think does not trip this; a timeout means nothing came. The usual causes are a cold model that is slow to produce its first token, or a proxy between BDOBB and Rita that buffers the stream or strips keepalive comments. Try again; if it repeats, see [[troubleshooting-infrastructure|Configuring the Infrastructure]].

**Rita stops to ask before every MCP tool call.**
Expected: each call to a tool on an MCP server pauses the turn on a prompt naming the server, its address, the tool and its arguments, with **Run** and **Deny**. Deny tells Rita you declined, and she carries on without it. To stop being asked about a tool you would always deny, untick it in **AI Library ▸ MCP Servers**, or turn the server off: a switched-off tool is refused without a prompt. Rita's own tools do not ask — except when `set_widget_params` or `add_widget` points a website or RSS card at a new URL, which stops on the same prompt — and each leaves an Undo-bar entry. See [[rita-chat|Rita (AI Chat)]].

**Stop did not seem to stop anything.**
Stop aborts the request to Rita and ends the turn, and that is all it reaches. Changes Rita had already made stay (each is in the Undo bar). Stop cancels an MCP tool call in flight and settles a pending **Run**/**Deny** prompt as denied, but a server that already received a request may have acted on it, and that cannot be undone from BDOBB.

**An MCP server's row reads *Unreachable*, or a turn warns that a server could not be reached.**
Check shows the reason after *Unreachable:*. At the start of a turn an unreachable server is skipped with a warning in the status trail and the turn goes on without its tools, so a dead server and "none configured" look alike in the answer. Look at the URL first (the OpenBQ server's path is `/mcp`), then that you are on the tailnet, then whether the row says **Token required**. See [[troubleshooting-infrastructure|Configuring the Infrastructure]].

**An MCP server's row reads *Token required*.**
That server is marked **token** and there is no credential to send: it came from a file rather than from a backend, or the backend it came from is gone. Paste the bearer token in the field on its row and **Save**. Tokens live in their own file, `mcpTokens.json`, and are never written to an export. If a server rejects a saved token, BDOBB forgets it and asks again. See [[ai-library|The AI Library]].

**A token server is enabled but the credential is clearly not being sent.**
The server is on a different host from the backend the credential belongs to, so it is withheld until you turn on **Send credential anyway** for that server. An imported file always arrives with that switch off, and a token server sourced from a backend arrives switched off entirely, whatever the file said.

**A warning beside an MCP server says it is on this computer or a private network.**
This is the private network warning: the address is loopback, `localhost`, a private range or link-local, which reaches places a public server cannot. It is a remark, not a refusal, and a server on your own tailnet is not flagged. A server you add yourself shows the warning on its row; an import names every such server in its notice (*Warning: on this computer or a private network: …*). Servers named by an imported `apps.json` arrive switched off, as does any token server sourced from a backend. Read the address before you enable one that came from a file somebody else wrote.

**A tool Rita used yesterday is no longer offered.**
Check its checkbox under that server's **Tools**, and the **Tools called through proxies** list if it runs through `call_tool` or `run_pipeline`. An unticked tool is left out of what Rita is offered and refused if a call names it anyway. Unticking `call_tool` or `run_pipeline` itself switches off every tool behind that proxy. See [[ai-library|The AI Library]].

**No *Share with Rita* in a card's ⋯ menu, or the Rita badges disappeared.**
**Context sharing** is off in **AI Library ▸ Agents** (the tag would not be sent, so the item and the badge are hidden; the tags themselves are remembered and return with the switch); or the card is an off-limits card (the Provider API Keys table, a settings widget, any widget on a key-maint backend, or a Linked table built on one of those), which is never sent; or the window is a viewer window, which never offers it. **Clear** in the pane's ⋯ menu is what actually releases the tags.

---
*Source: BDOBB v3.0.1 in-app manual, "Troubleshooting"; the Gotchas section of `docs/specs/v3.0.0-features.md`; `BDOBB` `widgetTypes`, `widgetsJson`, `appsJson`, `bootstrap`, `jsonStore`, `dataClient`, `src/App.tsx`, `src/components/LeftRail.tsx` and `src/styles.css` at `v3.0.1`; `src/lib/widgetTypes.ts` at `v3.3.0`; `BDOBB` `src/components/renderers/MarkdownRenderer.tsx` at `v3.0.5`; `BDOBB` `src/hooks/useReconnectingSocket.ts` at `v3.2.2`; `BDOBB` `src/components/renderers/OmniRenderer.tsx` at `v3.3.2`.*
*See also: [[troubleshooting-infrastructure|Configuring the Infrastructure]] · [[app-data-and-settings|App Data and Settings]] · [[connecting-a-backend|Connecting a Backend]] · [[dashboards-and-folders|Dashboards and Folders]]*
