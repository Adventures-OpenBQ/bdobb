# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Verify the installed provider package against a source manifest passed on the CLI."""
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path

pin = json.loads(Path(sys.argv[1]).read_text())
expected = {k: v for k, v in pin["files_sha256"].items() if k.startswith("openbq_eodhd/")}
dist = importlib.metadata.distribution("openbq-eodhd")
package = Path(dist.locate_file("openbq_eodhd"))
actual = {
    path.relative_to(package.parent).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in package.rglob("*") if path.is_file() and "__pycache__" not in path.parts
}
assert expected == actual, {"unexpected": actual.keys() - expected.keys(), "missing": expected.keys() - actual.keys(),
                            "changed": [k for k in actual.keys() & expected.keys() if actual[k] != expected[k]]}
print(f'{len(actual)} exact installed files, version {dist.version}, canonical {pin["commit"]}')
