#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Build-time gate: the demo image must not serve POST /omni-python-widget.

Run from the app directory after the patches. Imports the real app and checks
that the route, the widgets.json entry and any exec() call are all gone; exits
non-zero (failing `docker build`) otherwise.

The route check sends a body-less POST straight into the ASGI app, in process —
nothing goes over the network. A served route rejects the missing body (422)
before its handler runs; a removed one answers 404/405.
"""
import asyncio
import pathlib
import sys

sys.path.insert(0, ".")
from main import app  # noqa: E402
from core import WIDGETS  # noqa: E402

WIDGET_ID = "omni-python-widget"


async def post_status(path: str) -> int:
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": path, "raw_path": path.encode(),
        "root_path": "", "query_string": b"", "headers": [(b"host", b"localhost")],
        "client": ("127.0.0.1", 0), "server": ("localhost", 80),
    }
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


problems = []

status = asyncio.run(post_status(f"/{WIDGET_ID}"))
if status not in (404, 405):
    problems.append(f"POST /{WIDGET_ID} answered {status}, expected 404/405")
if WIDGET_ID in WIDGETS:
    problems.append(f"{WIDGET_ID} is in widgets.json")
for py in sorted(pathlib.Path(".").glob("*.py")):
    if "exec(" in py.read_text():
        problems.append(f"{py} calls exec(")

if problems:
    raise SystemExit("check-no-exec: FAILED\n  " + "\n  ".join(problems))
print(f"check-no-exec: POST /{WIDGET_ID} -> {status}, not in widgets.json, no exec( in the app")
