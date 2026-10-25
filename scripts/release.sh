#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

# Cut a release locally, signed and notarized. Retrofitted onto the 7.0.0
# line (the episode the Apple Developer membership arrived in) and carried
# forward: it replaces .github/workflows/release.yml, which was dropped when
# GitHub stopped starting jobs.
#
#   pnpm release v7.0.0                       # the tag must already point at HEAD
#   BDOBB_RELEASE_DRY_RUN=1 pnpm release v7.0.0   # build, sign, notarize, verify; publish nothing
#
# The tag must exist and point at the checkout being built, so the artifact
# and the tag can never disagree about which commit they came from. An
# existing release for the tag gets the rebuilt files uploaded in place (that
# is how a moved tag gets its rebuilt dmg).
#
# Signing: Tauri reads APPLE_CERTIFICATE (base64 .p12), APPLE_CERTIFICATE_PASSWORD
# and APPLE_SIGNING_IDENTITY itself -- it imports the .p12 into a throwaway
# keychain and signs the .app with hardened runtime -- and with APPLE_ID,
# APPLE_PASSWORD (an app-specific password) and APPLE_TEAM_ID it notarizes and
# staples the .app. It does NOT notarize the dmg, and the quarantine flag lands
# on the dmg, so this script submits the dmg itself and staples it. The six
# values live one per file under ~/.apple-signing/secrets/ and are exported
# here; `tauri build` skips signing SILENTLY when they are missing, so their
# presence is checked before the build, not discovered after.
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: pnpm release vX.Y.Z"; exit 2; }

PKG=$(node -p "require('./package.json').version")
if [ "$TAG" != "v$PKG" ]; then
  echo "tag $TAG does not match package.json version $PKG."
  echo "Bump the version files and re-tag, or tag the commit that has v$PKG."
  exit 1
fi
if [ "$(git rev-parse "$TAG^{commit}" 2>/dev/null)" != "$(git rev-parse HEAD)" ]; then
  echo "tag $TAG does not point at HEAD ($(git rev-parse --short HEAD)); check out the tag first."
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "the working tree is not clean; a release builds a commit, not a draft."
  exit 1
fi

SECRETS="${APPLE_SIGNING_DIR:-$HOME/.apple-signing}/secrets"
for v in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [ -z "${!v:-}" ]; then
    [ -s "$SECRETS/$v" ] || { echo "missing signing value: $SECRETS/$v (see the apple-developer-id-signing note)"; exit 1; }
    val=$(cat "$SECRETS/$v") || { echo "cannot read $SECRETS/$v"; exit 1; }
    export "$v=$val"
  fi
done
if [ "${BDOBB_RELEASE_DRY_RUN:-}" != "1" ]; then
  gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated; the release cannot be published. Run gh auth login, or set BDOBB_RELEASE_DRY_RUN=1."; exit 1; }
fi
echo "building $TAG from $(git rev-parse --short HEAD), signing as $APPLE_SIGNING_IDENTITY"

pnpm typecheck
pnpm test:run
bash scripts/scrub-check.sh

pnpm tauri:build

APP=$(ls -d src-tauri/target/release/bundle/macos/*.app)
# This version's dmg only: tauri never clears the bundle dir, so a dmg left by
# an earlier version's build also matched `*.dmg`, DMG became two paths, and
# notarization failed. Exactly one match, or stop before anything is submitted.
DMGS=(src-tauri/target/release/bundle/dmg/*_"$PKG"_*.dmg)
if [ "${#DMGS[@]}" -ne 1 ] || [ ! -f "${DMGS[0]}" ]; then
  echo "expected exactly one dmg for $PKG in src-tauri/target/release/bundle/dmg, found: ${DMGS[*]}"
  exit 1
fi
DMG=${DMGS[0]}

# The password goes on the command line: notarytool has no @env:/@keychain:
# reader (that is altool syntax; it returns HTTP 401 here, verified
# 2026-09-09), and Tauri already hands the same value to its own .app
# notarization the same way. Single-user machine; a keychain profile would
# be the alternative if that ever changes.
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait --timeout 30m
xcrun stapler staple "$DMG"

# The checks that fail if any of the above silently did nothing: the .app's
# signature holds, the ticket is attached to the dmg, and Gatekeeper accepts
# the dmg for the reason we want (a notarized Developer ID), not a weaker one.
codesign --verify --deep --strict --verbose=2 "$APP"
xcrun stapler validate "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

(cd "$(dirname "$DMG")" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256")

if [ "${BDOBB_RELEASE_DRY_RUN:-}" = "1" ]; then
  echo "dry run: built, signed, notarized and verified $DMG; nothing published."
  exit 0
fi

NOTES=$(mktemp)
trap 'rm -f "$NOTES"' EXIT
cat > "$NOTES" <<'EOF'
### Installing

The dmg is signed with a Developer ID certificate and notarized, so it opens
without a Gatekeeper prompt. Apple Silicon only. Verify the download against
the `.sha256` beside it.

---
EOF

# The tag on origin must be this commit, or absent. The script never forces a
# tag: moving one is a deliberate act done outside the release, and a release
# attached to a stale remote tag would break the invariant above. A failed
# push stops the script here (set -e), before anything is published.
REMOTE_TAG=$(git ls-remote origin "refs/tags/$TAG^{}" "refs/tags/$TAG" | tail -1 | cut -f1)
if [ -z "$REMOTE_TAG" ]; then
  git push origin "refs/tags/$TAG"
elif [ "$REMOTE_TAG" != "$(git rev-parse HEAD)" ]; then
  echo "origin's $TAG points at ${REMOTE_TAG:0:7}, not HEAD; move the tag first (git push --force origin refs/tags/$TAG)."
  exit 1
fi
# An existing release keeps its page and gets the rebuilt files in place.
# Never delete-then-create: a create that failed after the delete would leave
# the tag with no release at all.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "updating the existing release for $TAG"
  gh release upload "$TAG" "$DMG" "$DMG.sha256" --clobber
else
  # --verify-tag: without it gh would create a missing tag from the default
  # branch's HEAD instead of failing.
  gh release create "$TAG" "$DMG" "$DMG.sha256" \
    --verify-tag \
    --title "$TAG" \
    --notes-file "$NOTES" \
    --generate-notes
fi
echo "released $TAG: $DMG"
