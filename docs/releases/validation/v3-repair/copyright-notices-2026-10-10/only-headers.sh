#!/bin/bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Apache License, Version 2.0.
# SPDX-License-Identifier: Apache-2.0

# usage: only-headers.sh <base>  — every modified tracked file gains only header/blank lines; lists new files.
B=$1; bad=0
for f in $(git diff --name-only --diff-filter=M $B); do
  [ "$f" = package.json ] && { git diff $B -- package.json | grep '^[-+] ' ; continue; }
  other=$(git diff -U0 $B -- "$f" | grep -E '^[-+]' | grep -vE '^(\+\+\+|---)' | grep -vE '^\+\s*$' | grep -vE '^\+(//|#|/\*|<!--) (Copyright 2026 SecretoftheUniverse\.com LLC\. Licensed under the Apache License, Version 2\.0\.|SPDX-License-Identifier: Apache-2\.0)( \*/| -->)?$')
  [ -n "$other" ] && { echo "NON-HEADER CHANGE in $f:"; echo "$other"; bad=1; }
done
echo "new files:"; git diff --name-only --diff-filter=A $B; git ls-files --others --exclude-standard
exit $bad
