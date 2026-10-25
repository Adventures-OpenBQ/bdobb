// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { CATALOGUE, type CatalogueEntry } from "../lib/calendars/catalogue";
import page from "./guide/date-expression.md?raw";
import guideParams from "./guide/card-parameters.md?raw";
import topicParams from "./topics/card-parameters.md?raw";

/** One row of the guide's calendar table, from one catalogue entry. */
function row(e: CatalogueEntry): string {
  const suffixes = [...new Set([...e.suffixes.eodhd, ...e.suffixes.yahoo])].sort().map((s) => "`." + s + "`");
  return `| \`${e.mic}\` | ${e.name} | ${suffixes.join(", ") || "—"} | ${e.bounds.start} to ${e.bounds.end} |`;
}

describe("the guide's calendar list (spec: the Help list matches the catalogue)", () => {
  it("is the catalogue, row for row", () => {
    expect(page.split("\n").filter((line) => line.startsWith("| `"))).toEqual(CATALOGUE.map(row));
  });

  it("no longer says there are nine", () => {
    expect(page).not.toMatch(/`XTAE` and `XTAI`/);
    expect(guideParams).not.toMatch(/nine/);
    expect(topicParams).not.toMatch(/`XTAE` and `XTAI`/);
  });
});

describe("the Help states the behaviours the catalogue brings", () => {

  it("names the overnight convention and the five overnight calendars", () => {
    expect(page).toContain("`T@open(CMES)`");
    expect(page).toContain("Sunday at 17:00 Chicago");
    expect(page).toContain("which for `24/5` and `24/7` is the date the session opens");
    expect(guideParams).toContain("never uses this route for the five overnight calendars");
    for (const id of CATALOGUE.filter((e) => e.overnight).map((e) => e.mic)) expect(guideParams).toContain(`\`${id}\``);
  });

  it("states each calendar whose coverage ends before 2040", () => {
    for (const e of CATALOGUE.filter((c) => c.bounds.end < "2040-12-31")) expect(page).toContain(`\`${e.mic}\``);
    expect(page).toContain("2026-12-31");
    expect(page).toContain("2029-12-31");
    expect(page).toMatch(/needs no calendar[^.]*still sent/);
  });

  it("describes the searchable menu", () => {
    expect(guideParams).toContain("with a search box that filters the list as you type");
    expect(guideParams).toContain("clearing it restores the full list");
  });

  it("says the ambiguous .NX suffix and the unmapped suffixes infer nothing", () => {
    expect(page).toContain("`.NX`");
    expect(page).toContain("and infer nothing");
    expect(page).toContain("is ambiguous across Amsterdam, Brussels, Dublin, Lisbon and Paris");
    expect(page).toContain("the unmapped suffixes (");
    expect(page).toContain("A symbol carrying one is treated like an unsuffixed symbol.");
  });
});
