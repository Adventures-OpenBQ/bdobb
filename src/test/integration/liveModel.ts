// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// RITA_LIVE_MODEL picks the model for every live turn (Rita's `model` feature); unset, Rita uses its default.
export const liveWorkspaceOptions = process.env.RITA_LIVE_MODEL ? { model: process.env.RITA_LIVE_MODEL } : undefined;
