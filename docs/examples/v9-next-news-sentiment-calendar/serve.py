# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import json


ROOT = Path(__file__).resolve().parent
NEWS_PATH = "/api/v1/eodhd/news/company"
PAGE = json.loads((ROOT / NEWS_PATH.lstrip("/")).read_text(encoding="utf-8"))
FIXTURE_QUERY = {
    "symbol": ["CANOPY.US"],
    "start_date": ["2025-11-19"],
    "end_date": ["2026-11-19"],
    "limit": ["10"],
    "offset": ["0"],
}


class FixtureHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        if url.path != NEWS_PATH:
            return super().do_GET()
        params = parse_qs(url.query, keep_blank_values=True)
        chart_source = params.pop("chart_source", [])
        if params != FIXTURE_QUERY:
            self.send_error(400, "Use the symbol, date bounds and page specified in the fixture workspace.")
            return
        payload = PAGE if chart_source == ["true"] and not self.without_evidence else {"results": PAGE["results"]}
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = ArgumentParser(description="Serve the fictional CompanyNews calendar page.")
    parser.add_argument("--without-evidence", action="store_true", help="Deliver the rows without a chart source receipt.")
    FixtureHandler.without_evidence = parser.parse_args().without_evidence

    def handler(*args, **kwargs):
        return FixtureHandler(*args, directory=ROOT, **kwargs)

    with ThreadingHTTPServer(("127.0.0.1", 17912), handler) as server:
        print("CompanyNews calendar fixtures at http://127.0.0.1:17912", flush=True)
        server.serve_forever()
