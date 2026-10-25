// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { moveBefore } from "./dragDrop";

describe("moveBefore", () => {
  const ids = ["a", "b", "c", "d"];

  it("lands AFTER a target ahead of it, so the last slot is reachable", () => {
    expect(moveBefore(ids, 0, 3)).toEqual(["b", "c", "d", "a"]);
  });

  it("lands BEFORE a target behind it", () => {
    expect(moveBefore(ids, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the order alone when the member is dropped on itself", () => {
    expect(moveBefore(ids, 2, 2)).toEqual(ids);
  });

  it("does not mutate the array it was given", () => {
    moveBefore(ids, 0, 3);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
});
