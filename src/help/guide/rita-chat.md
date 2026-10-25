---
type: Note
tags: [bdobb, help, ai, rita, chat, agent, skills]
---

# Rita (AI Chat)

BDOBB's chat pane talks to any agent that speaks OpenBB's published custom-agent protocol — by default **Rita**, OpenBB's open-source agent, running as a private service on hardware you control. See [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] for the services and what Rita can do, and [[ai-library|The AI Library]] for pointing the app at them. Until a Rita URL is set, there is no chat pane at all.

## Where it lives

![The Rita pane, locked open, mid-conversation](../attachments/rita.png)

When a Rita URL is set, a thin tab labelled *Rita* appears on the right edge of the window. Hover it to open the chat pane; move away and it folds back. A dot on the tab means Rita answered while the pane was closed. The pane also stays open while the message box has focus, so a stray mouse movement never folds a half-written question away.

Because the right edge is also the edge you cross to reach a card's own controls, the tab waits before opening — 500 ms by default, adjustable from 0 to 2 s in **AI Library ▸ Appearance**. The delay applies to hovering only.

## Locking

Press **⌘⇧A** (Ctrl+Shift+A on Windows and Linux) or click the lock in the pane header to keep the pane open. In the desktop app the shortcut belongs to **Window ▸ Keep Rita Open** and works anywhere, typing included; in the web preview it is ignored while you are typing in a field. The icon shows what a click will do: a closed lock to lock, an open lock to unlock.

## The header

A presence dot reads *Checking Rita*, *Rita online* or *Rita offline* — the app fetches Rita's `agents.json` when the pane opens. Beside the name is the **model** Rita will answer with. There is no model picker, on purpose: Rita advertises the models its host *could* serve, not the ones it can reach right now, so the app sends Rita's own default as-is and shows it here.

The **⋯** menu offers **Export…**, one **Send to …** entry per share target configured in the AI Library, and **Clear**. **Clear** empties the conversation, deletes the saved chat file, and releases every card you had shared with Rita.

## Asking

Type in the box (*Ask Rita…*) and press **Enter** to send; **Shift+Enter** is a new line. Rita's answers render as Markdown; a table Rita produces renders as a table (the first fifty rows), and an HTML artifact renders in a sandboxed frame that follows the app's theme.

### Stop and the next turn

While Rita is answering, the Send button reads **Stop**. Stop aborts the request to Rita and ends the turn: whatever had streamed stays on screen, no error is shown, and the box is free for your next message, which starts a new turn. Two things Stop does not reach:

- Changes Rita had already made to your dashboards stay made. Each is still in the Undo bar, so **Undo** is how you take one back.
- A tool on an MCP server that already received its request may have acted on it. Stop cancels the request itself, so BDOBB stops waiting for the answer, and the trail marks the call *Stopped*; a call still waiting on **Run** or **Deny** is settled as denied.

Under an answer you may see:

- **A status trail** — *3 steps · 0 errors*, expandable to the reasoning and tool-call steps Rita reported, open while a turn runs and collapsed afterwards. A call to a proxied MCP tool is labelled with the tool it really runs, for example `OpenBQ MCP · equity_price_historical (via call_tool)`.
- **Sources** — the widgets and documents Rita cited, clickable when they have an address.
- **Follow-up suggestions** — buttons Rita proposes; click one to send it. The **Follow-up suggestions** switch in **AI Library ▸ Agents** (on by default) controls whether these appear at all. Committing it off clears any suggestions already on screen, and none arrive while it stays off; committing it back on does not resurrect what was cleared.

A request that goes quiet for **45 seconds** is abandoned with a message rather than left hanging. Quiet means no bytes at all: the keepalive comments Rita sends while a model is still thinking count as activity, so a long think is not cut off. Rita being unreachable is reported as *Rita offline* in the header and an error line above the box.

## What Rita can see

**Context sharing** is a switch in **AI Library ▸ Agents**, off by default. With it off, **what is sent** with each message is the conversation, your enabled skills' descriptions (see **Skills** below), the list of tools Rita may call, your time zone, the agent's own option values, and one line naming the dashboard you are on and the names of your other dashboards. Dashboard names are sent either way, so a tool that takes a dashboard name acts on the board you mean rather than one the model invents. No card descriptors are sent. The conversation itself is another matter: rows Rita fetched with `get_widget_data` and the results of MCP tool calls are part of it, so whatever earlier turns brought back is re-sent with every later message until you **Clear**, even after you switch sharing off.

With it off, Rita is also shown no card to act on. Her card tools — `describe_table`, `arrange_table`, `set_widget_params`, `set_markdown_content`, `remove_widget`, `describe_widget`, `rename_widget`, `move_widget` and `duplicate_widget` — answer *unknown card* for every card she did not create herself in this session (with `add_widget`, `add_note`, `create_dashboard` or `duplicate_widget`), and `get_widget_data` is refused for every card. **Clear**, switching sharing off, or restarting the app forgets which cards she created.

With it on, **what is sent** also includes a descriptor for every card on the active dashboard, across all of its tabs: the card's id, its widget, its title and description, the name of the backend it comes from, and each parameter's name, current value and default. It is the card's *definition and current parameters, not its data*. The descriptors are rebuilt before every step of a turn, so a card Rita has just edited reaches her with its new values.

Rita gets data only by asking *your app* for it. The app fetches the rows over its own connection, with its own credentials and the card's effective parameters, and hands them back. Rita has no route to your backends and no credentials, and cannot reach a card that is not on the active dashboard. Off-limits cards — the Provider API Keys table, settings widgets, any widget on a key-maint backend, and a Linked table whose source is one of those — are never sent, and a request for one is refused in the same shape as an unknown card, so the refusal itself reveals nothing. With context sharing on, MCP servers named by widgets on the dashboard are also offered to Rita for the turn; see [[ai-library|The AI Library]].

**Pointing Rita at particular cards.** With context sharing on, a card's **⋯** menu offers **Share with Rita**. The card then shows a small **Rita** badge beside its title (hover it: *Shared with Rita for this conversation*), and the message splits the dashboard in two: the cards you tagged go out as the ones *added to context*, and the rest of the active dashboard as what is merely *on the dashboard*, which Rita consults only when the tagged ones do not answer the question. **Stop sharing with Rita** releases one card; **Clear** releases them all. The tags are saved with the conversation. The badge is drawn only while context sharing is on, because with it off the tag is not sent. The menu never offers sharing on an off-limits card, and never in a viewer window.

A tool call's arguments are written by the model, so `get_widget_data` passes on only the parameters the widget declares: an argument naming any other parameter is dropped before the request goes to your backend. A date is resolved on the calendar the card would use with those arguments, so a `symbol` or `(MIC)` she passes picks it. Rita reads only the calendars the app has already loaded for your cards: if that calendar is not loaded yet (no card on screen uses it), the fetch fails with *calendar not loaded* and nothing is sent. A date that cannot be resolved for any other reason fails the same way. What comes back, though, is not fenced: widget rows and MCP tool results reach the model as plain data with no marker saying they came from outside, so a sentence buried in a news headline or a cell of text is not visibly separated from instructions.

## Skills

A **skill** is a markdown document of standing instructions with a one-line description, kept in **AI Library ▸ Skills**. Every message carries the descriptions of your enabled skills — slug, description and when it last changed, never the bodies — and Rita asks for a body with her own `get_skill_content` call when one looks relevant. A skill you have switched off is neither offered nor readable: the app answers that call *Skill "…" not found*.

Five skills ship with the app. **arrange-table** tells Rita how to use `describe_table` and `arrange_table` on a table card — inspect, interpret, make one arrangement, then explain from the engine's preview — and **build-dashboard** tells her to author the board herself instead of asking you to add a widget by hand. The other three are OpenBB's own HTML chart, report and table styling rules. They are instructions Rita reads, not logic wired into the app, so you can read them, and change them, in the Skills tab.

Typing `/skill:<slug>` at the start of a message or after a space sends that skill's whole text along with the message, whether or not Rita would have picked it. The message itself goes out unchanged, slug and all. See [[ai-library|The AI Library]] for writing and editing skills.

## Changes Rita makes, and Undo

Rita has 18 local tools that act on the app itself; [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] lists each with what it can and cannot do. With Context sharing off, the ones that name a card reach only the cards she created this session (see **What Rita can see** above). When she changes anything — adds or removes a widget, creates or renames a dashboard, sets a card's parameters, arranges a table — a bar appears above the dashboard naming the change, with a count of changes so far. **Undo** reverts the most recent one, one step per change; **✕** dismisses the bar and discards every stored change with it, so none of them can be undone from the bar afterwards. The bar remembers the last 20 changes.

- `remove_widget`'s Undo puts the whole card back at its tab and position, with its parameters, bindings, table arrangement and layout — but only while that removal is still the single pending one: once another card is removed, by Rita or by you, or its tab or dashboard is deleted, the earlier removal can no longer be undone. Rita may not remove a CSV/XLS table at all.
- `arrange_table` adds **one Undo per arrangement**, however many operations it contained. Undo restores the table's previous configuration against its current data. It refuses to overwrite anything you changed after Rita's edit: if you edited the table since, the card is gone from the active dashboard, or the previous configuration no longer fits the data, nothing is restored.
- **A failed Undo is shown, and changes nothing.** The edit bar shows the reason as an alert, and the failed entry is dropped from the list so it cannot block the older changes beneath it. The error is not swallowed, and no partial restore happens.

Asked to group, total, sort or tidy a table, Rita reads the card with `describe_table` and then arranges it with `arrange_table` — the same shared table model and engine as the Pivot drawer, so the arrangement she picks is one you could build by hand and the same Undo puts it back. She says why she chose each grouping and aggregate, and leaves a column unaggregated rather than guess. This applies to CSV/XLS tables, managed server tables, linked tables and backend tables; see [[tables|Tables]].

Rita can also call tools on any MCP server you have enabled in the AI Library — the OpenBB Platform's tool server — which is how she pulls exact numbers rather than guessing. Every MCP call carries a ten-second timeout, so one server that accepts a connection and never replies cannot hang a turn forever.

## When an external tool runs

Every call to a tool on an MCP server **asks first**. The turn pauses on a prompt in the Rita pane — *Run `tool` on **server** (url)?* — with the arguments the model wrote underneath, and **Run** and **Deny**. **Deny** tells Rita you declined, and she carries on without it; **Stop** or **Clear** while the prompt is open counts as Deny. A tool you have switched off is refused before any prompt. The app's own tools do not ask, with one exception: `set_widget_params` or `add_widget` pointing a website (iframe) or RSS card at a new URL loads that page the moment it is set, so it stops on the same **Run**/**Deny** prompt, and where no prompt can be shown it is refused with `NEEDS_USER`. Each of the app's tools records an entry in the Undo bar, so anything they did to a dashboard can be put back.

The prompt is the safeguard because the two halves are not equally recoverable. An MCP tool can place an order, write a file or send a message, and the text that talks a model into calling one can arrive inside data — a headline, a description, a cell — which is not fenced off. Read the arguments before you press **Run**, and keep **AI Library ▸ MCP Servers** to the servers and tools you mean to use: switch off the tools you would always deny.

## The tool-round limit

One message may use at most **Maximum tool rounds** (AI Library ▸ Agents; default 40, range 1–40). A turn that reaches it stops running tools, keeps its completed tool history, and ends with a **WARNING** in the status trail and in the answer that the work may be incomplete. See [[rita-ai-agent-setup|Setting Up the Rita AI Agent]].

## Sending a table row

A backend can set up a table column so that clicking a cell hands that whole row to Rita. The pane locks open and the row's message is put in the box, replacing whatever was there; nothing is sent until you press **Enter**, so you can read or edit it first. A row is card data, so these cells follow **Context sharing**: with sharing off, or on a card that is off-limits, they are plain cells. See [[tables|Tables]].

## When a tool fails

If a tool Rita calls fails — the server times out, answers with an error, or turns the request down — a short warning line appears in the conversation where it happened: *Tool call failed*, then the server, the tool and the reason. Rita is told as well and carries on with what she has, so a failed call does not end the turn. A call that comes back with an error rather than failing outright — one of the app's own tools turning a call down, a call to a tool you switched off, or an MCP result that carries an error — counts as failed the same way: the warning line, a failed entry in the call log, and an error step in the status trail, so the trail's error count includes it. A call you **Deny** shows a *Tool call denied* line instead. A card fetch that fails — `get_widget_data` — shows no warning line: it is a failed entry in the call log, and Rita is told the fetch failed.

## Export and send

**Export…** writes a Markdown file holding the conversation, any tables Rita produced, and the API calls it made on your behalf. **Send to …** posts the same to a share target — an MCP tool, an HTTP endpoint, or a folder on disk — configured in **AI Library ▸ Send chat to…**. A notice under the header confirms *Exported …* or *Sent to …*, or says why not.

## What is kept

The conversation is saved to `chat.json` in the app's data directory, together with the cards you shared with Rita, and survives a restart. It lives in its own file rather than beside the settings, so a corrupt transcript can never take your settings down with it. **Clear** deletes it.

A conversation saved by an earlier build can hold tool messages of a different shape. BDOBB reads it, but if Rita answers oddly or errors on every message after an upgrade, start a fresh chat with **Clear**; see [[troubleshooting-using-bdobb|Using BDOBB]].

## What it is good at

A local model paired with tool access is strongest on questions where precision matters more than open-ended reasoning — "pull the last month of closes from this table and tell me what changed", "what is on this screen and what moved today". For long unaided reasoning with nothing to look up, expect a smaller local model to show its limits; that is the honest trade-off of running privately rather than against a frontier cloud model.

---
*Source: BDOBB v6.0.0 `src/components/rita/`, `src/stores/chatStore.ts`, `src/stores/agentEditsStore.ts`, `src/lib/agent/query.ts`, `src/lib/agent/request.ts`, `src/lib/agent/execute.ts`, `src/lib/agent/skills.ts`, `src/lib/agent/tableModel/undo.ts`, `src/lib/chatFile.ts` and `src/hooks/useDashboardShortcuts.ts`.*
*See also: [[ai-library|The AI Library]] · [[rita-ai-agent-setup|Setting Up the Rita AI Agent]] · [[tables|Tables]] · [[troubleshooting-using-bdobb|Using BDOBB]]*
