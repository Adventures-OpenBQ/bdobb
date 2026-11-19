# Risk and ETF examples

Open a terminal in this directory and start the fixture server.

```sh
python3 -m http.server 17910 --bind 127.0.0.1
```

In BDOBB desktop, add and validate an OpenBB-compatible connection to `http://127.0.0.1:17910`. Under **My Dashboards**, choose **Import apps.json…** and open the companion manifest. Keep the server running while the dashboard is open. All prices, constituents, sectors and regions are fictional. The example runs locally without provider credentials. [Download the native workspace](../v9-risk-exposure.apps.json)

- **Return distribution** shows seven valid daily returns for ALDER, including two zero returns. Its zero and missing prices each interrupt adjacent returns. Hover a bar to see the interval, count and share of observations. Change **Bins** and choose **Apply chart settings** to redraw.
- **Watchlist panels** starts CEDAR, ALDER and BIRCH at 100 on March 3, their first shared positive observation. March 16 is the last shared endpoint. Drag to zoom a panel, then resize the card to see the panels wrap while keeping the shared scales and selection order.
- **Holdings concentration** ranks the 60 delivered holdings of CANOPY. The first 50 account for 71% of fund assets. All 60 account for 73.2%. The file arrived in full and its provider declares partial holdings coverage. Filter **Fund holdings** by symbol to see the chart report the number of acquired rows that reach it.
- **Equity exposure** opens on five sectors, including Utilities at 0%. Set **Exposure mode** to **Region** and apply. The chart explains that its source supplies sector observations. Use the chart’s **Card menu → Choose source**, select **Region weights**, and confirm. Set **Exposure category** to **country**, check **Region**, and apply. Scroll within the plot to find Willow Cape at 0%. Hover a marker to see its reported fraction of equity exposure as a percentage.

**Save… → BDOBB Workspace** preserves the chart settings and links. On another machine, connect to this fixture server before importing the saved workspace. The tables fetch their snapshots again when the dashboard opens.
