---
type: Note
tags: [bdobb, help, integrations, temporaldb, explorer, queries]
---

# TemporalDB Explorer

A connected TemporalDB serves a second widget beside the query widget: the **TemporalDB explorer**. Its card shows the connection, the dataset and tier you last chose, and the title of the query you are building. **Open explorer** opens a dialog in three panes: the catalog, the builder and the inspector. The catalog and inspector read only TemporalDB's accepted cache. Nothing in the explorer asks a provider for new data.

## Catalog

The catalog lists TemporalDB's datasets 50 at a time, grouped by source (`eodhd`, `fred`, `yfinance`). **Load more** fetches the next page. A dataset shows a **Cached** badge when anything for it has been accepted. It also has one chip per tier (bronze, silver and gold); tiers holding accepted data are drawn solid. Choosing a chip selects that dataset and tier. *Search loaded datasets…* filters only the pages already loaded.

## Inspector

**Schema** describes the chosen dataset at the chosen tier:

- its request parameters;
- the observed schema and its basis, which is the columns of the last completed result when there is one;
- the declared schema's basis;
- the temporal axes and the knowledge bases.

A dataset with nothing accepted at that tier cannot be described, and the inspector says so.

The **Column profile** lists the observed columns. Before a run it says *Not profiled. Run a saved revision to profile this page.* After a **Run**, it profiles the first page of that run: present and missing values, distinct values (shown as **1,000+** past a thousand), the range of number and date columns, up to five samples, a date column's period, and cells that do not fit the column's type. It is exact over that preview page only, not over the accepted cache.

**Coverage** lists the captured identities 50 at a time, optionally filtered by one `symbol` or `series_id`, with the clock basis behind each timestamp. **Load coverage** fetches the first page; **Load more** fetches the next. Completeness is shown exactly as TemporalDB returns it, which today is always `unknown`: request bounds are not effective coverage. Gold has no identity coverage, and the inspector says so.

## Building a query

The builder has two modes, **Dataset** and **SQL**. Both produce a TemporalDB query definition, shown read-only as JSON under the actions.

- **Dataset** queries the chosen dataset.
  - Its request fields come from the inspector's parameters and use the same typed fields as the query library. Date fields take relative dates such as `T-1bd`. A relative date is resolved when you save, and stays an expression on a query widget you open from it.
  - **Expect the observed schema** pins the result's columns as the query's schema expectation. It is unavailable when the dataset has a column type TemporalDB cannot check (such as a large string or a null column); such a query runs without a schema expectation.
  - A dataset that publishes no request fields (FRED today) is queried in SQL mode.
- **SQL** runs one read-only DuckDB `SELECT` over the sources you add with **Add as source** in the catalog.
  - Each source becomes an alias. The default alias is its endpoint name (`eod`, `series_observations`), and you can rename it.
  - Parameters are declared by name and type and written `$name` in the SQL. Every declared parameter must be used, and every `$name` must be declared.
  - **Max rows** is 1 to 10,000 (default 10,000), and **Timeout (seconds)** is 1 to 30 (default 30).
  - The schema expectation is taken from the first successful **Run**. If that result has a type TemporalDB cannot check, the query keeps no schema expectation.

Both modes share the query widget's temporal context bar (**Mode**, **Known at**, **Effective at**, **Basis**). **Apply context** sets it for the query.

## Actions

- **Validate** asks TemporalDB to check the definition without saving or running it.
- **Save to library** saves a new shared query. Once it is saved, each further save is a new revision of it.
- **Run** executes the saved revision through the same path as the query widget, and previews the first rows with the execution receipt.
- **Open as query widget** adds a query widget bound to the saved query on this tab. It is fixed to the saved revision unless **Follow latest revision** is checked (see [[temporaldb-queries|TemporalDB Shared Queries]]).

TemporalDB's errors appear with their message and request ID. An unauthorized reply clears every TemporalDB result, as it does for the query widget. In a viewer window or on a locked card you can browse, inspect and validate. **Save to library**, **Run** and **Open as query widget** are disabled there, and the explorer keeps nothing.

The card keeps the chosen dataset, the tier and the builder draft, so a saved dashboard reopens the explorer where you left it.
