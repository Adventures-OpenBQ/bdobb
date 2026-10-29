// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { parseDeepLink, parseWebLink } from "./links";

const ID = "0b5d6f3e-1c2a-4b7e-9a0d-3e2f1a0b9c8d";
describe("links (B12)", () => {
  it("parses the two deep-link forms, lower-casing the UUID", () => {
    expect(parseDeepLink(`bdobb://inbox/${ID}`)).toEqual({ kind: "inbox", id: ID });
    expect(parseDeepLink(`bdobb://chart/${ID.toUpperCase()}`)).toEqual({ kind: "chart", id: ID });
  });
  it.each([
    `bdobb://inbox/${ID}/delete`, `bdobb://inbox/${ID}?x=1`, `bdobb://inbox/${ID}#x`, `bdobb://watch/${ID}`,
    `bdobb://inbox/not-a-uuid`, `bdobb://inbox/`, `https://inbox/${ID}`, `bdobb://user@inbox/${ID}`, `bdobb://inbox/%2e%2e`, "",
  ])("rejects %s", (raw) => expect(parseDeepLink(raw)).toBeNull());
  it("parses the web query only in its exact one-key form", () => {
    expect(parseWebLink(`?inbox=${ID}`)).toEqual({ kind: "inbox", id: ID });
    expect(parseWebLink(`?chart=${ID}`)).toEqual({ kind: "chart", id: ID });
    for (const s of [`?inbox=${ID}&chart=${ID}`, `?inbox=${ID}&x=1`, "?inbox=", `?viewer=${ID}`, ""]) expect(parseWebLink(s)).toBeNull();
  });
});
