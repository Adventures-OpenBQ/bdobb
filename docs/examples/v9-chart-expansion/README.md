# Financial chart examples

From this directory, run `python3 -m http.server 17909 --bind 127.0.0.1`. In BDOBB desktop, add an OpenBB-compatible connection to `http://127.0.0.1:17909` and validate the connection. Under **My Dashboards**, choose **Import apps.json…** and open [v9-chart-expansion.apps.json](../v9-chart-expansion.apps.json). Keep the fixture server running while using the example. The four source tables and seven linked cards use fictional data and require no provider key.

The daily price and Treasury files declare their acquired dates in an explicit bounded snapshot. The earnings file includes a withheld quarter and the income file contains two fiscal years. Scroll down to the source tables to filter rows or open the income table’s **Pivot → Saved → Statement template** editor. On a linked chart, use **Apply chart settings** to save bindings and symbol choices. **Save… → BDOBB Workspace** retains links and settings. On another machine, connect to the fixture directory before opening that export.

For a refusal example, serve a separate copy of this directory, change the price snapshot’s completeness from `bounded` to `paged` and refresh **Daily adjusted prices**. The history charts explain why the delivered rows cannot support the calculation. Refresh from the original fixture to restore them.
