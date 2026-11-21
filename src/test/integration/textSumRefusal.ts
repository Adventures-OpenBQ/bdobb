// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
/** Refusal language only. The live gate separately requires text/sum context,
 * unchanged engine state, no substitute execution and provenance for numbers.
 */
export const TEXT_SUM_REFUSAL = /cannot|can't|can not|unable|not (?:possible|supported|available|numeric|summ)|isn't (?:possible|supported|numeric)|(?:do|does)(?: not|n't) (?:support|make sense)|can only be|\b(?:has|have) no ["'“”]?sum["'“”]? (?:aggregation|operator)\b|\b(?:isn't|is not) (?:a )?valid aggregation\b/;
