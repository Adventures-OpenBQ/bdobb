// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

/** One statement table for every relabel path's tests (user ruling 2026-10-15: all get relabelled). */
export const STATEMENT_CSV = "symbol,period_ending,fiscal_period,fiscal_year,revenue\nWMT,2026-07-31,Q2,2026,1\nWMT,2026-01-31,FY,2026,2\nJPM,2026-06-30,Q2,2026,3\n";
export const STATEMENT_YEAR_ENDS: Record<string, number | null> = { WMT: 1, JPM: 12 };
/** [fiscal_period, fiscal_year] per row once relabelled. */
export const STATEMENT_LABELS = [["FQ2", "FY2027"], ["FY", "FY2026"], ["Q2", "2026"]];
