---
type: Note
tags: [bdobb, help, ai, rita, mcp, skills, share-targets, settings]
---

# The AI Library

The AI Library is where the app's agent side is configured: the Rita agent it talks to, the MCP servers whose tools Rita may call, the places a finished chat can be sent, the skills Rita may draw on, and how Rita's own pane behaves. Open the rail and click **AI Library**, directly under **Widget Library**. It opens as a dialog with five tabs: **Agents**, **MCP Servers**, **Send chat to…**, **Skills** and **Appearance**.

What you change on any tab is staged: **Cancel**, the **✕** and **Escape** all discard the pending changes unchanged, and only **Done** applies them and writes them to disk. **Skills** follows the same rule, though a skill is a file rather than a setting: **Done** writes the skills you staged after the settings. The dialog's **Export…** and **Import…** buttons carry the library's settings as an `ai-library.json` file; an import is staged too, and does nothing until **Done**.

## Agents

![The AI Library, Agents tab, with Rita online](../attachments/ai-library.png)

**Rita URL** is the address of a Rita instance — the OpenBB agent host that serves `agents.json`. Enter it and press Return (or click away); the app fetches `agents.json` from that address and reports one of four states beneath the field:

- **Not checked** — no address has been entered yet, or the field holds an edit you haven't committed with Return or a click away.
- **Checking…** — a committed address is being fetched.
- **Online** — `agents.json` was fetched and parsed. The agent Rita advertises is shown with its description and the features it declares.
- **Offline: *reason*** — the address was set but nothing answered, or the answer was not an `agents.json`; the reason is appended to the label.

On the openbq-docker stack's Episode 6 overlay, Rita answers at `https://openbq.<your-tailnet>.ts.net:10443`, and also at its Tailscale Service name `https://openbq-rita.<your-tailnet>.ts.net` once that Service is set up (see [[rita-ai-agent-setup|Setting Up the Rita AI Agent]]). Only `http(s)` addresses are accepted; a trailing slash is trimmed. A fresh profile has no Rita URL (Rita is off), unless the build was made with `VITE_DEFAULT_RITA_URL`; see [[rita-ai-agent-setup|Setting Up the Rita AI Agent]]. Clearing the field turns Rita off and removes the chat tab.

What a feature looks like depends on what kind of feature `agents.json` declares it to be:

- A **plain boolean** — `streaming: on`, `mcp-tools: on` — is a capability badge. It reports what Rita can do; there is nothing to flip.
- An **untyped toggle** is a live switch. Your answer is saved per agent and sent with every message from then on; until you touch it, Rita's own default is what goes out.
- A **typed text option** is a field you commit with Return or a click away, saved and sent the same way.
- A **typed select** — **Model** — is shown as text rather than a picker. **Why is the model fixed?** beside it explains: `agents.json` advertises the models the host *could* serve, which is not a promise it can reach any of them right now, so the app sends the default as-is.

**Follow-up suggestions** is this app's own switch: it decides whether the chat pane shows the follow-ups Rita offers at the end of a turn. Turned off, it also asks Rita not to write them. See [[rita-chat|Rita (AI Chat)]].

**Maximum tool rounds** limits how many tool-execution rounds one Rita message may use. The range is 1–40 and the default is 40; a new value applies to the next message you send. When a turn reaches the limit it stops running tools, keeps the tool results already collected, and ends with a **WARNING** that the work may be incomplete. An `ai-library.json` or settings file that does not carry the field leaves the current limit alone.

**Context sharing** is a switch, off by default. With it on, the app shares a description of the widgets on the current dashboard with Rita as context for a chat, and each card's **⋯** menu offers **Share with Rita** to mark particular cards as added to that context; with it off no card description is sent, Rita can read no card's data, and the card menus stop offering it — though rows and tool results from earlier turns stay in the conversation, and are re-sent with it, until **Clear**. See [[rita-chat|Rita (AI Chat)]] for what is and is not sent.

## MCP Servers

An MCP server offers tools that Rita can call during a chat. Add one by URL with **Add** (or Return); it starts enabled. A fresh profile has no servers, unless the build was made with `VITE_DEFAULT_MCP_URL`, which adds one named **OpenBQ MCP** with `install_skill` already switched off. Each row has an **Enabled** switch (a disabled server stays in the list but is not offered to Rita), **Check** — which connects to the server now and reports how many tools it offers, or **Unreachable** with the reason — and **Remove**. Only `http(s)` URLs are accepted, and the OpenBQ server's path is `/mcp`: on the openbq-docker stack's Episode 6 overlay it answers at `https://openbq.<your-tailnet>.ts.net:11443/mcp`, or at its Tailscale Service name `https://openbq-mcp.<your-tailnet>.ts.net/mcp` once that Service is set up.

### Turning tools off

**Tools**, beside a row that has been checked, lists the tools that server advertises, each with a checkbox and its size — the length of the whole tool definition as JSON, the number the budget below counts. Unchecking one takes it out of the catalogue Rita is offered *and* refuses a call that names it anyway, so an old turn's call or a hand-built one does not reach the server. New tools arrive checked. The list is per server and is staged with the rest of the dialog. An unchecked tool also stops counting against the size budget below.

**Per-tool disable works on the name a call really runs.** The OpenBQ server (`openbb-mcp-server` 2.0.1) advertises ten tools, and almost all of the real work goes through two of them:

- **`call_tool`** runs one provider tool by name. The effective name is the call's `name` argument.
- **`run_pipeline`** runs several in order. The effective names are every step's `tool`.

For any other tool, the effective name is the tool's own name. A call is **refused before anything is sent to the server** when any effective name is switched off for that server. The refusal names the tool, is shown as a failed call and counted in the trail's error total, and Rita is told so she can plan around it. A malformed proxy call — a missing or non-text `name` or `tool`, or `steps` that is not a list — is refused the same way and never forwarded, because it could not be checked.

**Disabling `call_tool` or `run_pipeline` itself disables that proxy wholesale.** Unchecking either in the Tools list switches off every call routed through it, whatever it names, and takes the proxy out of the catalogue Rita is offered.

To switch off one proxied tool rather than the whole proxy, use **Tools called through proxies**, which every server row carries below its Tools list:

- It lists the effective names this profile has already called through that server's proxies, de-duplicated and sorted. A name is added after a call that worked, never after a failed or refused one, since a failure may be a typo.
- Each name has a checkbox. Unchecking it refuses that tool before anything is sent; it uses the same per-server switch as the Tools list.
- To switch a tool off before it has ever been called, type its name in the field and press **Add** (or Return). The name is listed and starts switched off.
- Like everything else here, the choice is staged: **Done** persists it and **Cancel** discards it.

The activity trail, the call log and a tool-failure line show the effective name, for example `OpenBQ MCP · equity_price_historical (via call_tool)`, or the list of a pipeline's steps, so what you see is what you can switch off.

**Enabled**, and these per-tool checkboxes, decide whether a tool can be called at all. A checked tool on an enabled server still does not run unprompted: every call stops on a **Run**/**Deny** prompt in the Rita pane first. See [[rita-chat|Rita (AI Chat)]].

### Tokens and credentials

A row marked **token** needs a credential. If it came from a backend that holds one, that backend's credential is sent. If it came from a file, or that backend is gone, the row reads **Token required** and offers a field: paste a bearer token and **Save**. **Replace** and **Forget** manage a saved one afterwards, and removing the server forgets its token too. Bearer tokens live only in their own file, `mcpTokens.json`, in the app's data directory — they are *not* in `settings.json` and are never written to an export. See [[import-and-export|Import and Export]]. A server without the **token** mark, such as the OpenBQ MCP, is sent no credential at all.

If a token server is on a **different host** from the backend the credential belongs to, the credential is not sent at all unless you turn on **Send credential anyway** for that server. A server that arrives in an imported file always arrives with that switch off.

### Servers from the dashboard, and from files

**From this dashboard**, below your own list, shows the MCP servers that widgets on the open dashboard name, while Context sharing is on. They have the same **Check** and **Tools** controls, they are never stored in your list, and they come and go with the widgets.

An MCP server named in an imported `apps.json` arrives switched off; turn it on in this tab when you trust it. A backend-sourced token server arriving in any import is also switched off.

### A server on this computer or a private network

A server on this computer or a private network is named, never refused. Add one whose address is loopback, `localhost` or any `*.localhost`, the unspecified address (`0.0.0.0`, `::`), a private range, link-local or an IPv6 unique-local address — an IPv4-mapped IPv6 form of any of these included — and its row shows *Warning: this server is on this computer or a private network.* Importing an `ai-library.json`, a `bdobb-settings.json` or an `apps.json` file names every such server in its notice, *Warning: on this computer or a private network: …*, and imports it. Opening an app from a backend shows no notice, so there the same warning is written to the log instead (see **Settings ▸ Logs**). Tailscale addresses and `*.ts.net` names are deliberately not flagged, and a name is judged as written, not resolved. Worth knowing because a tool server on this computer or your LAN reaches places a public one cannot — if a row arrived in an imported file rather than from you, read its address before enabling it.

### What a turn asks of a server

The app speaks MCP's Streamable HTTP transport (`initialize`, `notifications/initialized`, `tools/list` and `tools/call`), follows tool-list pagination, and asks each enabled server for its tools at the start of a turn under a budget of 128,000 characters, so a server advertising hundreds of tools cannot flood a local model's context. A server that exceeds what is left of the budget is left out with a named warning in the trail; switching off its large tools can bring it back. A server that is unreachable at the start of a turn is skipped with a warning in the trail, and the turn goes on without its tools.

## Send chat to…

A share target is somewhere a finished chat can be sent from the pane's ⋯ menu. Nothing is sent from this tab; it is the list the chat pane will offer. Each target has:

- **Name** — how it appears in the chat pane's menu.
- **Kind** — **MCP tool**, **HTTP POST** or **Folder**.
- **URL** (or **Folder** for the Folder kind) — where it goes.
- **Tool** — for an MCP tool target, the name of the tool to call.
- **Template** — a JSON object. Its string values may use `{{title}}`, `{{markdown}}`, `{{filename}}` and `{{exportedAt}}`. The default template sends title and markdown.
- **Headers** — for an HTTP POST target, one `Key: value` per line.

For the **Folder** kind, the chat is written as a file under the named folder — `{{filename}}` unless the template has a `path` value. The folder must be listed in `VITE_SHARE_FOLDERS` when the app is built: that setting becomes the file-system access the built app is allowed, so a folder not listed there cannot be written to, and sending to it fails.

**Save** adds the target, or replaces it when you opened it with **Edit**. The form refuses an empty name, a URL that is not `http(s)`, an empty folder (*Folder path is required.*), an MCP target without a tool (*Tool name is required for an MCP target.*), a template that is not a JSON object, and a header line without a colon, and says which.

## Skills

A skill is a markdown document of standing instructions for Rita, with a one-line description Rita matches against your question. Rita is offered the descriptions on every turn and asks for a body only when one looks relevant, so a long skill costs nothing until it is used.

Five ship with the app. **arrange-table** is how Rita is told to use `describe_table` and `arrange_table` on a table card: inspect the card first, make one arrangement, choose each aggregate by what the column *means*, and explain from the engine's preview without doing arithmetic herself. **build-dashboard** is how she is told to author the board herself. The other three are OpenBB's own HTML chart, report and table rules (`openbb-html-chart`, `openbb-html-report`, `openbb-html-table`; their text is © OpenBB Inc., and the app keeps that line through an edit).

Each row shows the slug, the description and an **Enabled** switch. Only enabled skills are offered to Rita, and a disabled one cannot be read even if Rita asks for it by name — the app answers *Skill "…" not found*. **Create skill**, above the list, and a row's **Edit** each open a dialog stacked over the AI Library — titled **Create skill** or **Edit skill**. Escape closes the skill editor first, then the AI Library. **Remove** takes the skill out of the list at once, but like every other change here it is only staged: nothing is added, changed or removed on disk until you click **Done**, and **Cancel** puts it back.

The editor has three fields. **Slug** is the name — lowercase letters, digits and hyphens, 1 to 64 characters, never starting or ending with a hyphen — and is also the folder the skill is kept in, so changing it on an existing skill renames that folder. **Description** is the one line Rita matches against, up to 500 characters. **Instructions** is the markdown Rita follows. The submit button reads **Create skill** when adding and **Save changes** when editing; a new skill starts enabled, and an edited one keeps its switch where it was. The editor refuses a slug that is not a slug, a slug another skill already has, an empty description and empty instructions, and says which.

In chat, `/skill:<slug>` at the start of a message or after a space sends that skill's whole text with the message, whether or not Rita would have picked it. An unknown or disabled slug in that position is ignored.

**Skills are files, not settings.** Each one is `skills/<slug>/SKILL.md` in the app's data directory (see [[app-data-and-settings|App Data and Settings]]): a short `---` header carrying `name`, `description`, `enabled` and `updated`, then the markdown. The enabled flag is `enabled: false`, exactly; any other value reads as enabled. The bundled five are written only when `skills/` does not exist, so a profile upgraded from v5 receives them on first launch, and an empty `skills/` is left empty rather than refilled. Skills are written when you click **Done**, after the settings: removals first, then only the skills that changed. If one cannot be written, the AI Library stays open with the error and **Done** again retries only what did not land. The AI Library's **Export…** and **Import…** carry settings only — never these files.

## Appearance

How Rita's surfaces behave, as opposed to what Rita talks to. **Rita rail opens after** is how long the pointer must rest on the collapsed tab before it expands, in milliseconds — 500 by default, on a slider from 0 to 2000. The tab sits along the right edge, which is also the edge you cross to reach a card's own controls; the delay is what keeps a crossing from being read as a hover. Set it to 0 to open the pane the instant the pointer arrives. The delay applies only to hovering: locking the pane, focusing its message box and **⌘⇧A** all open it immediately.

## Where it is stored

Everything on Agents, MCP Servers, Send chat to… and Appearance is held in the dialog's own draft as you edit it, and only reaches `settings.json` when you click **Done**; closing the dialog any other way discards the draft and leaves the file untouched. Once written, it survives a restart.

Because they live in `settings.json`, most of these fields travel in a `bdobb-settings.json` as well as in the library's own `ai-library.json`. The two files are not identical: `ai-library.json` carries the Rita URL, Context sharing, the MCP server list, the share targets, the follow-up switch and the tool-round limit. `bdobb-settings.json` carries all of those except the follow-up switch, and also the pane's hover delay, the per-agent feature answers, the per-tool switches and the list of proxied tool names. Either file holds any server headers in the clear; see [[import-and-export|Import and Export]]. An import that leaves out the tool-round limit, the per-tool switches or the proxied tool names keeps the current values.

---
*Source: BDOBB v6.0.0 `src/components/ai/` (`AILibrary.tsx`, `AgentsTab.tsx`, `McpServersTab.tsx`, `SkillsTab.tsx`, `SkillEditorDialog.tsx`, `ShareTargetsTab.tsx`, `AppearanceTab.tsx`), `src/lib/agent/proxiedTools.ts`, `src/lib/agent/execute.ts`, `src/lib/agent/mcp.ts`, `src/lib/agent/mcpAuth.ts`, `src/lib/agent/importedMcp.ts`, `src/lib/aiLibraryFile.ts`, `src/lib/settingsBundle.ts`, `src/lib/skillsFiles.ts` and `src/lib/settingsFile.ts`; `openbq-docker` `docker-compose.v6.yml` and `ts-config/serve-v6.json` at `v10.0.0`.*
*See also: [[rita-chat|Rita (AI Chat)]] · [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] · [[settings-and-logs|Settings and Logs]] · [[app-data-and-settings|App Data and Settings]]*
