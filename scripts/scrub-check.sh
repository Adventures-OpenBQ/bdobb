#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

# Refuses to ship private infrastructure details.
# Machine-specific patterns live in scripts/scrub-private-patterns.txt,
# which is gitignored — so the secrets this gate guards against never
# appear in the repo that guards against them.
set -uo pipefail

cd "$(dirname "$0")/.."

PATTERNS=(
  'tskey-[A-Za-z0-9-]{10,}'
  'tail[0-9a-f]{6,}\.ts\.net'
  # A MagicDNS tailnet name (word-word.ts.net). Docs write YOUR-TAILNET, which
  # upper case keeps out of this pattern.
  '[a-z0-9-]+\.[a-z0-9]+-[a-z0-9]+\.ts\.net'
  '100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}'
  '192\.168\.[0-9]{1,3}\.[0-9]{1,3}'
  '/share/Container'
  'AKIA[0-9A-Z]{16}'
  'Basic [A-Za-z0-9+/]{16,}={0,2}'
  # GitHub tokens (classic ghp_/gho_/ghu_/ghs_/ghr_, and fine-grained) and PEM
  # private keys: the credentials this project actually handles besides the
  # tailnet and Basic auth.
  'gh[pousr]_[A-Za-z0-9]{36,}'
  'github_pat_[A-Za-z0-9_]{22,}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # Home directories: a checkout or scratch path in a committed log or plan
  # names the machine's user. Write <worktree>, <scratch> or ~ instead.
  '/Users/[A-Za-z]'
  '/home/[a-z]'
)

CUSTOM_PATTERNS=()
PRIVATE_FILE="scripts/scrub-private-patterns.txt"
if [ -f "$PRIVATE_FILE" ]; then
  while IFS= read -r line; do
    if [[ "$line" =~ [^[:space:]] ]]; then
      PATTERNS+=("$line")
      CUSTOM_PATTERNS+=("$line")
    fi
  done < "$PRIVATE_FILE"
fi

# Each pattern is validated on its own BEFORE they are joined, and a bad one
# is fatal. This is what makes a malformed custom pattern detectable at all:
# in the joined alternation below, one broken regex makes the single scan
# exit 2, and an exit-2 scan matches nothing — the gate would print "clean"
# having checked nothing. Empty input can only exit 1 (no match) or 2 (bad
# regex), so this tests the pattern and not the tree.
pattern_index=0
for pattern in "${PATTERNS[@]}"; do
  pattern_index=$((pattern_index + 1))
  printf '' | grep -qE -- "$pattern" 2>/dev/null
  if [ $? -eq 2 ]; then
    # An operator pattern can itself contain a private literal; report only its ordinal.
    echo "scrub-check: FAILED — malformed pattern at index $pattern_index" >&2
    exit 2
  fi
done

# These exact canonical sources deliberately exercise private-pattern detection.
# Provenance: Adventures-OpenBQ/bdobb 87f5f9bf3c0ed1659ba11eb0650b3ca15ddeb81e.
# Refuse changed bytes or links before filtering their built-in matches; no folder waiver.
python3 - <<'PY_REVIEWED'
import hashlib, os, stat, sys
from pathlib import Path
reviewed = {
    "security/README.md": "84779d07cce204e9a1b78ae531466c7fcaf181fe51aca7d4660aada645fbba57",
    "security/test_gate.py": "ec82c35890000f8d66eac4d7210501b73b30d655e946417f0e5bd151c8a0640a",
    "security/gate.py": "8d12972ea3a32ce5acbd256b61ee20e432b8de8966e5bc09f9b31571563626d6",
    "scripts/test_public_release.py": "e1d6af4a03f9ae2d218e6b25d7590326812de17279b5a54e6f5f2236e339973f",
}
for name, expected in reviewed.items():
    if not os.path.lexists(name):
        continue
    try:
        path = Path(name)
        if any(parent.is_symlink() for parent in path.parents) or not stat.S_ISREG(path.lstat().st_mode):
            raise OSError("not physical regular")
        with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise OSError("not regular")
            actual = hashlib.file_digest(source, "sha256").hexdigest()
    except OSError:
        print(f"scrub-check: FAILED — reviewed fixture is not a regular file: {name}", file=sys.stderr)
        sys.exit(2)
    if actual != expected:
        print(f"scrub-check: FAILED — reviewed fixture changed: {name}", file=sys.stderr)
        sys.exit(2)
PY_REVIEWED
review_status=$?
if [ "$review_status" -ne 0 ]; then exit 2; fi

# One pass, not one per pattern: the patterns are joined into a single ERE
# alternation so the tree is walked once instead of seven-plus times. The
# matching lines stay in memory for line-scoped checks; output contains only
# paths and line numbers, never their private values.
joined="$(IFS='|'; printf '%s' "${PATTERNS[*]}")"

# grep exits 0 (match), 1 (no match) or 2 (error). A malformed pattern can no
# longer reach here — the loop above already refused one — but an unreadable
# file or directory still can, and an errored scan matches nothing: swallowing
# exit 2 would print "clean" having checked part of the tree, or none of it.
# So the scan's own status is captured before anything is piped through it (a
# pipeline reports only its LAST command's status) and 2 is fatal.
scan="$(grep -rEn --binary-files=without-match \
    --exclude-dir=.git \
    --exclude=.git `# A worktree's .git is a file naming its checkout path.` \
    --exclude-dir=.vercel `# Gitignored build-web output: vendored bundles.` \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=target \
    --exclude-dir=.reference-backend \
    --exclude-dir=.superpowers `# Gitignored scratch holding task briefs and review` \
    `# packages — never shipped, only produces local false positives.` \
    --exclude="$(basename "$0")" \
    --exclude="$(basename "$PRIVATE_FILE")" \
    "$joined" .)"
scan_status=$?
if [ "$scan_status" -eq 2 ]; then
  echo "scrub-check: FAILED — the tree scan errored (grep exit 2); nothing here was checked." >&2
  exit 2
fi

# A line carrying the marker below is exempt. This exists for source whose JOB
# is these ranges -- a module that has to name the private blocks it refuses,
# and tests that have to use real addresses. Line-scoped rather than
# file-scoped for ordinary sources. The four canonical sources above additionally
# require exact reviewed bytes; an edited fixture never inherits its exemption.
#
# docs/specs/ is the one path dropped whole: it is the rebuild document set,
# copied verbatim per version (never edited here), and it quotes these
# patterns while documenting the gate. It is filtered by PATH after the scan,
# not with --exclude-dir: that matches a directory NAME anywhere, so
# excluding "specs" also skipped docs/superpowers/specs -- where a real
# tailnet hostname sat unscanned. The design and plan documents under
# docs/superpowers are scanned like everything else; a line there that must
# quote a pattern carries the marker.
matches=""
if [ -n "$scan" ]; then
  matches="$(printf '%s\n' "$scan" | grep -v 'scrub-allow' | grep -v '^\./docs/specs/' | grep -vE '^\./(security/(README\.md|test_gate\.py|gate\.py)|scripts/test_public_release\.py):' || true)"
fi

# The canonical-source pin exempts built-in fixture matches only. Operator
# patterns still inspect all four reviewed files, including marker-bearing lines.
reviewed_existing=()
for file in security/README.md security/test_gate.py security/gate.py scripts/test_public_release.py; do
  if [ -f "$file" ]; then reviewed_existing+=("$file"); fi
done
if [ "${#CUSTOM_PATTERNS[@]}" -gt 0 ] && [ "${#reviewed_existing[@]}" -gt 0 ]; then
  custom_joined="$(IFS='|'; printf '%s' "${CUSTOM_PATTERNS[*]}")"
  custom_scan="$(grep -HnE -- "$custom_joined" "${reviewed_existing[@]}")"
  custom_status=$?
  if [ "$custom_status" -gt 1 ]; then
    echo "scrub-check: FAILED — the operator-pattern scan errored." >&2
    exit 2
  fi
  if [ -n "$custom_scan" ]; then matches="${matches}${matches:+$'\n'}${custom_scan}"; fi
fi

if [ -n "$matches" ]; then
  printf '%s\n' "$matches" | sed -E 's/:([0-9]+):.*/:\1: [redacted]/' >&2
  echo "scrub-check: FAILED — private infrastructure details found above." >&2
  exit 1
fi
echo "scrub-check: clean"
