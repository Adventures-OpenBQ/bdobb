// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import {
  __failPath,
  __failRead,
  __read,
  __readBytes,
  __list,
  __reset,
  __seed,
  __writes,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "./memfs";

beforeEach(() => {
  __reset();
});

describe("__writes", () => {
  it("records the paths passed to writeTextFile, in order", async () => {
    await writeTextFile("b.json", "{}");
    await writeTextFile("a.json", "{}");
    await writeTextFile("b.json", "{}");

    expect(__writes()).toEqual(["b.json", "a.json", "b.json"]);
  });

  it("is cleared by __reset", async () => {
    await writeTextFile("a.json", "{}");
    __reset();

    expect(__writes()).toEqual([]);
  });
});

describe("exists", () => {
  it("is true for a directory implied only by a nested file path, never mkdir-ed", async () => {
    __seed("dashboards/a.json", "{}");

    expect(await exists("dashboards")).toBe(true);
  });

  it("is false for a path with no file, directory, or implied directory", async () => {
    expect(await exists("does-not-exist")).toBe(false);
  });
});

describe("__failPath", () => {
  it("makes reads and writes of that exact path reject", async () => {
    __seed("broken.json", "{}");
    __failPath("broken.json");

    await expect(exists("broken.json")).rejects.toThrow(/broken\.json/);
    await expect(readTextFile("broken.json")).rejects.toThrow(/broken\.json/);
    await expect(writeTextFile("broken.json", "{}")).rejects.toThrow(
      /broken\.json/,
    );
  });

  it("still lets the failed path be renamed AWAY, the way a real one can be", async () => {
    // rename needs write permission on the containing DIRECTORY and does not
    // consult the source file's own mode at all, so a `chmod 000` file in a
    // writable directory renames fine. The double used to guard `oldPath`,
    // which made a failed path un-quarantinable and let jsonStore's
    // read-error path look like it rejected when on a real disk it silently
    // quarantined, reseeded and SUCCEEDED -- costing the startup banner its
    // headline case. Renaming ONTO a failed path must still reject.
    __seed("broken.json", "{}");
    __failPath("broken.json");

    await expect(rename("broken.json", "elsewhere.json")).resolves.toBeUndefined();
    expect(__read("elsewhere.json")).toBe("{}");

    __seed("source.json", "x");
    __failPath("target.json");
    await expect(rename("source.json", "target.json")).rejects.toThrow(
      /target\.json/,
    );
  });

  it("leaves other paths alone", async () => {
    __seed("fine.json", "{}");
    __failPath("broken.json");

    expect(await readTextFile("fine.json")).toBe("{}");
  });

  it("is cleared by __reset", async () => {
    __seed("broken.json", "{}");
    __failPath("broken.json");
    __reset();
    __seed("broken.json", "{}");

    expect(await readTextFile("broken.json")).toBe("{}");
  });
});

describe("__failRead", () => {
  it("fails only the content read: the file still exists and still renames", async () => {
    // The `chmod 000` shape, and the narrowest failure that still reaches
    // jsonStore's `readTextFile`. `__failPath` throws from `exists` first, so
    // it can never exercise what happens after the file is found.
    __seed("locked.json", '{"id":"a"}');
    __failRead("locked.json");

    expect(await exists("locked.json")).toBe(true);
    await expect(readTextFile("locked.json")).rejects.toThrow(/locked\.json/);
    await expect(readFile("locked.json")).rejects.toThrow(/locked\.json/);
    await expect(rename("locked.json", "moved.json")).resolves.toBeUndefined();
  });

  it("is cleared by __reset", async () => {
    __seed("locked.json", "{}");
    __failRead("locked.json");
    __reset();
    __seed("locked.json", "{}");

    expect(await readTextFile("locked.json")).toBe("{}");
  });
});

describe("readDir", () => {
  it("returns files in the queried directory with isFile: true", async () => {
    __seed("dashboards/a.json", "{}");

    const entries = await readDir("dashboards");

    expect(entries).toEqual([
      { name: "a.json", isFile: true, isDirectory: false, isSymlink: false },
    ]);
  });

  it("returns a subdirectory implied by a nested file path once, with isDirectory: true", async () => {
    __seed("dashboards/nested/deep.json", "{}");

    const entries = await readDir("dashboards");

    expect(entries).toEqual([
      { name: "nested", isFile: false, isDirectory: true, isSymlink: false },
    ]);
  });

  it("returns a subdirectory created only by mkdir with isDirectory: true", async () => {
    await mkdir("dashboards/empty-dir");

    const entries = await readDir("dashboards");

    expect(entries).toEqual([
      { name: "empty-dir", isFile: false, isDirectory: true, isSymlink: false },
    ]);
  });

  it("does not duplicate a directory that is both mkdir-ed and implied by a file path", async () => {
    await mkdir("dashboards/nested");
    __seed("dashboards/nested/deep.json", "{}");

    const entries = await readDir("dashboards");

    expect(entries).toEqual([
      { name: "nested", isFile: false, isDirectory: true, isSymlink: false },
    ]);
  });

  it("does not surface files nested deeper than one level in the parent's listing", async () => {
    __seed("dashboards/nested/deep.json", "{}");

    const entries = await readDir("dashboards");

    expect(entries.map((e) => e.name)).not.toContain("deep.json");
  });

  it("returns an empty array for a directory with no entries", async () => {
    await mkdir("dashboards");

    const entries = await readDir("dashboards");

    expect(entries).toEqual([]);
  });

  it("throws ENOENT for a path that does not exist", async () => {
    // Real Tauri plugin-fs readDir throws on a missing directory. Returning
    // [] instead would let a caller drop its `exists` guard unnoticed.
    await expect(readDir("does-not-exist")).rejects.toThrow(/ENOENT/);
  });

  it("throws ENOENT for a path that is a file, not a directory", async () => {
    __seed("thing.json", "{}");

    await expect(readDir("thing.json")).rejects.toThrow(/ENOENT/);
  });
});

describe("readFile", () => {
  const decoder = new TextDecoder();

  it("reads back the bytes writeFile wrote", async () => {
    await writeFile("files/a.csv", new Uint8Array([104, 105]));

    expect(decoder.decode(await readFile("files/a.csv"))).toBe("hi");
  });

  it("reads a SEEDED text file as its utf-8 bytes", async () => {
    // A real filesystem draws no line between text and binary, and a seed is
    // the only way a test (or e2e/fixtures.ts) can put a file where the app
    // will find one at boot.
    __seed("files/b.csv", "a,b\n");

    expect(decoder.decode(await readFile("files/b.csv"))).toBe("a,b\n");
  });

  it("throws ENOENT for a file that is not there", async () => {
    await expect(readFile("files/missing.csv")).rejects.toThrow(/ENOENT/);
  });
});

describe("binary files", () => {
  it("are visible to exists, and to exists on their directory", async () => {
    await writeFile("files/a.csv", new Uint8Array([1]));

    expect(await exists("files/a.csv")).toBe(true);
    expect(await exists("files")).toBe(true);
  });

  it("are removed by remove", async () => {
    await writeFile("files/a.csv", new Uint8Array([1]));

    await remove("files/a.csv");

    expect(await exists("files/a.csv")).toBe(false);
    await expect(readFile("files/a.csv")).rejects.toThrow(/ENOENT/);
  });
});

it('seeds captured binary workbook bytes without converting them into text',async()=>{
 const bytes=[208,207,17,224,0,255,128];
 __seed('files/workbook.xls',bytes);
 expect([...await readFile('files/workbook.xls')]).toEqual(bytes);
 bytes[0]=1;
 expect(__readBytes('files/workbook.xls')?.[0]).toBe(208);
 expect(__list()).not.toContain('files/workbook.xls');
});
