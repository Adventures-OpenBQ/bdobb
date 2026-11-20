# News sentiment calendar example

From this directory, start the fictional CompanyNews server with Python 3.

```sh
python3 serve.py
```

In BDOBB desktop, add an OpenBB-compatible connection to `http://127.0.0.1:17912`. Under **My Dashboards → Import apps.json…**, open the [example workspace](../v9-next-news-sentiment-calendar.apps.json). The companion connection provides the example's widget ID and five fictional articles for CANOPY.US. Keep it running while using the workspace. The example needs no subscription or credentials.

- The calendar starts at the latest acquired date and shows up to its trailing 12 calendar months. Its colors use a fixed polarity domain from −1 to +1. The delivered page has five articles and four scores. November 15, 2026 has a neutral score of zero. November 17 has one unscored article. November 16 is a gap in the delivered view.
- Hover or tap November 18 to see the original publication timestamp `2026-11-19T00:30:00+01:00` and polarity `0.123456789`. UTC places the article on November 18. It counts once for Canopy even though the article mentions two instruments. **Calendar day details** exposes each date's delivered and scored counts and the original values on that day.
- Choose **Pinned dates**, enter dates within the acquisition, and select **Apply chart settings**. The card narrows the calendar without requesting another page. Change the source table's query when acquiring a different page from a live connection. The example server supports the one documented page.
- **Save… → BDOBB Workspace** keeps the linked source and applied question. On a new page, import the workspace with the companion connection available. The table acquires the page again. A pinned window outside the newly acquired date extent needs repair.

To exercise refusal, restart the example server with `python3 serve.py --without-evidence` and refresh the source table. The articles remain available in the table and the chart asks for verified acquisition evidence.

A live source requires the paired EODHD CompanyNews adapter and an entitled connection. The namespaced route is `/api/v1/eodhd/news/company`. The shared route is `/api/v1/news/company` with `provider=eodhd`. Use a qualified `symbol`, `chart_source=true`, date bounds and page parameters as needed, and a widget selecting `results`. The card reports the delivered query and retrieval scope. The result describes the delivered page after the presentation filters.
