// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { TEXT_SUM_REFUSAL } from "./textSumRefusal";

it.each([
  "Region is a text column and cannot be summed.",
  "The sum aggregation is not available for this text column.",
  'Region is a text field, so it has no "sum" aggregation.',
  "Adding text strings isn't a valid aggregation; this sum was declined.",
])("recognizes an explicit refusal: %s", reply => {
  expect(reply.toLowerCase()).toMatch(TEXT_SUM_REFUSAL);
});

it.each([
  "I summed the Region column.",
  "The sum aggregation is available for this text column.",
  "I counted the Region names instead.",
  "Nothing was changed.",
])("does not accept an affirmative, substitution or empty response: %s", reply => {
  expect(reply.toLowerCase()).not.toMatch(TEXT_SUM_REFUSAL);
});
