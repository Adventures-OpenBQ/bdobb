# Statement View

**Statement** presents financial rows as line items grouped into sections, with a column for each fiscal period supplied by the data. Choose it in a supported table card's **View** control. Local and linked tables can offer the view; backend tables offer it when their rows contain recognized statement fields.

![Cash-flow line items with quarterly and TTM columns](./shots/statement-view.png)

The rows need recognized financial fields such as revenue, total assets or net cash from operating activities. Period headers use the row's fiscal year and period, or its date. On a backend statement widget, one whose **Period** offers FY and FQ, the card first relabels each row from the reporting company's fiscal year end, asked of the card's backend per symbol as the **FY ends** lookup is. The Statement's headers read a January filer's quarter ending July 2026 as `FY2027-Q2`, a December filer's quarter ending June 2026 as `FY2026-Q2`, an annual row as `FY2026` and a trailing-twelve-month row as `FY2026-TTM`; the rows' own `fiscal_period` and `fiscal_year` are rewritten to match (`FQ2` and `FY2027` for the January filer, `Q2` and `2026` for the December one). The Table, Statement, charts and exports all read the relabelled rows. A yfinance statement, whose long rows carry only a `date` column, is relabelled from that date. When the year end is unknown, a period date cannot be read, or several symbols share rows with no symbol column, the rows stay as the provider sent them and the card says *Fiscal labels as reported*. When the rows hold more than one company, every company is kept and each column is prefixed with its symbol, as `AAPL FY2025` and `MSFT FY2025`; one company's columns carry no prefix. A server table whose source is a statement widget is relabelled the same way on the server, when the source is fetched, and says *Fiscal labels as reported* when it cannot be. A local CSV/XLS table is relabelled too, from each row's own `fiscal_period` (FY, Q1–Q4 or FQ1–FQ4, TTM) and `symbol`: the card asks the backend chosen under **FY ends from**, which appears beside the note. With no backend chosen, or a reporter the backend cannot answer for, the rows stay as the file has them and the card says *Fiscal labels as reported*. Linked tables, charts, export and Rita read the same relabelled rows, and Rita's own fetch of a backend statement widget is relabelled the same way. Missing cells stay blank and zero stays zero. The view does not invent totals.

Click a section heading to collapse or reopen it. Those folds save with the card. Switch back to **Table** to inspect the ordinary rows; Statement does not replace the analytical Pivot model. Filters, search and selected table scope affect the worker rows used for the Statement. Review the underlying Table if those choices hide a needed period or financial field.

The view reads a completed worker result. During refresh it can retain completed data with a stale notice. A plain backend response is read as the provider's whole answer, so it carries no completeness warning (a provider's own cap still shows as its notice); a managed server table still says when its result is partial. A table without recognized numeric line items shows an empty-state explanation.

CSV, JSON and XLSX exports from Statement use the completed line-item projection. Collapsing a section changes visibility, not the exported rows. A **BDOBB Workspace** save (**Save…** on the dashboard row) preserves Statement and its folds using the v5 profile, together with inherited v4 settings. A **Strict OpenBB Workspace** save omits that presentation. BDOBB Workspace saves still do not bundle local-file bytes or credentials.


V4 Statement templates also work in this view. Their worker-calculated fiscal columns, authored section and line labels, order, and cell formats are preserved. The view shows only the producer’s presented or selected lines; it does not fill hidden lines or recalculate totals. A calculation error displays `#ERROR` with its reason on hover and exports as `#ERROR: <reason>`, rather than a numeric value. Template section folds use stable identities, so renaming a section does not reopen it. A template whose fiscal binding names the fiscal year and quarter fields reads the relabelled values; `FY2027` and `2026`, `FQ2` and `Q2` are all accepted.

## Lines, sections and repeats

Sections are filled from one list of line names covering the FMP and EODHD spellings, Yahoo Finance's, and the SEC's. Per-share figures and share counts have a **Per share** section of their own on the income statement. A numeric field the list does not know still shows, under **Other**. Totals and subtotals are drawn in bold.

A provider can report one figure under two names. When a line's figures match an earlier line's in every period shown, the foot of the Statement offers **Hide repeated lines** with their count; the same button shows them again. A total or subtotal is never counted as a repeat. The choice is not saved with the card.

## Several companies on one card

Type several symbols, separated by commas, in a statement card's **Symbol**. A backend that takes the list answers it in one request. One that takes a single symbol per request, as OpenBB's own statement routes do, is asked for each in turn, up to eight; the rows are put together with a `symbol` on each. A symbol that cannot be had is named in the card's notices and the others still show. Each company is relabelled from its own fiscal year end.

## A fiscal year end the backend cannot give

The card asks the backend for each company's fiscal year end. Where the backend has no answer, an annual statement's own closing month is the year end. A quarterly statement asks once for one annual row per company to learn it. If that fails too, the card says *Fiscal labels as reported*.

A relabelled row also carries `period_kind` (`FY` or `FQ`) and the fiscal period's two dates, `period_start` and `period_end`, so an exported row says which period it is.

## A Statement template without mapping by hand

Open **Pivot** on a statement card in Table view, then **Saved → Statement template**. When the rows are relabelled, a new Statement opens already bound: the template for the statement the columns are, the company, the fiscal fields, and one source column for each line whose name it knows. The panel says how many columns it mapped and names any it did not. Calculate a preview and apply, as with any template. Where the fiscal labels are as reported the panel says so and proposes nothing; map by hand as before.

**Layout** chooses what goes across. *Lines down, periods across* is the statement as printed. *Lines down, companies across* puts the companies side by side under each fiscal period, and is read in Table view. Companies are matched by fiscal year, so the card says when one company's year covers different months from another's. Lines always run down: a statement's totals and formulas are worked out along each line.

With several companies and periods across, use **Company Page** in the panel to show one company at a time. Figures from different companies are never added together; a cell that would need to shows `#ERROR`.

---

Copyright © 2026 SecretoftheUniverse.com LLC. Original documentation is separately restricted under the [Documentation Terms](https://github.com/Adventures-OpenBQ/bdobb/blob/v10.0.0/DOCUMENTATION_TERMS.md). Software, code examples, third-party licenses, and previously granted rights are excluded. Full terms are also included in Quick Help’s Getting started and the Reference Manual’s home page.
