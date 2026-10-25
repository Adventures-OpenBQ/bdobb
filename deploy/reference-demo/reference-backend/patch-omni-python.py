#!/usr/bin/env python3
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Strip the Python Chart omni widget out of the public demo image.

Upstream widgets_omni_sql_python.py serves POST /omni-python-widget, which runs
`exec(prompt, {"go": go})` on the request body. The `{"go": go}` namespace is not
a sandbox: builtins are reachable, so any caller gets code execution in the
container. Fine on 127.0.0.1 for local development; not on a public, keyless
Funnel. This removes the handler (its @register_widget and @router.post
decorators go with it, so neither /widgets.json nor the route carry it) and its
DEFAULT_PYTHON_CODE, and drops the widget from apps.json's layouts. The Basic and
SQL omni widgets stay.

Usage: patch-omni-python.py <widgets_omni_sql_python.py> <apps.json>

Fails loudly if upstream moves the handler, so the build can't ship it silently.
"""
import ast
import json
import pathlib
import sys

WIDGET_ID = "omni-python-widget"
HANDLER = "get_omni_python_widget"
DEFAULT_CODE = "DEFAULT_PYTHON_CODE"

widgets_path = pathlib.Path(sys.argv[1])
apps_path = pathlib.Path(sys.argv[2])

src = widgets_path.read_text()
tree = ast.parse(src)

spans = []
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == HANDLER:
        start = min([d.lineno for d in node.decorator_list] + [node.lineno])
        spans.append((start, node.end_lineno))
    elif isinstance(node, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id == DEFAULT_CODE for t in node.targets
    ):
        spans.append((node.lineno, node.end_lineno))

if len(spans) != 2:
    raise SystemExit(
        f"patch-omni-python: expected {HANDLER} and {DEFAULT_CODE} in {widgets_path}, "
        f"found {len(spans)} of them; upstream changed — update patch-omni-python.py"
    )

lines = src.splitlines(keepends=True)
for start, end in sorted(spans, reverse=True):
    del lines[start - 1:end]
patched = "".join(lines)

ast.parse(patched)  # still valid Python
if WIDGET_ID in patched or "exec(" in patched:
    raise SystemExit(f"patch-omni-python: {WIDGET_ID} or exec( still present in {widgets_path}")
widgets_path.write_text(patched)

apps = json.loads(apps_path.read_text())


def drop_widget(value):
    if isinstance(value, dict):
        return {k: drop_widget(v) for k, v in value.items()}
    if isinstance(value, list):
        return [
            drop_widget(v) for v in value
            if not (isinstance(v, dict) and v.get("i") == WIDGET_ID)
        ]
    return value


apps = drop_widget(apps)
if WIDGET_ID in json.dumps(apps):
    raise SystemExit(f"patch-omni-python: {WIDGET_ID} still referenced in {apps_path}")
apps_path.write_text(json.dumps(apps, indent=2) + "\n")

print(f"patch-omni-python: {WIDGET_ID} removed from {widgets_path} and {apps_path}")
