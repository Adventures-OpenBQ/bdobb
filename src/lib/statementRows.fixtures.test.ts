// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { STATEMENT_FIXTURES } from "./statementModel/fixtures/load";
import { NOT_MONEY } from "./statementModel/vocabulary";
import { statementRows } from "./statementRows";
import { OTHER_SECTION } from "./statementTaxonomy";

/**
 * The quick Statement view over what Libre Terminal and openbq-yfinance really
 * served: every recording is recognised, and nothing a statement reports is
 * left under Other except the ratios that are not statement lines.
 */
describe("statementRows over recorded statements", () => {
  it.each(STATEMENT_FIXTURES.map((f) => [f.name, f] as const))("%s", (name, fixture) => {
    const out = statementRows(fixture.rows);
    expect(out, "recognised as a statement").not.toBeNull();
    expect(out!.statement).toBe(name.includes("-income-") ? "income" : name.includes("-balance-") ? "balance" : "cash");
    const other = out!.sections.find((s) => s.name === OTHER_SECTION)?.items.map((i) => i.field) ?? [];
    expect(other.filter((f) => !NOT_MONEY.has(f))).toEqual([]);
  });

  it("gives per-share lines their own section, after Profit", () => {
    const out = statementRows(STATEMENT_FIXTURES.find((f) => f.name === "libre/aapl-yfinance-income-annual")!.rows)!;
    const names = out.sections.map((s) => s.name);
    expect(names.indexOf("Per share")).toBe(names.indexOf("Profit") + 1);
    expect(out.sections.find((s) => s.name === "Per share")!.items.map((i) => i.field)).toContain("diluted_earnings_per_share");
  });
});
