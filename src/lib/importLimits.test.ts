// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { IMPORT_MAX_BYTES, IMPORT_MAX_DASHBOARDS, importRefusal } from "./importLimits";

const MB = 1024 * 1024;

describe("importRefusal", () => {
  it("accepts a file of exactly the byte limit", () => {
    expect(importRefusal(IMPORT_MAX_BYTES)).toBeNull();
  });

  it("refuses one byte over the limit, rounding the figure up to one decimal", () => {
    expect(importRefusal(IMPORT_MAX_BYTES + 1)).not.toBeNull();
    expect(importRefusal(IMPORT_MAX_BYTES + 1)).toContain("10.1 MB");
  });

  it("names the size and the limit, in whole megabytes", () => {
    expect(importRefusal(43 * MB)).toBe("File is 43 MB; the limit is 10 MB.");
  });

  it("accepts exactly the dashboard limit", () => {
    expect(importRefusal(0, IMPORT_MAX_DASHBOARDS)).toBeNull();
  });

  it("refuses one dashboard over the limit", () => {
    expect(importRefusal(0, IMPORT_MAX_DASHBOARDS + 1)).toBe(
      "File holds 501 dashboards; the limit is 500.",
    );
  });

  it("names the count and the limit", () => {
    expect(importRefusal(0, 812)).toBe("File holds 812 dashboards; the limit is 500.");
  });

  it("reports the size first when the file is over both limits", () => {
    expect(importRefusal(43 * MB, 812)).toBe("File is 43 MB; the limit is 10 MB.");
  });

  it("checks only the size when no count is supplied yet", () => {
    // The pre-parse call cannot know the count; omitting it must not be read
    // as "zero dashboards" or as a refusal.
    expect(importRefusal(MB)).toBeNull();
  });
});
