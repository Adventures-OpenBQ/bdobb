# AI Library

The AI Library configures the agent side of the app: the Rita agent, the MCP
servers whose tools Rita may call, the places a finished chat can be sent, the
skills Rita may draw on, and how Rita's pane behaves. Open it from the rail's
**AI Library** row, under **Widget Library**. It has five tabs: **Agents**,
**MCP Servers**, **Send chat to…**, **Skills** and **Appearance**.

![The AI Library's Agents tab with Rita discovered](./shots/ai-library.png)

Everything you change is staged: **Cancel**, the **✕** and **Escape** discard it,
and **Done** applies it and writes it to disk. Skills follow the same rule —
they are files, written on **Done**. **Export…** and **Import…** carry the
library's settings as `ai-library.json`; an import is staged until **Done**.

## Agents

**Rita URL** is the address of the Rita agent. Enter it and press Return; the
app fetches `agents.json` and reports *Not checked*, *Checking…*, *Online* or
*Offline* with the reason. Rita is off until a URL is set, and clearing it turns
Rita off again.

The agent's own features appear under it: plain booleans as badges, toggles and
text options you can set (saved per agent and sent with every message), and the
model, which is shown as text because the app sends the agent's default as-is.
**Follow-up suggestions** controls whether the chat pane shows the follow-ups
Rita offers. Turned off, it also asks Rita not to write them.

**Maximum tool rounds** limits the tool-execution rounds one message may use
(default 40, range 1–40, applied to the next message). A turn that reaches it
stops running tools and ends with a WARNING that the work may be incomplete.

**Context sharing** is off by default. On, the app describes the widgets on the
open dashboard to Rita, and each card's **⋯** menu offers **Share with Rita**.
Off, no card description is sent and Rita can read no card's data, though
rows and results from earlier turns stay in the conversation until **Clear**.
See **Rita**.

## MCP Servers

An MCP server offers tools Rita can call. Add one by URL; it starts enabled.
Each row has an **Enabled** switch, **Check** — which connects and reports how
many tools the server offers, or *Unreachable* with the reason — and
**Remove**. Only `http(s)` URLs are accepted.

**Tools**, beside a checked row, lists the tools the server advertises, each
with a checkbox. Unchecking one takes it out of what Rita is offered and refuses
any call that names it, before anything is sent.

Per-tool disable works on the **effective name** of a call. The OpenBQ MCP runs
its provider tools through `call_tool` (the effective name is the call's `name`
argument) and `run_pipeline` (every step's `tool`). A call is refused before it
is sent when any effective name is switched off, and **disabling `call_tool` or
`run_pipeline` itself disables that proxy wholesale**. Each server row's **Tools
called through proxies** lists the names this profile has called through the
server, with a checkbox each, and a field to type a name you want switched off
before it has ever been called. Done persists the choice; Cancel discards it.

A row marked **token** needs a bearer token: paste it and **Save**. Tokens live
in their own file, `mcpTokens.json`, never in `settings.json` and never in an
export. A server on this computer or a private network is named, never refused:
its row shows a warning, and an import names every such server in its notice. A
server named in an imported `apps.json` arrives switched off.

## Send chat to…

A share target is somewhere the pane's ⋯ menu can send a finished chat: an MCP
tool, an HTTP POST or a folder. Each has a name, a URL (or folder), a JSON
template that may use `{{title}}`, `{{markdown}}`, `{{filename}}` and
`{{exportedAt}}`, and for HTTP, headers. A folder must also be listed in
`VITE_SHARE_FOLDERS` when the app is built, or sending to it fails.

## Skills

A skill is a markdown document of standing instructions with a one-line
description. Rita is offered the descriptions and asks for a body only when one
looks relevant. Five ship with the app. Each row has an **Enabled** switch — a
disabled skill cannot be read even by name — and **Edit** and **Remove**;
**Create skill** opens the same editor. The slug is lowercase letters, digits
and hyphens, 1 to 64 characters; the description is up to 500. Each skill is a
file, `skills/<slug>/SKILL.md` in the app's data directory.

## Appearance

**Rita rail opens after** is how long the pointer must rest on the collapsed tab
before it expands: 500 ms by default, 0 to 2000. It applies only to hovering.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v7.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
