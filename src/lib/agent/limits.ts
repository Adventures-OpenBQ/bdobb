// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** a5229ea59's mechanics with clean v6 bounds: the default keeps v6.2.1's #326 behaviour; the setting only tightens. */
export const DEFAULT_FUNCTION_ROUNDS = 40;
export const MIN_FUNCTION_ROUNDS = 1;
export const MAX_FUNCTION_ROUNDS = 40;

/** Shared by settings load/save and the executor; never permit an unbounded run. */
export function normalizeFunctionRounds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_FUNCTION_ROUNDS;
  return Math.min(MAX_FUNCTION_ROUNDS, Math.max(MIN_FUNCTION_ROUNDS, Math.round(value)));
}
