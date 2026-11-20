# Screening and income examples

Run the companion server with Python 3.

```sh
python3 serve.py
```

In BDOBB desktop, add and validate an OpenBB-compatible connection to `http://127.0.0.1:17911`. Open **My Dashboards → Import apps.json…** and choose the [native workspace](../v9-screening-income.apps.json). The three source tables acquire fictional rows and versioned receipts over the EODHD route shapes. Keep the server running while you use the workspace.

- **Screening bubble** opens on August 31, 2026, with four of seven delivered US listings. The screen was retrieved on November 19, 2026. Dividend yield and market cap are values from that retrieval and can have a different measurement date. Cedar Works has a 4% dividend yield, a 7% five-day price change and a reported market cap of 9,600,000,000 USD. Bubble area represents market cap, with a maximum 48 px diameter. The unweighted line fits the four presented points. Choose August 28 or toggle **Show regression**, then **Apply chart settings**. The fit describes one date cohort from the delivered page after any table filters. Page scope and sample counts are shown in the card.
- **Dividend steps** uses Canopy’s four split-adjusted distributions in GBP per share, with verified inclusive coverage from January 1 through June 30, 2026. Hover the March 17 special distribution for its adjusted 0.375 GBP per share. Its original 1.5 GBP per share is visible in the source table. Filter the source’s frequency to `Quarterly` to see the known March date interrupt the steps. The line ends at the last observed event.
- **Income Sankey** opens on Canopy’s actual FY2026 period ending June 30. The snapshot declares a multiplier of 1000 with USD reporting currency. Revenue of 100 becomes gross profit of 60, operating income of 30, pre-tax income of 25 and net income of 20, all in USD × 1000. Hover the nodes and bands for original values. The derived operating deduction is 30 even though the table also carries a reported aggregate operating expense of 70. Change **Income statement period** to FY2025 and apply to see the other acquired period. Scroll to reach the last node.

Both positive receipts use the fixture’s explicit snapshot evidence. To see the live-route refusal shapes, stop the server and start it with `python3 serve.py --unknown-evidence`. Refresh **Canopy dividends** and **Canopy income statements**. Their tables still show the rows, and the charts explain that coverage and monetary scale require verification. The paired live EODHD routes currently supply unknown dividend coverage and unknown monetary scale for these charts. The examples use fictional data and run without provider credentials.

**Save… → BDOBB Workspace** keeps the applied settings and source links. On another machine, start the companion server and add its connection before importing the saved file. The tables acquire their snapshots again when the dashboard opens.
