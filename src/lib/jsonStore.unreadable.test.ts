// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __failRead, __read, __reset, __restoreRead, __seed } from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import { __resetJsonStoreForTests, loadJson, saveJson } from "./jsonStore";

type Thing = { id: string };
const isThing = (v: unknown): v is Thing =>
  typeof v === "object" && v !== null && typeof (v as Thing).id === "string";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

/**
 * An unreadable file says nothing about its content (see readValidated), so
 * the loader fails and the app runs on its in-memory defaults -- "still
 * usable", the startup banner says. Every store then writes WHOLE files from
 * memory: the first save after such a failure would replace a perfectly good
 * settings.json, backends.json, folders.json or chat.json with defaults. The
 * guard sits here, once, so no store can forget it.
 */
describe("a file whose read failed is never overwritten", () => {
  it("refuses to save over a file that could not be read this session", async () => {
    __seed("settings.json", JSON.stringify({ id: "good" }));
    __failRead("settings.json");
    await expect(loadJson("settings.json", isThing)).rejects.toThrow();

    await expect(saveJson("settings.json", { id: "defaults" })).rejects.toThrow(/settings\.json/);
    expect(__read("settings.json")).toBe(JSON.stringify({ id: "good" }));
  });

  it("saves again once a later read of the file succeeds", async () => {
    __seed("settings.json", JSON.stringify({ id: "good" }));
    __failRead("settings.json");
    await expect(loadJson("settings.json", isThing)).rejects.toThrow();

    __restoreRead("settings.json");
    expect(await loadJson("settings.json", isThing)).toEqual({ id: "good" });
    await saveJson("settings.json", { id: "next" });
    expect(JSON.parse(__read("settings.json") ?? "null")).toEqual({ id: "next" });
  });

  it("guards only the path that failed", async () => {
    __seed("settings.json", JSON.stringify({ id: "good" }));
    __failRead("settings.json");
    await expect(loadJson("settings.json", isThing)).rejects.toThrow();

    await saveJson("folders.json", { id: "f" });
    expect(JSON.parse(__read("folders.json") ?? "null")).toEqual({ id: "f" });
  });
});
