// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { fillRowTemplate } from "./rowTemplate";

describe("fillRowTemplate", () => {
  it("replaces each {field} with the row's value", () => {
    expect(fillRowTemplate("Analyze **{company}**: ${revenue}M, {growth_rate}%", { company: "ACME", revenue: 12, growth_rate: 3.5 })).toBe(
      "Analyze **ACME**: $12M, 3.5%",
    );
  });

  it("leaves an unknown field literal, so a manifest typo shows in the message", () => {
    expect(fillRowTemplate("Hi {compnay}", { company: "ACME" })).toBe("Hi {compnay}");
  });

  it("renders null and undefined as empty, and never reads the prototype", () => {
    expect(fillRowTemplate("[{a}][{b}][{constructor}]", { a: null, b: undefined })).toBe("[][][{constructor}]");
  });
});
