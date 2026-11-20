# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
"""Exercise the release runner's real Bash setup and EXIT trap with stub binaries."""
import os
from pathlib import Path
import subprocess
import tempfile
import time

runner = Path(__file__).with_name("run-paired-sources.sh").resolve()
scratch_parent = Path.cwd() / "e2e"
if not scratch_parent.is_dir() or scratch_parent.is_symlink():
    raise SystemExit("Run from the BDOBB checkout with its e2e directory.")
with tempfile.TemporaryDirectory(dir=scratch_parent, prefix="paired-guard-") as tmp:
    root = Path(tmp)
    e2e = root / "e2e"
    e2e.mkdir()
    regular = e2e / "paired-sources.json"
    regular.write_text("keep")
    target = root / "target"
    target.write_text("keep")
    link = e2e / "paired-sources.spec.ts"
    link.symlink_to(target)
    for name, command in {
        "docker": "cat >/dev/null; echo '[]'",
        "pnpm": """
set -eu
spec=$4
test -f "$spec"
dir=$(dirname "$spec")
test -f "$dir/paired-sources.json"
touch "$dir/started"
while [ ! -f release ]; do sleep .02; done
exit "${STUB_EXIT:-0}"
""",
    }.items():
        binary = root / name
        binary.write_text("#!/bin/sh\n" + command + "\n")
        binary.chmod(0o700)

    def run(status=0):
        return subprocess.Popen(
            ["bash", str(runner), str(root), "fixture"], cwd=root,
            env={**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"], "STUB_EXIT": str(status)},
        )

    jobs = [run(), run(7)]
    try:
        for _ in range(250):
            if len(list(e2e.glob("*/started"))) == 2:
                break
            time.sleep(.02)
        dirs = [p.parent for p in e2e.glob("*/started")]
        assert len(dirs) == 2 and all(d.stat().st_mode & 0o777 == 0o700 for d in dirs)
    finally:
        (root / "release").touch()
        statuses = [job.wait(timeout=15) for job in jobs]
    assert statuses == [0, 7]
    assert set(e2e.iterdir()) == {regular, link}
    assert regular.read_text() == target.read_text() == "keep" and link.is_symlink()
    e2e.rename(root / "original")
    e2e.symlink_to(root / "original", target_is_directory=True)
    assert run().wait(timeout=10) == 1
    assert set(e2e.iterdir()) == {regular, link}
    print("Passed private parallel directories, success/failure cleanup, prior file/symlink and symlinked parent.")
