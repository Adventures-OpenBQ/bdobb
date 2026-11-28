#!/usr/bin/env sh
# Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
# SPDX-License-Identifier: AGPL-3.0-only
set -eu
cd "$(git rev-parse --show-toplevel)"
git config --local core.hooksPath .githooks
