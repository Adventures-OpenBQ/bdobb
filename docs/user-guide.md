# BDOBB User Guide — v6 Development Candidate

V6 adds the Rita AI agent and the AI Library to the inherited v5 workspaces and Statement view. Everything AI is off until you turn it on: a fresh profile has no Rita URL and no MCP server, and nothing leaves the app.

1. Connect an OpenBB-compatible backend, validate it and open a reference App.
2. Use tables, analytical Pivot, date expressions, trading calendars, provider keys, docked Parameters, workspaces and the Statement view as described in the v5, v4 and v3 manuals.
3. To turn on Rita, open the rail, click **AI Library**, and on **Agents** enter the Rita URL and press Return. The status reads *Online* once `agents.json` is fetched. Click **Done**; a **Rita** tab appears on the right edge of the window. Nothing is saved until Done, and Cancel discards the draft.
4. To give Rita tools, open **MCP Servers**, add the server's URL (the OpenBQ server's path is `/mcp`) and press **Check**; it reports the tool count or *Unreachable*. Use **Tools** to switch off individual tools, including tools reached through the `call_tool` and `run_pipeline` proxies. There is no confirmation prompt when Rita calls an enabled tool, so enable only servers you trust.
5. **Context sharing** (Agents tab) is off by default. With it off, Rita receives the conversation, your enabled skills' descriptions, the tool list, your time zone, the agent's own option values and the names of your dashboards, but no cards, parameters or data. With it on she also receives each card's definition and current parameters; use a card's **⋯ ▸ Share with Rita** to point her at particular cards.
6. To have Rita arrange a CSV/XLS table (or a linked table), open the table's tab and ask, for example, "total Volume by Region". She inspects the table, makes one arrangement and explains the numbers from the engine's preview. **Undo** in the bar under the chat reverses one arrangement. Backend tables answer *server-execution-pending*; load the data as a CSV/XLS table to arrange it with Rita.
7. Save locally or export BDOBB-compatible apps.json as in v5. AI settings travel in `ai-library.json` or a settings bundle; bearer tokens never do.

See the [v6 reference manual](reference-manual/v6/README.md), [v5 reference manual](reference-manual/v5/README.md), [v4 reference manual](reference-manual/v4/README.md) and [v3 onboarding](reference-manual/v3/README.md). In-app Quick Help and Reference Manual include Rita and AI Library pages.

Optional User Settings storage on a server (Settings ▸ General ▸ User Settings) syncs display settings with a Workspace connection or a backend serving the Workspace settings API. It does not synchronize dashboards or workspace arrangements.

Status: isolated development candidate; qualification pending; nothing published or tagged.

Copyright 2026 SecretoftheUniverse.com LLC. Licensed under Apache-2.0.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v6.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
