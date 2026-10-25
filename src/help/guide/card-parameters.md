---
type: Note
tags: [bdobb, help, interface, parameters, groups, forms]
---

# Card Parameters

Most widgets take parameters — a symbol, a date range, a provider. The card's header carries a row of controls, one per visible parameter, on its own line directly under the title. There is nothing to open: what a card is asking for is always in view. A card with many parameters wraps the row onto further lines rather than clipping it.

Some parameters are declared hidden by the backend. They never appear here, but they are still sent with every request — that is how `provider` rides along on nearly every widget, and how a Note stores its text without cluttering the row.

## When a change takes effect

A dropdown, a multi-select and a checkbox take effect the moment you change them. A text, number or date field takes effect when you leave it or press **Enter**, so a half-typed symbol does not refetch the card on every keystroke. Only a genuine change is written: typing a value and typing it back writes nothing, and re-picking today on a date that holds `$currentDate` does not count as a change either.

A card whose widget declares a **Run** button is the exception: its controls save what you chose and mark the card stale (a dot beside the title), and nothing is fetched until you press **Run**. See [[running-and-refreshing|Running and Refreshing]].

## The kinds of control

Which control you get is decided in this order:

- A **tabs** parameter with options becomes a segmented control in the card body — see below.
- A **form** parameter becomes a form in the card body — see below.
- **Multi-select** becomes a list you can pick several from; the value is sent comma-joined.
- An **endpoint-backed** parameter becomes a dropdown whose options are fetched. Any static options it also declares are ignored; the endpoint is authoritative.
- **Static options** become a plain dropdown.
- `date` becomes a date picker, `number` a number field, `boolean` a checkbox that sends the strings `true` or `false`.
- Everything else, including a parameter with no declared type, becomes a text field.

Each control shows its label beside it and carries the parameter's description as its tooltip. Before the label sits the control's group link — see *Parameter groups* below.

## Defaults and the default ticker

A new card starts from whatever defaults the widget declares. The one token the app resolves is `$currentDate`, which becomes today's date in your own time zone. A date control shows today but keeps storing the token until you edit it; the first edit replaces it with a literal date permanently, and re-picking today deliberately does not count as an edit. Suffixed forms like `$currentDate-7d` are not supported and are sent verbatim.

**Settings ▸ General ▸ Default widget ticker** is used when you add a widget that takes a `symbol`. Directly under it, *Match the symbol on the dashboard to which you are adding the widget.* — when that is on it wins, and the new card copies the symbol from the most recently added sibling card on the same tab that has one, falling back to the default ticker only when there is none.

If a required parameter is empty the card does not fetch at all, and says so: *Enter Commodity, Year, Month to load this widget.*

## Cascading parameters

An endpoint-backed dropdown fetches its options from the values the card is currently showing, so a cascade happens live, as soon as you change it. Change **Chamber** and the **Committee** list refills immediately; if the committee you were holding is not in the new list it is cleared, and the cleared value is written along with the change.

While a list is loading the dropdown is disabled and keeps showing its current value rather than going blank. A stored value that is not in the fetched list is shown as its own extra option rather than snapping silently to the first entry. If the options request fails, the control falls back to a plain text field — committing on leave or **Enter**, like any typed field — with the error as its tooltip in place of the description. Option lists are cached for as long as the app is running, so a backend whose choice lists change needs a restart to show them.

## Parameter groups

A group ties one control on several cards together, so changing the symbol on one card moves every card in the group. At this version groups are made in the app, not only imported.

Every control carries a small chain-link button (`⛓`) before its label. Press it to open the **Groups** menu for that control:

- **+ New group** creates a group from the control's current value — what is on screen, even half-typed — and puts this control in it. Groups are named `Group 1`, `Group 2` and so on, taking the first unused number. The link becomes a numbered badge.
- Each existing group of a compatible kind is listed with its number, name and value. Tick one to join it — the control immediately shows the group's value — and untick the ticked one to leave. A control is in one group or none, and a card joins a given group through at most one of its controls, so a group this card already holds through another control is not offered.

Escape or a click elsewhere closes the menu.

Two controls are compatible when they are the same kind of thing: two `symbol` parameters, two date pickers whatever they are named, or any two the widget labels with the same group type. Once grouped, editing any member moves every member on that dashboard in one write, and the group's value wins over whatever each card held. Leaving a group keeps the value the control was showing. The numbered badge's tooltip names the group, *— shared across grouped cards*.

The tab strip lists every group on the dashboard as a chip — number, name, value. Double-click the name to rename it; `✕` deletes the group after a confirmation reading *Delete group "Group 1"? Its 2 cards keep their current values.*, and each member keeps the value it had. See [[dashboard-tabs|Dashboard Tabs]].

Groups are per dashboard and never reach across to another. To switch them off for one dashboard, right-click its rail row and tick **Disable grouping** — the groups are kept, not deleted, every link greys out with the tooltip *Grouping is off for this dashboard*, and the tab strip shows a `grouping off` tag while it is on.

In a viewer window the chips cannot be renamed or deleted, and joining, leaving or creating a group from the menu does nothing; the refusal is written to the log.

A file imported from OpenBB Workspace arrives with its groups already made — see [[importing-dashboards|Importing Dashboards]]. The built-in **Parameter echo** card exists to try groups on; see [[built-in-widgets|Built-in Widgets]].

## Tabs and forms in the card body

A **tabs** parameter is drawn as a segmented control at the top of the card body rather than in the header row. Choosing a tab commits immediately, through the ordinary parameter path, so grouping and persistence apply exactly as they would from the header.

A **form** parameter is drawn in the card body too. Its fields can be text, number, date, dropdown or multi-select, plus one or more buttons, and each field carries the same group link as a header control. Typed fields commit when you leave them, everything else on change — but **a field edit on its own never triggers a fetch**; a form is a request you assemble and then send. (A field shared with a parameter group is the exception: editing it moves the group, and every member card refetches.) The submit button's label is whatever the backend named it; on a successful submit the card refetches, and on anything else an error line appears above the buttons.

## Parameters set from elsewhere

Three other things write a card's parameters through the same path as the header's controls, so grouping and persistence apply to them too: a click on a table cell whose column is set up to drive a parameter (see [[tables|Tables]]); a framed page asking its card to change a parameter (see [[html-and-iframe-widgets|HTML and iframe Widgets]]); and a run-button card, which records the edit but waits for **Run** (see [[running-and-refreshing|Running and Refreshing]]).

---
*Source: BDOBB v3.1.0 in-app manual, "Card parameters"; `BDOBB` `src/components/ParamControls.tsx`, `GroupLink.tsx`, `GroupMenu.tsx`, `TabBar.tsx` and `src/lib/paramGroups.ts`, carried onto `v3.1.0` from the `v5.1.0` titlebar-parameter-groups design; `docs/superpowers/specs/2026-09-14-v5.1.0-parameter-groups-design.md`.*
*See also: [[widget-cards|Widget Cards]] · [[running-and-refreshing|Running and Refreshing]] · [[dashboard-tabs|Dashboard Tabs]] · [[importing-dashboards|Importing Dashboards]] · [[tables|Tables]]*

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v3.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
