// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseArgs, USAGE } from "./help-shots.mjs";

describe("help-shots parseArgs", () => {
  it("defaults to every shot in both themes", () => {
    expect(parseArgs([])).toEqual({ only: null, theme: null, help: false });
  });

  it("reads --only and --theme", () => {
    expect(parseArgs(["--only", "tables", "--theme", "dark"])).toEqual({
      only: "tables",
      theme: "dark",
      help: false,
    });
  });

  it("rejects an unknown argument", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });

  it("rejects a theme that is neither light nor dark", () => {
    expect(() => parseArgs(["--theme", "sepia"])).toThrow(/light or dark/);
  });

  // `--only` with nothing after it used to fall through to `?? null`, which is
  // the value that means "every shot" -- so a typo took all twenty-four shots
  // instead of failing.
  it("rejects --only with no value", () => {
    expect(() => parseArgs(["--only"])).toThrow(/--only needs a value/);
  });

  it("rejects --only followed by another flag", () => {
    expect(() => parseArgs(["--only", "--theme", "dark"])).toThrow(/--only needs a value/);
  });

  it("rejects --theme with no value", () => {
    expect(() => parseArgs(["--theme"])).toThrow(/--theme needs a value/);
  });

  it("asks for usage on --help", () => {
    expect(parseArgs(["--help"])).toEqual({ only: null, theme: null, help: true });
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("has a usage string naming every flag", () => {
    for (const flag of ["--only", "--theme", "--help"]) {
      expect(USAGE).toContain(flag);
    }
  });
});
