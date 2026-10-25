#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# usage: only-headers.sh <base>
# Every modified tracked file must equal its content at <base> once house header
# lines are removed from both and runs of blank lines (and a doctype line break)
# are collapsed: only header comments and blank lines may differ. package.json's diff is printed for reading. New files are listed.
B=$1
python3 - "$B" <<'PY'
import re, subprocess, sys
base = sys.argv[1]
names = subprocess.run(["git", "diff", "--name-only", "--diff-filter=M", base], capture_output=True, text=True, check=True).stdout.split()
H = re.compile(r"^(//|#|/\*|<!--) (Copyright 2026 SecretoftheUniverse\.com LLC\. Licensed under the Apache License, Version 2\.0\.|SPDX-License-Identifier: Apache-2\.0)( \*/| -->)?\n", re.M)
bad = 0
for name in names:
    if name == "package.json":
        print(subprocess.run(["git", "diff", base, "--", name], capture_output=True, text=True).stdout); continue
    old = subprocess.run(["git", "show", f"{base}:{name}"], capture_output=True, text=True, check=True).stdout
    new = open(name, encoding="utf-8").read()
    norm = lambda t: re.sub(r"\n{2,}", "\n", re.sub(r"(?i)^(<!doctype html>)\n", r"\1", H.sub("", t))).strip("\n")
    if norm(old) != norm(new):
        print("NON-HEADER CHANGE:", name); bad = 1
print(f"{len(names)} modified files checked; non-header changes: {bad}")
sys.exit(bad)
PY
rc=$?
echo "new files:"; git diff --name-only --diff-filter=A "$B"; git ls-files --others --exclude-standard
exit $rc
