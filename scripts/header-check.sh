#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

# Refuses a tracked source file without the house copyright and SPDX header in
# its first five lines (below a shebang or doctype is fine). Third-party,
# vendored or generated files that keep their own notice are listed, one path
# prefix per line, in scripts/header-exempt.txt. Data and docs are not source
# and are not checked.
set -uo pipefail

cd "$(dirname "$0")/.."

OWNER='Copyright 2026 SecretoftheUniverse.com LLC'
SPDX='SPDX-License-Identifier: AGPL-3.0-only'
EXEMPT_FILE="scripts/header-exempt.txt"

exempt=()
if [ -f "$EXEMPT_FILE" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] || exempt+=("$line")
  done < "$EXEMPT_FILE"
fi

missing=()
while IFS= read -r -d '' file; do
  for prefix in ${exempt[@]+"${exempt[@]}"}; do
    [[ "$file" == "$prefix"* ]] && continue 2
  done
  head=$(head -n 5 -- "$file")
  if [[ "$head" != *"$OWNER"* || "$head" != *"$SPDX"* ]]; then
    missing+=("$file")
  fi
done < <(git ls-files -z -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.rs' '*.css' '*.sh' '*.py' '*.html')

if [ "${#missing[@]}" -gt 0 ]; then
  printf '%s\n' "${missing[@]}" >&2
  echo "header-check: FAILED — the files above lack the house copyright header." >&2
  exit 1
fi
echo "header-check: clean"
