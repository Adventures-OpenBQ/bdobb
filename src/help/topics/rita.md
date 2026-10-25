# Rita

Rita is the OpenBB agent. It is off until you set a Rita URL in **AI Library →
Agents**; then a thin tab labelled *Rita* appears on the right edge of the
window. Hover it to open the chat pane; move away and it folds back. A dot on
the tab means Rita answered while the pane was closed.

![The Rita pane, locked open, mid-conversation](./shots/rita.png)

## Locking

Press **⌘⇧A** (Ctrl+Shift+A on Windows and Linux) or click **Lock** in the pane header to
keep the pane open. Locked, the dashboard narrows to make room. The icon shows
what a click will do: a closed lock to lock, an open lock to unlock. The pane
also stays open while the message box has focus. In the desktop app the same lock is **Window ▸ Keep Rita Open**, whose checkmark follows it.

## Context sharing

**Context sharing** is off by default. With **AI Library → Agents → Context
sharing** on, every message carries a description of each widget on the open
dashboard — its definition and current parameters, not its data — so Rita can
ask the app for the data it needs. Off-limits widgets — the Provider API Keys
table, settings widgets, any widget on a key-maint backend, and a Linked table
fed by one of those — are never sent. With it off, the message carries no
widgets at all, Rita can read no card's data, and her card tools answer
*unknown card* for every card she did not create herself this session. Either
way every message names the dashboard you are on and your other dashboards'
names, so a tool that takes a dashboard name acts on the board you mean.

Switching sharing off does not take back what Rita already has: rows she
fetched and MCP results are part of the conversation, and are re-sent with
every later message until you **Clear** it.

To point Rita at particular widgets, choose **Share with Rita** from a card's
**⋯** menu (it appears only while Context sharing is on, never on an
off-limits card and never in a viewer window). The card shows a
**Rita** badge, and Rita looks there first, and at the rest of the dashboard
only when those widgets don't cover the question. **Stop sharing with Rita**
removes one; **Clear** ends the conversation and removes them all.

## Changes Rita makes

Rita has 18 tools that act on the app itself: she can create a dashboard, add,
find, duplicate, move, rename and remove widgets, set a widget's parameters,
write a note or a note's text, add and rename tabs, rename a dashboard, move the
view, read and arrange a table with `describe_table` and `arrange_table`, and
pin a card to the top or bottom of its tab, or unpin it, with `pin_card` (see
**Pinned cards**). `pin_card` leaves a locked widget alone and says so: a
locked widget is already at an edge of every dashboard.
An off-limits card answers *unknown card* to every tool that names a card,
and asking `add_widget` or `create_dashboard` for an off-limits widget gets
*no widget matches*, as for a name that does not exist. With Context sharing
off, the tools that name a card reach only the cards Rita created this
session. `add_widget` and `add_note` put the new card on the tab shown on
screen (for another dashboard, the tab it last showed).

Whenever Rita changes anything, a bar appears above the dashboard naming the
change. **Undo** reverts the most recent one, one step per change; **✕**
dismisses the bar and discards every stored change, so none can be undone
from it afterwards. The bar remembers the last 20 changes. A failed Undo is shown
in the bar and changes nothing. The tools that only read or only move the view
leave no entry.

`describe_table` and `arrange_table` work on **CSV/XLS, managed server and
linked tables**, and on backend tables, with the
same engine as the Pivot drawer, and one arrangement is one Undo. A standard LIVE
table answers `server-execution-pending` (choose a managed server source for
full analytical scope); a table showing a non-table view answers
`view-not-tabular`; and a table whose tab is not open
answers *runtime-not-ready*; open the tab and ask again. A backend table too
large for the table engine answers *runtime-not-ready* too, with that reason.
On a linked table fed
by a backend table whose columns carry a provider's aggregation hint (EODHD's
statements and prices), and on a managed server table read from such a backend
widget, `describe_table` reports the hint per field. When Rita
adds a measure there without naming an operator, `arrange_table` applies the
provider's operator if the arrangement meets its rule; a named operator is
still applied, with a warning if it contradicts the hint. See **Tables**.

One message may use at most the **Maximum tool rounds** set in **AI Library →
Agents** (default 40, range 1–40). A turn that hits it stops running tools and
ends with a WARNING that the work may be incomplete; the completed results are
kept.

## When a tool fails

If a tool Rita calls fails — the server times out, answers with an error, or
turns the request down — a short line appears in the conversation where it
happened: *Tool call failed:* the server, the tool, and the reason. Rita is told
too, and carries on with what it has. A call that comes back with an error
rather than failing outright — one of the app's own tools turning it down, a
tool you switched off, or an MCP result carrying an error — counts as failed
the same way. A Deny shows a *Tool call denied* line instead, and a card fetch
that fails shows no line: it is a failed entry in the call log, and Rita is
told.

Every call to a tool on an MCP server asks first: the turn pauses on a prompt
naming the server, its address, the tool and its arguments, with **Run** and
**Deny**. Deny tells Rita you declined. A tool you switched off in **AI Library →
MCP Servers** is refused without a prompt. Rita's own tools do not ask, except
when one points a website or RSS card at a new URL, which loads that page:
that stops on the same prompt.

## Skills

A skill is a markdown document of standing instructions, kept in **AI Library
→ Skills**. Every message carries the descriptions of your enabled skills —
never the bodies — and Rita asks for one when it looks relevant.
`/skill:<slug>` at the start of a message or after a space sends that skill's
whole text with the message. Five skills ship with the app; `arrange-table`
tells Rita how to use the table tools, and `build-dashboard` tells her to author
the board herself.

## Sending a table row

A backend can set up a table column so that clicking a cell hands that row to
Rita. The pane pins open and the row's message replaces whatever is in the box;
nothing is sent until you press **Enter**. These cells follow **Context
sharing**: with it off, or on an off-limits card, they are plain cells.

## Export and send

The **⋯** menu in the pane header offers **Export…** (a Markdown file with the
conversation, any tables Rita produced and the API calls it made on your
behalf) and one **Send to …** entry per share target configured in **AI Library
→ Send chat to…**. **Clear** empties the conversation and deletes the saved
chat.

## Stopping

**Stop** cancels the current answer; changes Rita already made stay, and each is
still in the Undo bar. Stop also cancels an MCP call in flight, and settles a
pending **Run**/**Deny** prompt as denied. A request that goes quiet for 45 seconds is abandoned with a message —
quiet means no bytes at all, so the keepalives Rita sends during a long think
keep it alive. Rita being unreachable is reported as *Rita offline*. If chats go
wrong after an upgrade, start a fresh chat with **Clear**.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v9.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
