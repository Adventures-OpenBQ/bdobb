# Calendar View

![Calendar presentation of available price rows](./shots/calendar-view.png)

A table with a date column can offer **Calendar** in the card's **View** control. It arranges the card's rows by date and never changes the provider's data. For a widget that declares `start_date` and `end_date`, the paging modes (Paged, Vertical and Horizontal) set those two parameters to the window you navigate to, refetch, and save that window with the card; **Static** draws the widget's own range and leaves the parameters alone, so a relative range such as `T-6w` to `T` keeps moving. A widget without those parameters shows only the rows it already returned.

Use the toolbar to choose static, vertical, horizontal or paged navigation, the day/week/month unit and list or timeline cells. Date and title field choices correct a guessed column. Business weekdays narrow the displayed days; series and Source → Release → Statistic filters narrow visible events. A cursor is a civil date, so changing the computer's timezone does not move it to another day.

Navigation and filters save with the card. A **BDOBB Workspace** save preserves those choices; a **Strict OpenBB Workspace** save does not preserve the Calendar presentation. Empty dates can reflect missing provider rows; verify the table and request range before treating a blank day as proof that no event occurred.

Trading-session calculations belong to date expressions and exchange calendars. Calendar presentation and exchange-session resolution are separate controls; selecting a Calendar view does not make an endpoint return only trading days.

![Calendar view with dated events and navigation controls](./shots/calendar-view.png)

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v8.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
