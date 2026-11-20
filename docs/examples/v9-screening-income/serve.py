# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class FixtureHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        translated = Path(super().translate_path(path))
        if self.unknown_evidence and translated.name in {"dividends", "income"}:
            translated = translated.with_name(translated.name + "-unknown")
        return str(translated)

    def guess_type(self, path):
        # The fixture routes keep the real EODHD paths, which have no suffix.
        return super().guess_type(path) if Path(path).suffix else "application/json"


if __name__ == "__main__":
    parser = ArgumentParser(description="Serve the fictional screening and income snapshots.")
    parser.add_argument("--unknown-evidence", action="store_true", help="Serve unknown dividend coverage and income scale.")
    FixtureHandler.unknown_evidence = parser.parse_args().unknown_evidence

    def handler(*args, **kwargs):
        return FixtureHandler(*args, directory=Path(__file__).resolve().parent, **kwargs)

    with ThreadingHTTPServer(("127.0.0.1", 17911), handler) as server:
        print("Screening and income fixtures at http://127.0.0.1:17911", flush=True)
        server.serve_forever()
