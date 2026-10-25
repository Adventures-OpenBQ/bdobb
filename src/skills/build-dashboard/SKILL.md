---
name: build-dashboard
description: How to add, build and configure widgets for the user — use when asked to add, create, show, open or set up a widget, chart or dashboard. You place and configure widgets yourself; never tell the user to add one by hand or set its inputs for you.
---

# Building a dashboard

You author the dashboard yourself. The tools:

- `create_dashboard(name, widget_ids?)` — a new dashboard, optionally with an
  ordered list of widgets top to bottom.
- `search_widgets(query)` — find a widget to add when it is not already on a
  board; this is your only catalog of what is addable. Then
  `add_widget(widget_id, dashboard_name?, params?)` adds it (default: the
  current dashboard), with its required params such as `symbol`. `remove_widget(card_id)` removes one; `duplicate_widget` copies one.
- `describe_widget(card_id)` → `set_widget_params(card_id, params)` — read a
  card's params (names, types, dropdown options, current values), then set the
  ones that change (a chart's symbol, interval, range; any card's inputs).
- `add_note(text, dashboard_name?)` — put your own summary or findings on the
  board as a markdown card, not only in chat.
  `set_markdown_content(card_id, text)` — write into a note or markdown card
  that is already there (its whole body is replaced).
- `navigate(dashboard_name?, tab_name?)` — switch the view to a dashboard/tab.
- Housekeeping: `rename_widget`, `rename_dashboard`, `add_tab`, `rename_tab`,
  `move_widget` (grid x/y/w/h), `pin_card(card_id, edge)` (top/bottom/none).

Every change is one undoable step.

## You add widgets yourself — do not send the user to the Workspace

This app is not the OpenBB Workspace. **Never** tell the user to add a widget
by hand, drag one onto the dashboard, "pin it to this conversation," click a
paperclip, or "add it to context." None of that exists here, and it is the
single most common wrong answer. When the user asks for a widget or chart that
is not on the dashboard, **call `add_widget` and add it yourself**, then tell
them it is there.

You do not need a widget "pinned" to see it. You already see the dashboard's
widgets whenever the user has **Context sharing** on (a single global toggle in
the **AI Library**, on its **Agents** tab) — there is no per-widget pinning. If
Context sharing is off you see no widgets; say so and ask them to turn it on,
rather than inventing a pin step.

## Naming a widget

You are not handed the full catalog up front. You know the widgets already
placed on a dashboard — each appears in the widget context with its
`widget_id`, `name` and `description` — and for anything else you **call
`search_widgets`** to find it. So when the user asks for a widget that is not
on the board (a chart, a calendar, a screener…), search for it first, pick the
id from the results, then `add_widget` — do NOT tell the user to add it by hand
just because you have not seen it.

`add_widget`'s resolution is forgiving (exact id, case-insensitive id, exact
display name, then `_`/`-`-and-case-stripped), so a real id or exact name
resolves. But prefer an id you got from `search_widgets` over a guess — a guess
that does not resolve fails the call. Only if a search returns nothing should
you tell the user you could not find that widget.

## Configuring a widget: add it, then `set_widget_params`

Pass the widget's required params (a chart's `symbol`) to `add_widget` in the
same call: `{"widget_id": "…", "params": {"symbol": "AAPL"}}`. Its result's
`params.applied` lists what was set; `params.refused` means the card was added
**without** any of them, so fix them with `set_widget_params` before saying it
is done. `create_dashboard` places widgets with their **default parameters**.
To set a chart's symbol, interval or date range — or any card's
inputs — call `set_widget_params(card_id, params)` with just the params that
change; the rest keep their value and the card refetches. So configure the
widget yourself; do not tell the user to set it by hand.

Param names must match the widget's **declared params**. You see them in the
widget context — each placed widget lists its params. If you are unsure of a
name or its allowed values, call `describe_widget(card_id)` first: it lists each
param's type, current value and dropdown options, the way `describe_table`
informs `arrange_table`. An unknown name or an out-of-range dropdown value
refuses the whole `set_widget_params` call and lists what is valid, so correct
and retry. (Table grouping/sort is the exception: use `arrange_table`, not
`set_widget_params`.) The params go nested under `params`, never beside
`card_id`.

## A change is saved only when the result says so

A save succeeded only when its result says `updated: true` (`added: true` for
`add_widget`). A result with `error` saved **nothing**: read it, fix the call —
a `PARAMS_NOT_NESTED` refusal hands you the corrected call as `retry_with`, send
that — and call again. Do not move on to the next card or tab, and do not tell
the user it is done, until that card's save has succeeded.

## Worked examples

**"on my current dashboard, add an intraday chart for MSFT, 30-minute bars,
last 5 days"** — search for a chart widget, add the id the search returned, then
configure it with the `card_id` that `add_widget` returns:

`search_widgets`:

```json
{ "query": "price chart" }
```

`add_widget`, with an id from those results:

```json
{ "widget_id": "<widget_id from search_widgets>" }
```

then `set_widget_params` (param names as the widget declares them; you see them
in the widget context):

```json
{ "card_id": "<card_id>", "params": { "symbol": "MSFT", "interval": "30m", "range": "5d" } }
```

> Added the Art's Charts widget and set it to MSFT, 30-minute bars, a 5-day
> range.

**"build me a macro dashboard with rates, CPI and unemployment"** — create it
with the three widgets, coarsest context first, using ids seen in context:

```json
{
  "name": "Macro",
  "widget_ids": ["treasury_rates_fmp_obb", "cpi_fred_obb", "unemployment_fred_obb"]
}
```

**"put the earnings calendar on my Markets dashboard"** — one widget, named board:

```json
{ "widget_id": "calendar_earnings_fmp_obb", "dashboard_name": "Markets" }
```
