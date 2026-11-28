// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { STATEMENT_FIXTURES, type StatementFixture } from "./fixtures/load";
import { TAXONOMY } from "./taxonomy";
import { EMPHASIS, NOT_MONEY, UNITS, VOCABULARY, type VocabularyStatement } from "./vocabulary";

const STATEMENTS: VocabularyStatement[] = ["income", "balance", "cashflow"];
const sectionOf = (statement: VocabularyStatement): Map<string, string> =>
  new Map(Object.entries(VOCABULARY[statement]).flatMap(([section, fields]) => fields.map((f) => [f, section] as const)));

/** Which statement a recording is, from its name: `…-income-annual`, `…-cash-quarter`. */
function statementOf(fixture: StatementFixture): VocabularyStatement {
  if (fixture.name.includes("-income-")) return "income";
  if (fixture.name.includes("-balance-")) return "balance";
  return "cashflow";
}

/** The numeric lines a recording carries: wide rows' number columns, or long rows' line items with a number. */
function linesOf(fixture: StatementFixture): string[] {
  const seen = new Set<string>();
  for (const row of fixture.rows) {
    if (typeof row.line_item === "string") {
      if (typeof row.value === "number") seen.add(row.line_item);
      continue;
    }
    for (const [key, value] of Object.entries(row)) if (typeof value === "number" && key !== "fiscal_year") seen.add(key);
  }
  return [...seen];
}

describe("VOCABULARY", () => {
  it.each(STATEMENTS)("%s: no field sits in two sections", (statement) => {
    const all = Object.values(VOCABULARY[statement]).flat();
    expect(all.filter((f, i) => all.indexOf(f) !== i)).toEqual([]);
  });

  it.each(STATEMENTS)("%s: keeps every template 1.0.0 line in its 1.0.0 section", (statement) => {
    const placed = sectionOf(statement);
    for (const [section, fields] of Object.entries(TAXONOMY[statement])) {
      expect(fields.filter((f) => placed.get(f) !== section), `${statement} ${section}`).toEqual([]);
    }
  });

  it.each(STATEMENTS)("%s: keeps template 1.0.0's sections first and in order", (statement) => {
    const v1 = Object.keys(TAXONOMY[statement]);
    expect(Object.keys(VOCABULARY[statement]).slice(0, v1.length)).toEqual(v1);
  });

  it.each(STATEMENT_FIXTURES.map((f) => [f.name, f] as const))("places every line %s carries", (_name, fixture) => {
    const placed = sectionOf(statementOf(fixture));
    expect(linesOf(fixture).filter((f) => !placed.has(f) && !NOT_MONEY.has(f))).toEqual([]);
  });

  it("never places a ratio", () => {
    for (const statement of STATEMENTS) expect([...NOT_MONEY].filter((f) => sectionOf(statement).has(f))).toEqual([]);
  });

  it.each(STATEMENTS)("%s: emphasis and units name placed lines only", (statement) => {
    const placed = sectionOf(statement);
    expect(Object.keys(EMPHASIS[statement]).filter((f) => !placed.has(f))).toEqual([]);
    expect(Object.keys(UNITS[statement]).filter((f) => !placed.has(f))).toEqual([]);
  });

  it("gives every Per share line a unit and no other income line one", () => {
    const perShare = new Set(VOCABULARY.income["Per share"]);
    expect([...perShare].filter((f) => UNITS.income[f] === undefined)).toEqual([]);
    expect(Object.keys(UNITS.income).filter((f) => !perShare.has(f))).toEqual([]);
  });

  it("marks each statement's headline totals", () => {
    expect(EMPHASIS.income.total_revenue).toBe("total");
    expect(EMPHASIS.income.net_income).toBe("total");
    expect(EMPHASIS.balance.total_assets).toBe("total");
    expect(EMPHASIS.cashflow.operating_cash_flow).toBe("total");
    expect(EMPHASIS.income.gross_profit).toBe("subtotal");
  });
});
