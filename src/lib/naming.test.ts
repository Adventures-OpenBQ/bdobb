// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

import { nextUntitledName } from "./naming";

describe("nextUntitledName", () => {
  it("returns Untitled when nothing is named that", () => {
    expect(nextUntitledName([])).toBe("Untitled");
    expect(nextUntitledName(["Main", "Macro"])).toBe("Untitled");
  });

  it("starts numbering at 2 once Untitled is taken", () => {
    expect(nextUntitledName(["Untitled"])).toBe("Untitled 2");
    expect(nextUntitledName(["Untitled", "Untitled 2"])).toBe("Untitled 3");
  });

  it("fills the first gap rather than counting past the highest", () => {
    expect(nextUntitledName(["Untitled", "Untitled 3"])).toBe("Untitled 2");
    expect(nextUntitledName(["Untitled", "Untitled 2", "Untitled 4"])).toBe("Untitled 3");
  });

  it("compares trimmed names", () => {
    expect(nextUntitledName(["  Untitled  "])).toBe("Untitled 2");
  });

  it("compares case-sensitively", () => {
    expect(nextUntitledName(["untitled", "UNTITLED"])).toBe("Untitled");
  });
});
