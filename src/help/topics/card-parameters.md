# Card parameters

Most widgets take parameters — a symbol, a date range, a provider. The card's
header carries a row of controls, one per visible parameter, directly under
the title. There is nothing to open: what a card is asking for is always in
view.

![Two cards with their parameter rows](./shots/card-parameters.png)

Some parameters are declared hidden by the backend. They never appear here, but
they are still sent with every request — that is how `provider` rides along on
nearly every widget.

## When a change takes effect

A dropdown, a multi-select and a checkbox take effect the moment you change
them. A text, number or date field takes effect when you leave it or press
Enter, so a half-typed symbol does not refetch the card on every keystroke.
Typing a value and typing it back writes nothing.

A card whose widget declares a **Run** button is the exception: its controls
save what you chose and mark the card stale (a dot beside the title); nothing
is fetched until you press Run.

## The kinds of control

Which control you get is decided in this order:

- A **tabs** parameter with options becomes a segmented control in the card
  body — see below.
- A **form** parameter becomes a form in the card body — see below.
- **Multi-select** becomes a list you can pick several from. The value is sent
  comma-joined, as `a,b`.
- An **endpoint-backed** parameter becomes a dropdown whose options are
  fetched. Any static options it also declares are ignored; the endpoint is
  authoritative.
- **Static options** become a plain dropdown.
- `date` becomes a date picker, `number` a number field, `boolean` a checkbox
  that sends the strings `true` or `false`.
- Everything else, including a parameter with no declared type, becomes a text
  field.

Each control shows its label beside it and carries the parameter's description
as its tooltip.

## Defaults and the default ticker

A new card starts from whatever defaults the widget declares. The one token the
app resolves is `$currentDate`, which becomes today's date in your own time
zone. A date control shows today but keeps storing the token until you edit it;
the first edit replaces it with a literal date permanently, and re-picking
today deliberately does not count as an edit, so it will not burn the token.
Suffixed forms like `$currentDate-7d` are not supported and are sent verbatim.

**Settings ▸ General ▸ Default widget ticker** is used when you add a widget
that takes a `symbol`. Directly under it is a checkbox reading *Match the
symbol on the dashboard to which you are adding the widget.* — when that is on
it wins, and the new card copies the symbol from the most recently added
sibling card on the same tab that has one, falling back to the default ticker
only when there is none.

If a required parameter is empty the card does not fetch at all, and says so:
*Enter Commodity, Year, Month to load this widget.*

## Cascading parameters

An endpoint-backed dropdown fetches its options from the values the card is
currently showing, so a cascade happens live, as soon as you change it. Change
**Chamber** and the **Committee** list refills immediately; if the committee
you were holding is not in the new list it is cleared, and the cleared value is
written along with the change.

While a list is loading the dropdown is disabled and keeps showing its current
value rather than going blank, and a refetch keeps the old list visible. A
stored value that is not in the fetched list is shown as its own extra option
rather than snapping silently to the first entry.

If the options request fails, the control falls back to a plain text field and
the error takes the place of the description. Option lists are cached for as
long as the app is running, so a backend whose choice lists change needs a
restart to show them.

## Parameter groups

Every control carries a small chain-link button before its label. Press it to
open the **Groups** menu for that control:

- **+ New group** creates a group from the control's current value and puts
  this control in it. The link becomes a numbered badge.
- Each existing group of a compatible kind is listed with its number, name
  and value. Tick one to join it — the control immediately shows the group's
  value — and untick it to leave. A control is in one group or none.

Two controls are compatible when they are the same kind of thing: two `symbol`
parameters, two date pickers, or any two the backend labels with the same
group type. Once grouped, editing any member moves every member on that
dashboard in one write; the group's value wins over whatever each card held.
Leaving a group keeps the value the control was showing.

The tab bar lists every group on the dashboard as a chip — number, name,
value. Double-click the name to rename it; ✕ deletes the group after a
confirmation, and each member keeps the value it had.

Groups are per dashboard and never reach across to another. To switch them
off for a dashboard, right-click its rail row and tick **Disable grouping** —
the groups are kept, not deleted, every link greys out, and the tab strip
shows a `grouping off` tag while it is on.

A file imported from OpenBB Workspace arrives with its groups already made;
see Import and export.

## Tabs and forms in the card body

A **tabs** parameter is drawn as a segmented control at the top of the card
body rather than in the header row. Choosing a tab commits immediately,
through the ordinary parameter path, so grouping and persistence apply exactly
as they would from the header. A stored value that is not one of the options
highlights nothing rather than falsely highlighting the first tab.

A **form** parameter is drawn in the card body too. Its fields can be text,
number, date, dropdown or multi-select, plus one or more buttons. Typed fields
commit when you leave them, everything else on change — but **a field edit on
its own never triggers a fetch**. (A field that is *shared* with a parameter
group is the exception: editing it moves the group, and every member card
refetches.) A form is a request you assemble and then send. The submit
button's label is whatever the backend named it; on a successful submit the
card refetches, and on anything else an error line appears above the buttons.

[shot-pending]: #27
