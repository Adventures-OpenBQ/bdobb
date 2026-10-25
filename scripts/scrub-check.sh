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
  # Not after a host or path character, so a URL path segment
  # (https://example.eu/home/...) is not a home directory.
  '(^|[^A-Za-z0-9._-])/Users/[A-Za-z]'
  '(^|[^A-Za-z0-9._-])/home/[a-z]'
)

PRIVATE_FILE="scripts/scrub-private-patterns.txt"
if [ -f "$PRIVATE_FILE" ]; then
  while IFS= read -r line; do
    [[ "$line" =~ [^[:space:]] ]] && PATTERNS+=("$line")
  done < "$PRIVATE_FILE"
fi

# Each pattern is validated on its own BEFORE they are joined, and a bad one
# is fatal. This is what makes a malformed custom pattern detectable at all:
# in the joined alternation below, one broken regex makes the single scan
# exit 2, and an exit-2 scan matches nothing — the gate would print "clean"
# having checked nothing. Empty input can only exit 1 (no match) or 2 (bad
# regex), so this tests the pattern and not the tree.
for pattern in "${PATTERNS[@]}"; do
  printf '' | grep -qE -- "$pattern"
  if [ $? -eq 2 ]; then
    # The offending pattern is echoed by name: it comes from the gitignored
    # private file, so the author cannot see it in the repo, and "one of your
    # patterns is broken" would be unactionable.
    echo "scrub-check: FAILED — malformed pattern: $pattern" >&2
    exit 2
  fi
done

# One pass, not one per pattern: the patterns are joined into a single ERE
# alternation so the tree is walked once instead of seven-plus times. The
# failure output is the matching LINES, which is the actionable part; the
# name of the individual pattern that matched is not reported any more.
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
    `# .env, .env.local and .env.*.local are gitignored and can never be` \
    `# committed — a gate that fails on a file nobody can ship trains` \
    `# people to stop reading it. .env.example stays scanned: it IS` \
    `# committed, and it is the one of these that could actually leak.` \
    --exclude=".env" \
    --exclude=".env.local" \
    --exclude=".env.*.local" \
    "$joined" .)"
scan_status=$?
if [ "$scan_status" -eq 2 ]; then
  echo "scrub-check: FAILED — the tree scan errored (grep exit 2); nothing here was checked." >&2
  exit 2
fi

# A line carrying the marker below is exempt. This exists for source whose JOB
# is these ranges -- a module that has to name the private blocks it refuses,
# and tests that have to use real addresses. Line-scoped rather than
# file-scoped on purpose: every file stays scanned, and each exemption is a
# visible, deliberate act rather than a blanket hole a real secret could later
# hide in.
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
  matches="$(printf '%s\n' "$scan" | grep -v 'scrub-allow' | grep -v '^\./docs/specs/' || true)"
fi

if [ -n "$matches" ]; then
  echo "$matches" >&2
  echo "scrub-check: FAILED — private infrastructure details found above." >&2
  exit 1
fi
echo "scrub-check: clean"
