# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Run inside the pinned Docker image; mount its matching stack tests in /check."""
import json
import sys
from contextlib import redirect_stdout

sys.path.insert(0, "/check/tests")
with redirect_stdout(sys.stderr):
    from openbb_core.api.rest_api import app
    from openbb_platform_api.utils.widgets import build_json
    from test_next_chart_sources import NextChartSources

    widgets = build_json(app.openapi(), [])
    captured = []
    requests = []

    def record_request(response):
        req = response.request
        requests.append({"method": req.method, "path": req.url.path, "query": req.url.params.multi_items()})

    class Capture(NextChartSources):
        def get(self, route, **params):
            requests.clear()
            body = super().get(route, **params)
            self.assertEqual(len(requests), 1)
            widget = widgets["eodhd_" + route.replace("/", "_") + "_eodhd_obb"]
            captured.append({"widget": widget, "params": params, "request": requests[0], "body": body})
            return body

    Capture.setUpClass()
    Capture.client.event_hooks["response"].append(record_request)
    try:
        for name in ("test_news_page_preserves_legacy_and_exposes_original_day_and_zero_polarity",
                     "test_cached_common_stock_and_etf_use_original_acquisition_and_refuse_legacy_vintage"):
            case = Capture(name)
            try:
                getattr(case, name)()
            finally:
                case.doCleanups()
    finally:
        Capture.doClassCleanups()
print(json.dumps(captured))
