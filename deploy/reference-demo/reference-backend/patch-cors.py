#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Make the reference backend's hard-coded CORS list env-driven.

Upstream core.py pins:

    origins = ["https://pro.openbb.co", "https://pro.openbb.dev", "http://localhost:1420"]

We replace that line with one that also appends anything in EXTRA_CORS_ORIGINS
(comma-separated) at process start, so the same image serves the demo frontend
without forking the source. Fails loudly if upstream changes the line, so a
silent CORS regression can't ship.
"""
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
src = path.read_text()

needle = 'origins = ["https://pro.openbb.co", "https://pro.openbb.dev", "http://localhost:1420"]'
replacement = (
    "import os as _os  # patched: env-driven CORS\n"
    'origins = ["https://pro.openbb.co", "https://pro.openbb.dev", "http://localhost:1420"]'
    ' + [o.strip() for o in _os.environ.get("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()]'
)

if needle not in src:
    raise SystemExit(
        f"patch-cors: the CORS origins line was not found in {path}; "
        "upstream changed — update the needle in patch-cors.py"
    )

path.write_text(src.replace(needle, replacement, 1))
print(f"patch-cors: EXTRA_CORS_ORIGINS wired into {path}")
