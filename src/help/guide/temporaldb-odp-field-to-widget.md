---
type: Note
tags: [bdobb, help, integrations, temporaldb, queries, odp, widgets]
---

# From an ODP Field to a Widget

This page takes one field you know from an ODP provider model, such as the daily `close` from EODHD, and ends with a widget on a dashboard that shows it from TemporalDB. It uses [[temporaldb-explorer|the TemporalDB Explorer]] to build the query and [[temporaldb-queries|the query widget]] to show it. Read those two pages for what each button does; this page is the route between them.

## 1. Find the field's name in TemporalDB

TemporalDB does not keep provider field names. Its normalizer renames them, so the column you query is often not the name you know. The common cases:

| Dataset | ODP field | TemporalDB column |
| --- | --- | --- |
| `eodhd.eod` | `date` | `effective_from` |
| `eodhd.eod` | `open`, `high`, `low`, `close` | `raw_open`, `raw_high`, `raw_low`, `raw_close` |
| `eodhd.eod` | `adjusted_close`, `volume` | `adjusted_close`, `volume` |
| `eodhd.splits` | `split` | `numerator`, `denominator`, `ratio` |
| `eodhd.div` | `value`, `currency` | `amount`, `currency` |
| `eodhd.fundamentals` | a statement line, such as `totalRevenue` | one row per line: `statement`, `metric`, `value` |

Yahoo daily price datasets use the same price columns as `eodhd.eod`. Yahoo statement lines are renamed to the EODHD metric names where one exists (`Net Income` becomes `netIncome`, `Total Revenue` becomes `totalRevenue`); any other line is kept as `yahoo:<label>`.

Three things differ from an ODP result:

- **The ticker is not a column.** A price row carries `listing_id`, a UUID. You choose the ticker with the dataset's `symbol` request field.
- **A statement is long, not wide.** Each line of a statement is its own row, named in `metric`. To see revenue you filter on `metric`, you do not select a `totalRevenue` column.
- **Numbers are exact strings.** A close is stored as `"100"`, not `100`. Table cards show them as they are; in SQL, write `CAST(raw_close AS DOUBLE)` before doing arithmetic.

To confirm a name, select the dataset at the silver tier in the explorer and read **Schema** in the inspector. It lists the observed columns, and it is the authority when this table and the inspector disagree.

Not every ODP model can be queried. A model that TemporalDB does not capture is absent from the catalog. A dataset that is retained raw only is in the catalog at bronze and has no columns to query. A dataset with nothing accepted yet has no **Cached** badge and cannot be described.

## 2. Build the query

This example shows daily closes for one ticker.

1. On the **TemporalDB explorer** card, choose **Open explorer**.
2. In the catalog, find `eodhd.eod` and choose its silver chip.
3. In the builder, keep **Dataset** mode. Fill in the request fields: `symbol` (for example `AAPL.US`), `from` and `to`. Date fields accept relative dates such as `T-1bd`.
4. Tick **Expect the observed schema** if you want the query to fail when its columns change.
5. Choose **Validate**. TemporalDB checks the definition without saving or running it.
6. Choose **Save to library**.

## 3. Run it and check the result

Choose **Run**. The builder previews the first rows with the execution receipt, and the inspector's **Column profile** fills in. Check that `raw_close` is present and that the dates cover what you asked for. If rows you expected are missing, use **Coverage** in the inspector to see which identities have been captured.

## 4. Open it as a widget

Choose **Open as query widget**. A query widget bound to the saved query appears on the current tab. From there:

- **Open as table widget** puts the result in an ordinary table card, so you can choose columns, pivot, chart, link other widgets to it and export.
- **Pin this execution** fixes the card to this result. Use it when the number must not change. Leave it unpinned when the card should stay current.
- **Follow latest revision** makes the card pick up later saves of the query. Without it the card stays on the revision you opened.

## When you need SQL

Use **SQL** mode to compute a value, rename a column or join two datasets. Choose **Add as source** on each dataset in the catalog, then write one `SELECT` over the aliases:

```sql
SELECT effective_from AS day, CAST(raw_close AS DOUBLE) AS close
FROM eod
WHERE listing_id = $listing
ORDER BY day
```

Declare `listing` as a string parameter. A SQL source has no `symbol` field to filter on, so take the `listing_id` from the rows of the Dataset query above. FRED publishes no request fields, so a FRED series is always queried in SQL mode, by `series_id`.

## With Rita

With the TemporalDB MCP server added in [[ai-library|the AI Library]], Rita can do steps 1 to 3 for you. Ask for what you want in ODP terms, for example "save a query for AAPL daily closes from EODHD". Rita can list and describe datasets, check coverage, validate a definition, save it to the shared library and run the saved revision on cached data, at most 100 rows a page.

Rita does not bind the query to a card. To finish, add a query widget, choose **Open query library**, find the query Rita saved and choose **Select**.
