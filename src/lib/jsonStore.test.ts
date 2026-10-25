// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import {
  __failPath,
  __failRead,
  __list,
  __read,
  __reset,
  __seed,
  __writes,
} from "../test/memfs";
import { __resetLoggerForTests } from "./logger";
import {
  ABSENT,
  __resetJsonStoreForTests,
  loadJson,
  loadJsonDir,
  removeJson,
  saveJson,
} from "./jsonStore";

type Thing = { id: string };
const isThing = (v: unknown): v is Thing =>
  typeof v === "object" && v !== null && typeof (v as Thing).id === "string";

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
});

describe("loadJson", () => {
  it("returns ABSENT for a file that does not exist", async () => {
    expect(await loadJson("settings.json", isThing)).toBe(ABSENT);
  });

  it("returns the parsed value for a valid file", async () => {
    __seed("thing.json", JSON.stringify({ id: "a" }));
    expect(await loadJson("thing.json", isThing)).toEqual({ id: "a" });
  });
});

describe("an unreadable file is not a corrupt one", () => {
  it("rejects instead of quarantining when only the READ fails", async () => {
    // The distinction this pins: the file's BYTES are fine (it parses, it
    // validates), the process simply cannot read them -- `chmod 000`, a
    // vanished volume, a bad sector. That is an I/O failure, not corruption.
    //
    // With the read inside the quarantine try, this path renamed a perfectly
    // good file to `.corrupt` and returned ABSENT -- so `loadSettings` reseeded
    // defaults and the LOADER SUCCEEDED, and the user's settings were gone.
    //
    // `__failRead`, not `__failPath`: the file must still EXIST and still be
    // renamable, or the assertion proves only that `exists` throws.
    __seed("settings.json", JSON.stringify({ id: "real" }));
    __failRead("settings.json");

    await expect(loadJson("settings.json", isThing)).rejects.toThrow(
      /settings\.json/,
    );
    // Neither renamed away nor reseeded over. Both halves matter: the first is
    // the user's data surviving, the second is the failure staying visible.
    expect(__read("settings.json")).toBe(JSON.stringify({ id: "real" }));
    expect(__list().filter((p) => p.includes(".corrupt"))).toEqual([]);
  });

  it("still quarantines and reports ABSENT when the bytes really are corrupt", async () => {
    // The other half of the same edit: moving the read out must not weaken
    // the parse path. Unreadable rejects; unparseable still quarantines.
    __seed("thing.json", "{ not json");

    expect(await loadJson("thing.json", isThing)).toBe(ABSENT);
    expect(__read("thing.json.corrupt")).toBe("{ not json");
  });
});

describe("quarantine", () => {
  it("quarantines unparseable content and reports ABSENT", async () => {
    __seed("thing.json", "{ not json");
    expect(await loadJson("thing.json", isThing)).toBe(ABSENT);
    expect(__read("thing.json")).toBeUndefined();
    expect(__read("thing.json.corrupt")).toBe("{ not json");
  });

  it("quarantines content that parses but fails its shape check", async () => {
    __seed("thing.json", JSON.stringify({ nope: 1 }));
    expect(await loadJson("thing.json", isThing)).toBe(ABSENT);
    expect(__read("thing.json.corrupt")).toBe(JSON.stringify({ nope: 1 }));
  });

  it("never clobbers an existing .corrupt file", async () => {
    __seed("thing.json.corrupt", "first corruption");
    __seed("thing.json", "second corruption");
    await loadJson("thing.json", isThing);
    expect(__read("thing.json.corrupt")).toBe("first corruption");
    expect(__read("thing.json.corrupt.1")).toBe("second corruption");
  });

  it("still resolves to ABSENT, with the file quarantined, when reporting the quarantine also fails", async () => {
    // The rename that quarantines the corrupt file succeeds; only the
    // logger's own mkdir fails. A caller must still observe ABSENT, not a
    // rejection — quarantine is this module's own policy, never the
    // caller's problem.
    __seed("thing.json", "{ not json");
    __failPath("logs");

    expect(await loadJson("thing.json", isThing)).toBe(ABSENT);
    expect(__read("thing.json")).toBeUndefined();
    expect(__read("thing.json.corrupt")).toBe("{ not json");
  });
});

describe("saveJson", () => {
  it("writes valid JSON that round-trips", async () => {
    await saveJson("thing.json", { id: "a" });
    expect(JSON.parse(__read("thing.json") ?? "")).toEqual({ id: "a" });
  });

  it("leaves no temp files behind", async () => {
    await saveJson("thing.json", { id: "a" });
    expect(__list().filter((p) => p.includes(".tmp."))).toEqual([]);
  });

  it("serializes concurrent writers to one path without dropping content", async () => {
    await Promise.all([
      saveJson("thing.json", { id: "first" }),
      saveJson("thing.json", { id: "second" }),
      saveJson("thing.json", { id: "third" }),
    ]);
    // The last writer wins, nothing rejects, and no temp file survives.
    expect(JSON.parse(__read("thing.json") ?? "")).toEqual({ id: "third" });
    expect(__list().filter((p) => p.includes(".tmp."))).toEqual([]);
  });

  it("removes the temp file when the rename fails, and still rejects", async () => {
    // The temp is written, then the rename over the target fails. Leaving the
    // temp behind would accumulate one orphan per failed save, forever.
    __failPath("thing.json");

    await expect(saveJson("thing.json", { id: "a" })).rejects.toThrow(
      /thing\.json/,
    );
    expect(__list().filter((p) => p.includes(".tmp."))).toEqual([]);
  });

  it("namespaces temp names with a per-session nonce, not the counter alone", async () => {
    // The counter restarts at 0 every launch, so on its own it collides
    // across processes: two instances, or a restart racing a leftover temp,
    // both produce `.tmp.1`. The nonce is what makes the name unrepeatable.
    __resetJsonStoreForTests();
    await saveJson("thing.json", { id: "a" });

    const temp = __writes().find((p) => p.includes(".tmp."));
    expect(temp).toMatch(/^thing\.json\.tmp\.[0-9a-z]{8}\.1$/);
  });

  it("gives every write to one path its own temp name", async () => {
    // Serialization alone means only one temp exists at a time, so the
    // surviving files cannot show whether the names differ. The names
    // actually handed to writeTextFile can — a clock or a constant would
    // collapse these three into fewer.
    await Promise.all([
      saveJson("thing.json", { id: "first" }),
      saveJson("thing.json", { id: "second" }),
      saveJson("thing.json", { id: "third" }),
    ]);

    const temps = __writes().filter((p) => p.includes(".tmp."));
    expect(temps).toHaveLength(3);
    expect(new Set(temps).size).toBe(3);
  });
});

describe("loadJsonDir", () => {
  it("returns an empty array when the directory is absent", async () => {
    expect(await loadJsonDir("dashboards", isThing)).toEqual([]);
  });

  it("loads every valid .json entry and skips others", async () => {
    __seed("dashboards/a.json", JSON.stringify({ id: "a" }));
    __seed("dashboards/b.json", JSON.stringify({ id: "b" }));
    __seed("dashboards/notes.txt", "ignored");
    const loaded = await loadJsonDir("dashboards", isThing);
    expect(loaded.map((t) => t.id).sort()).toEqual(["a", "b"]);
  });

  it("quarantines a bad entry and still returns the good ones", async () => {
    __seed("dashboards/a.json", JSON.stringify({ id: "a" }));
    __seed("dashboards/bad.json", "{ not json");
    const loaded = await loadJsonDir("dashboards", isThing);
    expect(loaded.map((t) => t.id)).toEqual(["a"]);
    expect(__read("dashboards/bad.json.corrupt")).toBe("{ not json");
  });

  it("keeps the good entries when one entry's load rejects", async () => {
    // A load can reject outright — `exists` failing, or the rename that
    // quarantine attempts. One unreadable entry must not discard the entries
    // already accumulated; callers only ever observe ABSENT.
    __seed("dashboards/a.json", JSON.stringify({ id: "a" }));
    __seed("dashboards/unreadable.json", JSON.stringify({ id: "b" }));
    __seed("dashboards/c.json", JSON.stringify({ id: "c" }));
    __failPath("dashboards/unreadable.json");

    const loaded = await loadJsonDir("dashboards", isThing);

    expect(loaded.map((t) => t.id).sort()).toEqual(["a", "c"]);
  });

  it("keeps the good entries when logging the failure also fails", async () => {
    // Reporting a broken entry must not itself become the thing that breaks
    // the directory load — there is nowhere left to report it to.
    __seed("dashboards/a.json", JSON.stringify({ id: "a" }));
    __seed("dashboards/bad.json", "{ not json");
    __failPath("logs");

    const loaded = await loadJsonDir("dashboards", isThing);

    expect(loaded.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("serialization across operation kinds", () => {
  it("does not let a queued write resurrect a removed file", async () => {
    // The save is deliberately not awaited: the caller fires it and then
    // deletes the file. A write queue that removeJson does not join lets the
    // queued write land after the delete and recreate the file.
    const save = saveJson("thing.json", { id: "a" });
    const removed = removeJson("thing.json");
    await Promise.all([save, removed]);

    expect(__read("thing.json")).toBeUndefined();
  });

  it("does not let a rejected operation poison the path's queue", async () => {
    // The save fails at its mkdir, so it never touches the file itself.
    // The operations queued behind it must still run.
    // Both follow-ups chain on while the save is still in flight, so they
    // inherit its rejection rather than starting a fresh queue.
    __failPath("d");
    const save = saveJson("d/thing.json", { id: "a" });
    const removed = removeJson("d/thing.json");
    const loaded = loadJson("d/thing.json", isThing);

    await expect(save).rejects.toThrow(/EIO: d/);
    await expect(removed).resolves.toBeUndefined();
    await expect(loaded).resolves.toBe(ABSENT);
  });

  it("does not let quarantine discard a concurrently saved value", async () => {
    // The file on disk is corrupt, so the in-flight load will quarantine it.
    // A save racing that quarantine must never have its fresh, good content
    // moved to .corrupt and reported ABSENT.
    __seed("thing.json.corrupt", "an older corruption");
    __seed("thing.json", "{ not json");

    const load = loadJson("thing.json", isThing);
    const save = saveJson("thing.json", { id: "good" });
    await Promise.all([load, save]);

    expect(JSON.parse(__read("thing.json") ?? "")).toEqual({ id: "good" });
    expect(__read("thing.json.corrupt.1")).not.toBe(
      `${JSON.stringify({ id: "good" }, null, 2)}\n`,
    );
  });
});

describe("removeJson", () => {
  it("deletes the file", async () => {
    __seed("thing.json", JSON.stringify({ id: "a" }));
    await removeJson("thing.json");
    expect(__read("thing.json")).toBeUndefined();
  });
});
