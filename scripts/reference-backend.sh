#!/usr/bin/env bash
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only

# OpenBB's own reference backend, as a one-command local test environment.
#
# No account, no API key, no tailnet: this is the public repo OpenBB published
# so a client can be developed against the spec's own implementation rather
# than against its author's private deployment. OpenBB has since archived it,
# and its sample PDFs lived on an S3 bucket that now refuses all access, so
# REPO is bdobb-dev's fork: upstream plus the two fixes it can no longer take
# (uvicorn[standard] for the Live Grid websocket, PDFs linked from GitHub).
#
#   pnpm reference-backend                     # clone if needed, then serve
#   PORT=7890 pnpm reference-backend           # somewhere else
#   REF_BACKEND_REF=<sha> pnpm reference-backend   # pin the checkout
#
# Delete .reference-backend/ to start over; it is gitignored.
set -euo pipefail

REPO="https://github.com/bdobb-dev/backends-for-openbb"
# Resolved with bash's own expansion rather than dirname, so that the refusal
# paths below can be tested with a PATH holding nothing but the stubs.
SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
if [ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ]; then SCRIPT_DIR="."; fi
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CHECKOUT="$ROOT/.reference-backend"
APP_DIR="$CHECKOUT/getting-started/reference-backend"
VENV="$APP_DIR/.venv"
PORT="${PORT:-7779}"
REF="${REF_BACKEND_REF:-}"

die() { echo "reference-backend: $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required but was not found on PATH."
command -v python3 >/dev/null 2>&1 || die "python3 (3.10+) is required but was not found on PATH."

# 3.10 is the floor the backend's own dependencies impose.
python3 - <<'PY' || die "python3 is older than 3.10; the reference backend needs 3.10 or newer."
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY

# Checked BEFORE launching. uvicorn's own bind failure is a traceback inside
# its startup log, which reads as a successful start from out here -- the
# server exits and every request then fails with no explanation.
#
# The probe is bash's own /dev/tcp rather than a python socket, so that it is
# still the thing being tested when python3 is a stub on a stripped PATH. Two
# consequences of connecting rather than binding: it opens and immediately
# closes a real connection to whatever holds the port, and on a bash built
# without net redirections the subshell fails and the port reads as free --
# degrading to exactly the open-and-fail this check exists to prevent.
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  die "port $PORT is already in use. Stop what is on it, or run PORT=<n> pnpm reference-backend."
fi

# A checkout cloned from another origin (OpenBB's archived repo, before REPO
# moved to the fork) is never updated by the blocks below, so it is replaced.
if [ -d "$APP_DIR" ] && [ "$(git -C "$CHECKOUT" remote get-url origin 2>/dev/null)" != "$REPO" ]; then
  echo "reference-backend: .reference-backend/ is not a clone of $REPO; re-cloning"
  rm -rf "$CHECKOUT"
fi

if [ ! -d "$APP_DIR" ]; then
  echo "reference-backend: cloning $REPO into .reference-backend/ (first run only)"
  rm -rf "$CHECKOUT"
  if [ -n "$REF" ]; then
    # A pin needs history to check out, so no --depth 1 here.
    git clone --quiet "$REPO" "$CHECKOUT" || die "clone failed."
    git -C "$CHECKOUT" checkout --quiet "$REF" || die "could not check out REF_BACKEND_REF=$REF."
  else
    git clone --quiet --depth 1 "$REPO" "$CHECKOUT" || die "clone failed."
  fi
  [ -d "$APP_DIR" ] || die "clone succeeded but $APP_DIR is missing; upstream layout changed."
elif [ -n "$REF" ]; then
  # The checkout already exists, so the clone block above did not run and the
  # pin would otherwise be silently ignored -- serving whatever was cloned
  # first to the one person trying to reproduce a CI failure locally. A
  # shallow first clone has no history to move within, so this re-fetches.
  if [ "$(git -C "$CHECKOUT" rev-parse HEAD 2>/dev/null)" != "$REF" ]; then
    echo "reference-backend: moving .reference-backend/ to REF_BACKEND_REF=$REF"
    git -C "$CHECKOUT" fetch --quiet origin "$REF" 2>/dev/null || git -C "$CHECKOUT" fetch --quiet --unshallow 2>/dev/null || true
    git -C "$CHECKOUT" checkout --quiet "$REF" ||
      die "could not check out REF_BACKEND_REF=$REF. Delete .reference-backend/ and run again."
  fi
fi

# The venv is (re)built when it is absent OR incomplete: an interrupted first
# run otherwise leaves a directory that exists and cannot serve. `websockets`
# is checked too: the fork's requirements install uvicorn[standard], which
# brings it (bare uvicorn answers every /live_grid_ws upgrade with 404), and a
# venv built from OpenBB's requirements lacks it -- so such a venv is rebuilt.
if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -c "import fastapi, uvicorn, websockets" >/dev/null 2>&1; then
  echo "reference-backend: creating the virtualenv and installing requirements (~40s, first run only)"
  python3 -m venv "$VENV" || die "could not create the virtualenv at $VENV."
  "$VENV/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
  "$VENV/bin/pip" install --quiet -r "$APP_DIR/requirements.txt" || die "pip install failed."
fi

echo "reference-backend: serving http://127.0.0.1:$PORT (widgets at /widgets.json, apps at /apps.json)"
cd "$APP_DIR"
exec "$VENV/bin/uvicorn" main:app --host 127.0.0.1 --port "$PORT"
