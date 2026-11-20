# KPI cards and gauges

The KPI cards open with Parameters closed. Use **Show parameters** on each linked metric to choose its source or edit the saved settings.

Open [KPI fixtures](../v9-next-kpi-gauges.apps.json) as a BDOBB Workspace. Drop [fictional-observations.json](fictional-observations.json) to acquire the fictional data as a local table. On each linked metric, use **Choose source** to replace the empty **KPI snapshot source** with the dropped table. The six saved presets use the original numeric fields in the file.

The cards cover last price, market capitalization, trailing dividend yield, trailing P/E, trailing diluted EPS and trailing revenue. The EPS gauge has a labeled user range of 0 to 8 USD per share. Its two acquired vintages report the same actual TTM period, reporting standard and diluted basis, with original values of 4.546 and 4.2 USD per share. Open **KPI details** or hover or tap the gauge value to inspect the source values and dates. The displayed fraction of 0.428% comes from an acquired value of 0.00428.

To save portable settings, first relink the metrics to the empty **KPI snapshot source** and remove the dropped table. An attached file triggers the standard `MISSING_LOCAL_ASSET` export refusal. After importing the settings, drop the file again and explicitly relink each metric. If a saved pin is unavailable, reacquire it or select an available observation and apply. Refresh uses the selected source and can only follow vintages supplied by that acquisition.

## Paired EODHD acquisition

For US primary common stock, the opt-in KeyMetrics and FinancialRatios table routes can verify the issuer-reported trailing dividend-yield fraction and trailing P/E multiple. Set `chart_source=true` on the source and configure the table to select `results`. Set `provider=eodhd` on the shared route. The headline response has unknown measurement dates, exact periods, class and adjustment basis. Acquired-reference comparisons require separate compatible observations. The paired live sources still lack qualified proof for last price, market capitalization, trailing diluted EPS and trailing revenue. The example supplies explicit fictional observations for all six presets.
