# Synthetic v5 Statement example

From this directory, run `python3 -m http.server 17905 --bind 127.0.0.1`. Add an OpenBB-compatible connection to `http://127.0.0.1:17905`, validate it and open **V5 Statement Example** through Apps. Use another unused loopback port if needed; keep the fixture server local.

The manifest contains a v5 Statement overlay on a v3-compatible ordinary table. The fixture is synthetic: Q3 operating cash flow 12 and capital expenditure -5; TTM 33 and -18. Verify the supplied Q3/TTM headers, fold Investing and export JSON. The exported line-item rows must still include Capital Expenditure -18 under FY2026 TTM. Return to Table and confirm the original two rows.

To exercise Workspaces, create a second dashboard with a Markdown note, make a Laptop workspace, assign both dashboards and switch their tabs independently. Save an arrangement, restart, reopen the workspace and verify its slots and saved tabs. Workspaces/layouts are local documents; this apps.json does not export their arrangement.
