// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { DEFAULT_FUNCTION_ROUNDS, MAX_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS, normalizeFunctionRounds } from "./limits";

it("keeps v6.2.1's proven 40-round default and only tightens", () => {
  expect([DEFAULT_FUNCTION_ROUNDS, MIN_FUNCTION_ROUNDS, MAX_FUNCTION_ROUNDS]).toEqual([40, 1, 40]);
  expect(normalizeFunctionRounds(undefined)).toBe(40);
  expect(normalizeFunctionRounds("12")).toBe(40);
  expect(normalizeFunctionRounds(0)).toBe(1);
  expect(normalizeFunctionRounds(99)).toBe(40);
  expect(normalizeFunctionRounds(7.6)).toBe(8);
});
