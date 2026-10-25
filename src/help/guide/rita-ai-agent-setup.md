---
type: Note
tags: [bdobb, help, integrations, rita, agent, mcp, setup, openbq]
---

# Setting Up the Rita AI Agent

**Rita** is the chat agent inside BDOBB, and **MCP servers** are the tool services Rita can call for exact numbers. Both are off until you point BDOBB at them: a fresh profile has no Rita URL and no MCP server, so nothing about your dashboards leaves the app and no request goes out. This page covers the two OpenBQ services BDOBB v6 is built against, how to connect them, what Check proves, and exactly what Rita can and cannot do to a dashboard. Nothing here is built by BDOBB itself; the app only needs the resulting URLs. On the openbq-docker stack both come from its Episode 6 overlay, `docker-compose.v6.yml`, shipped in openbq-docker `v8.0.0`.

## The three pieces

1. **The analyst — Rita.** OpenBB's open-source agent, built from `openbq-org/agent-rita` at commit `f673c1f` by the recipe `Adventures-OpenBQ/agent-rita-bdobb` `v6.0.0`, whose `scripts/build.sh` builds the local image `openbq-rita:6.0.0` on the machine that runs it, and run as the always-on service `openbq-rita`. Compose never pulls it (`pull_policy: never`), so the image must be built before the overlay is started. The recipe's patch series adds, among fixes to MCP tool schemas and error answers: an SSE keepalive (Rita sends a comment line while the model is still thinking, which keeps a long think from being mistaken for a dead connection), the Chat Completions API, a configurable model base URL, and a request queue for client-side tool calls. The queue matters: a model that asks for several app tools in one step would otherwise have only the first forwarded and the rest dropped. Because Rita speaks OpenBB's published agent protocol, BDOBB fetches `agents.json` for discovery and posts conversations to `/v1/query`, both relative to the URL you give it.
2. **The brain — the model.** Rita talks to any OpenAI-compatible model endpoint, typically one on your tailnet. Its address, key and default model are `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `DEFAULT_MODEL` in the stack's private `rita.env`, copied from `rita.env.example`. Rita runs in the Tailscale sidecar's network namespace so it can resolve a tailnet model endpoint by its MagicDNS name. The app sends no model name of its own; it shows the default Rita advertises in the pane header.
3. **The hands — the MCP server.** The OpenBB Platform's tool server, `openbb-mcp-server` 2.0.1, installed on this release's own API image, the `openbq-local` image the base compose builds as `openbq-api`, and run as `openbq-mcp`. Compose builds it from openbq-docker's `mcp/` as the local image `openbq-mcp:8.0.0` and never pulls it. It needs no trading-calendar extension of its own: the API image's `calendar` routes (the same ones date expressions read) serve the Platform's `obb.calendar`, and the image build checks that they are there. It is started with `--default-categories equity --tool-discovery`, which gives the agent a short list of discovery tools instead of the whole catalogue, and its `install_skill` administration tool is neutralised on the server (the skills folder it would write to is set to nothing). BDOBB's seeded server entry also has `install_skill` switched off on the client, so the tool is refused before any request is sent.

## URLs and access

With the Episode 6 overlay both services are served by the stack's own Tailscale sidecar, on the `openbq` node, published only to your tailnet and never funnelled:

| Service | Address |
|---|---|
| Rita | `https://<your-tailnet>:10443`, or `https://openbq-rita.<tailnet-domain>` |
| OpenBQ MCP | `https://<your-tailnet>:11443/mcp`, or `https://openbq-mcp.<tailnet-domain>/mcp` |

`<your-tailnet>` stands for the full MagicDNS name of the stack's `openbq` node on your own tailnet, and `<tailnet-domain>` for your tailnet's MagicDNS domain, the part of that name after `openbq.`; nothing in BDOBB or this guide names a real one. The second address of each row is a Tailscale Service name (`svc:openbq-rita`, `svc:openbq-mcp`). It works once you create the Service in your tailnet's admin console and switch the stack to its opt-in serve file, `ts-config/serve-v6-services.json`; the ports stay served beside it, so either address works. The MCP path is `/mcp`. Neither service publishes a host port. The overlay is used together with the base compose and the Episode 3 overlay; see [[openbq-docker-stack|The openbq-docker Stack]].

**Rita has no client authentication.** BDOBB sends no credential to Rita, and neither service is exposed to the public internet; reachability on the tailnet is the whole of the access control, the same arrangement described in [[tailscale-networking|Tailscale Networking]]. An MCP server that does require a bearer token is handled in [[ai-library|The AI Library]].

**The MCP server spends your provider keys.** MCP runs the OpenBB Platform in-process, so it loads the same provider keys as the API (`credentials.demo.env`, then your optional `credentials.env`) and has the same 16g memory cap, and it runs with the API's auth off so those in-process calls never ask for the API's Basic auth. Nothing on 11443 authenticates, even with the API's lock on: any tailnet device that can reach the `openbq` node can call its tools and spend those keys. Nothing on 10443 authenticates either, and Rita also answers tailnet devices as plain HTTP on the node's port 7777. Restrict 10443, 11443 and 7777 with a tailnet ACL that admits only your own devices. Funnel never exposes any of them.

## Connecting BDOBB

![The AI Library Agents tab once Rita is reachable](../attachments/ai-library.png)

Open the rail and click **AI Library**.

1. On **Agents**, enter the Rita URL and press Return (or click away). The status beneath the field reads *Not checked*, *Checking…*, *Online* or *Offline: reason*. Once you close the dialog with **Done**, a **Rita** tab appears on the right edge of the window whenever a Rita URL is set; the pane header shows whether Rita is online.
2. On **MCP Servers**, add the MCP URL and press **Check** on its row.
3. Click **Done**. Nothing is saved until you do, and **Cancel** discards everything you changed.

**What Check proves.** For Rita, *Online* means `agents.json` was fetched and parsed; it does not prove the model behind Rita is up. For an MCP server, Check performs the MCP handshake and lists the tools, then reports the tool count, or *Unreachable* with the reason. A successful Check proves the URL, the path and any token are right and that the server answers `tools/list`; it does not run a tool.

### Seeding a build with default URLs

If you build BDOBB yourself, two optional build variables put the services in a fresh profile so you do not have to type them. Put them in a gitignored `.env.local` before building:

- `VITE_DEFAULT_RITA_URL` sets the Rita URL.
- `VITE_DEFAULT_MCP_URL` adds one MCP server named **OpenBQ MCP**, enabled, with `install_skill` already switched off.

They apply only to a setting the profile has never had. An existing profile that already has a Rita URL or an MCP list keeps it, and a profile where you later cleared the URL or removed the server is never reseeded. Without `.env.local` there is no default and both stay off.

## What Rita can do to your dashboards

Rita acts on the app through **18 local tools**, run inside BDOBB under the reserved server name `bdobb-local`. Each takes a shallow object, because a local model's tool calling gets less accurate the deeper the arguments nest; the exception is `arrange_table`, whose arrangement is a nested list of operations (`arrangement.operations[]`). Every tool that changes something adds an entry to the Undo bar (see [[rita-chat|Rita (AI Chat)]]); `search_widgets`, `describe_widget`, `describe_table` and `navigate` change nothing and add none.

| Tool | What it can do | What it cannot do |
|---|---|---|
| `create_dashboard` | Create a dashboard, optionally with an ordered list of widgets. Names are matched forgivingly (exact id, id ignoring case, display name, then ignoring `_` and `-`), and a miss returns suggestions. | Use a name over 60 characters, or add an off-limits widget (a key-maint or settings widget, or any widget on a key-maint backend), which is listed as unresolved like a name that matches nothing. |
| `add_widget` | Add one widget to a dashboard, the current one by default, on the tab shown on screen (for another dashboard, the tab it last showed), optionally with its params (such as a symbol) and its view (such as Chart). | Add an off-limits widget: asked for one, it answers `UNKNOWN_WIDGET` (*no widget matches …*), as for a name that matches nothing. |
| `search_widgets` | Search the catalogue of widgets she could add, by id, name, description and category; capped at 50 results, 20 by default. | Return a key-management widget. |
| `remove_widget` | Remove a card. Undo puts the whole card back where it was. | Remove a CSV/XLS table: removing one deletes its stored file, so the call is refused. |
| `duplicate_widget` | Copy a card, parameters included, onto the same dashboard. | Duplicate a card on another dashboard. |
| `describe_widget` | Read a card's parameters: name, type, current value and a dropdown's allowed options. | Change anything. |
| `set_widget_params` | Change only the parameters you name, nested under `params`, and optionally the card's view (Chart, Statement, Calendar, Raw, Transposed or the default); the card refetches. Undo restores both. | Set a parameter the widget does not declare, a value outside a dropdown's options, a date the card's calendar cannot resolve (an unknown `(MIC)` such as `T(XNYZ)`, or `@` on a date-only parameter), or a view the card cannot offer (the whole call is refused and nothing is saved). A Chart or Calendar view draws only when the data has a date or time column. |
| `set_markdown_content` | Replace the whole body of a Note or Markdown card as one undoable step. | Write to any other kind of card. |
| `add_note` | Add a Markdown card carrying her own summary or findings, on the tab shown on screen (for another dashboard, the tab it last showed). | Edit an existing card. |
| `describe_table` | Read a table card's shared table model: its revision, fields, current arrangement, the operations the engine accepts, warnings and completeness. | Read a standard LIVE table (see below). |
| `arrange_table` | Apply one all-or-nothing arrangement to a CSV/XLS table, a managed server table, a linked table or a backend table: categories, measures, formulas, filters, Page, sorting and the rest of the model, using the same engine as the Pivot drawer. | Arrange a standard LIVE table, or change anything but existing viewer controls in a viewer window. |
| `move_widget` | Move or resize a card on the 40-column grid. The card takes the spot it is given, as a drag does: a card it lands on moves down (a card pinned to an edge stays where it is), and one Undo puts them all back. | Move a card to another dashboard. |
| `rename_widget`, `rename_dashboard`, `rename_tab` | Change a card's title, a dashboard's name, a tab's name. | Rename a card or tab outside the current dashboard (`rename_dashboard` can name any dashboard). |
| `add_tab` | Add a tab to the current dashboard. | Add a tab to another dashboard. |
| `navigate` | Move the view to a dashboard and/or tab by name; inside a workspace it leaves the workspace and shows the dashboard alone, as a click in the rail does. | Edit anything. |
| `pin_card` | Pin a card to the top or bottom edge of its tab, where it stays while the rest scrolls, or unpin it (`edge` `none`). One card per edge per tab: pinning a second swaps the first back into the grid. One Undo step. See [[locked-and-pinned-widgets\|Locked and Pinned Widgets]]. | Pin a locked widget: it already sits at an edge of every dashboard, so the call changes nothing, adds no Undo step and answers `pinned: false` with the reason. |

Three rules cover every card tool (`describe_table`, `arrange_table`, `set_widget_params`, `set_markdown_content`, `remove_widget`, `describe_widget`, `rename_widget`, `move_widget`, `duplicate_widget`). Rita can only name a card on the **active dashboard**. An off-limits card — the Provider API Keys table, a settings widget, any widget on a key-maint backend, or a Linked table whose source is one of those — is invisible to all of them: asked to touch one, a tool answers *unknown card* exactly as it would for an id that does not exist. And with **Context sharing** off (the default) Rita is shown no card, so every card she did not create herself in this session answers *unknown card* too; **Clear**, switching sharing off, or a restart forgets which ones she created.

### The table tools, in detail

`describe_table` and `arrange_table` work on **CSV/XLS tables, managed server tables and linked tables**, and on a **backend table** (one whose rows come from a backend widget), which runs on the app's table engine like a CSV/XLS table. A managed server table runs on the stack's table service (server execution, since v6 for Rita), and she reads and arranges it like any other. Only a standard LIVE table answers `server-execution-pending`: its paging runs on the server, so its table model cannot be inspected or arranged; choose a managed server source for full analytical scope. Rita can still read it with `describe_widget` and `get_widget_data`. A backend table too large for the table engine answers `runtime-not-ready` with the reason (*This table is too large for the table engine*). A table card showing a Chart or another non-table view answers `view-not-tabular`; switch it back to Table or Statement view.

- **The card's tab must be open.** A table on a tab that has not been opened has no running table, and the tools answer `runtime-not-ready` instead of guessing. Open the tab (or ask Rita to `navigate` to it) and ask again.
- **`stale-revision` means describe again.** `describe_table` returns a revision, and `arrange_table` must pass it back. If the table changed in between, the arrangement is refused and Rita re-reads before trying again.
- **One Undo per arrange.** All operations in one call apply together or not at all, and a successful change adds exactly one entry to the Undo bar. A call that changes nothing answers `unchanged` and adds none.
- **A table with no model starts with no measures.** When `describe_table` reports the model as `none`, Rita adds measures herself before placing them.
- **Viewer mode.** When a table is in viewer (read-only) mode, Rita can change only the viewer controls the table already exposes, for that session only, and one Undo puts back just the controls she moved. Anything else is refused with `viewer-scope`, and analytical and linked tables are read-only to her apart from those existing controls. The chat pane exists only in the main window, so this is a guard you will rarely meet.
- **Every number comes from the engine.** The numbers Rita reports about an arrangement are the values in the engine's preview of the applied result; the bundled **arrange-table** skill tells her not to total, count or average anything herself.
- **Read-only asks only preview.** When you ask Rita to summarize, describe, check or compare a table without asking for a change, she runs the arrangement in preview mode: she reads the engine's numbers, but the table, the dashboard and Undo stay exactly as they were.

`get_widget_data` is not one of the 17: it is how Rita asks BDOBB for a card's rows. The app fetches them over its own connection with the card's **effective parameters** (the values the card itself sends, with its bindings and groups applied), and only for a card on the active dashboard. A CSV/XLS table refuses it; use `describe_table` for those. With Context sharing off it is refused for every card.

## The tool-round limit

Rita works in rounds: each time she asks BDOBB to run a tool, that is one round, and several tool calls in one model step are run one per round. **AI Library ▸ Agents ▸ Maximum tool rounds** sets how many rounds one message may use. The range is 1–40 and the default 40; the setting can only tighten the default. A new value applies to the next message you send.

A turn that reaches the limit does not fail. BDOBB stops running tools, keeps every completed tool result in the conversation, and adds a **WARNING** to the status trail and to the end of the answer saying the limit was reached and the work may be incomplete. Review what was done, then either raise the limit (up to 40) or split the request into smaller ones.

## The permission model

Rita cannot reach your backends, stores or credentials directly. When she wants a widget's data she asks the app, which fetches over its own connection with its own credentials and hands back the rows.

- An off-limits card (the Provider API Keys table, a settings widget, any widget on a key-maint backend, or a Linked table fed by one) is refused in a shape indistinguishable from an unknown widget.
- Rita can only name a card on the active dashboard.
- **Every MCP tool call asks first.** The turn pauses on a prompt naming the server, its address, the tool and its arguments, with **Run** and **Deny**. Tools you have switched off are refused without a prompt; see [[ai-library|The AI Library]].
- Tool results and widget rows are **not** fenced off as untrusted data, so a sentence buried in a news headline or a table cell reaches the model looking like any other text. A call's arguments are also written by the model, so `get_widget_data` passes on only the parameters the widget declares and drops any other.

## Smoke-testing before connecting the app

Fetch `<rita-url>/agents.json`; a JSON document describing the agent means Rita is reachable. For the MCP server, the **Check** button in the AI Library is the same test BDOBB itself relies on. Use the full URL including `/mcp`.

## Troubleshooting

Rita and MCP failures — a chat that errors on every message, a tool call that is refused, a round-limit warning, timeouts, an unreachable MCP server and the private-network warning — are indexed in [[troubleshooting-using-bdobb|Using BDOBB]] and [[troubleshooting-infrastructure|Configuring the Infrastructure]].

---
*Source: BDOBB v6.0.0 `src/lib/agent/localTools.ts`, `src/lib/agent/tableModel/`, `src/lib/agent/limits.ts`, `src/lib/agent/query.ts`, `src/lib/agent/execute.ts`, `src/lib/settingsFile.ts` and `src/components/ai/AgentsTab.tsx`; the OpenBQ Rita and MCP services' pinned sources (`Adventures-OpenBQ/agent-rita-bdobb` `v6.0.0`: `sources.lock`, `patches/`, `scripts/build.sh`); `openbq-docker` `README.md`, `docker-compose.v6.yml`, `mcp/Dockerfile`, `mcp/requirements.lock`, `ts-config/serve-v6.json` and `rita.env.example` at `v8.0.0`.*
*See also: [[rita-chat|Rita (AI Chat)]] · [[ai-library|The AI Library]] · [[openbq-docker-stack|The openbq-docker Stack]] · [[tables|Tables]] · [[tailscale-networking|Tailscale Networking]] · [[troubleshooting-infrastructure|Configuring the Infrastructure]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
