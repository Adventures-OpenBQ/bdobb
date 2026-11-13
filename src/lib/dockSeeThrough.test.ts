// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { makeDefaultDocks } from "./dashboardsFile";
import { readDockSeeThrough, withDockSeeThrough } from "./dockSeeThrough";

describe("the see-through switch's data (v8 locked widgets)", () => {
  it("reads only true, per edge, and nothing at all as absent", () => {
    expect(readDockSeeThrough(undefined)).toBeUndefined();
    expect(readDockSeeThrough(null)).toBeUndefined();
    expect(readDockSeeThrough("yes")).toBeUndefined();
    expect(readDockSeeThrough({})).toBeUndefined();
    expect(readDockSeeThrough({ top: false, bottom: 1, middle: true })).toBeUndefined();
    expect(readDockSeeThrough({ bottom: true })).toEqual({ bottom: true });
    expect(readDockSeeThrough({ top: true, bottom: true, middle: true })).toEqual({ top: true, bottom: true });
  });

  it("sets one edge, and drops the field once no edge is on", () => {
    const docks = makeDefaultDocks();
    const on = withDockSeeThrough(docks, "bottom", true);
    expect(on.dockSeeThrough).toEqual({ bottom: true });
    expect(withDockSeeThrough(on, "top", true).dockSeeThrough).toEqual({ top: true, bottom: true });
    const off = withDockSeeThrough(on, "bottom", false);
    expect(off).not.toHaveProperty("dockSeeThrough");
    expect(off).toEqual(docks);
  });
});
