// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it } from "vitest";

import { __readBytes, __reset, __seed, __writes } from "../test/memfs";
import {
  LOCAL_FILE_MAX_BYTES,
  deleteLocalFile,
  extensionOf,
  localFileRefusal,
  readLocalFile,
  saveLocalFile,
} from "./localFiles";

const decoder = new TextDecoder();

beforeEach(() => {
  __reset();
});

describe("saveLocalFile", () => {
  it("writes the bytes to files/<uuid>.<ext> and returns the stored name", async () => {
    const name = await saveLocalFile(new File(["a,b\n1,2\n"], "prices.csv"));

    expect(name).toMatch(/^[0-9a-f-]{36}\.csv$/);
    expect(__writes()).toEqual([`files/${name}`]);
    expect(decoder.decode(__readBytes(`files/${name}`))).toBe("a,b\n1,2\n");
  });

  it("lower-cases the extension, so a .CSV and a .csv land on one code path", async () => {
    const name = await saveLocalFile(new File(["a\n"], "PRICES.CSV"));
    expect(name.endsWith(".csv")).toBe(true);
  });

  it("never puts the original name in the path", async () => {
    const name = await saveLocalFile(new File(["a\n"], "../../etc/passwd.csv"));
    expect(__writes()).toEqual([`files/${name}`]);
  });

  it("refuses a name with no usable extension rather than writing outside the shape", async () => {
    await expect(saveLocalFile(new File(["a\n"], "prices"))).rejects.toThrow(
      "not a stored file name",
    );
    expect(__writes()).toEqual([]);
  });
});

describe("readLocalFile", () => {
  it("reads back what saveLocalFile wrote", async () => {
    const name = await saveLocalFile(new File(["x,y\n"], "t.csv"));
    expect(decoder.decode(await readLocalFile(name))).toBe("x,y\n");
  });

  it("reads a file that was on disk before this session", async () => {
    __seed("files/11111111-1111-4111-8111-111111111111.csv", "a\n1\n");
    const bytes = await readLocalFile("11111111-1111-4111-8111-111111111111.csv");
    expect(decoder.decode(bytes)).toBe("a\n1\n");
  });

  it("rejects a stored name that tries to escape the files directory", async () => {
    await expect(readLocalFile("../dashboards/d1.json")).rejects.toThrow(
      "not a stored file name",
    );
  });

  it("rejects a name that is not a uuid, however plausible", async () => {
    await expect(readLocalFile("prices.csv")).rejects.toThrow("not a stored file name");
  });

  it("rejects a missing file", async () => {
    await expect(
      readLocalFile("22222222-2222-4222-8222-222222222222.csv"),
    ).rejects.toThrow("ENOENT");
  });
});

describe("deleteLocalFile", () => {
  it("removes the stored file", async () => {
    const name = await saveLocalFile(new File(["x\n"], "t.csv"));
    await deleteLocalFile(name);
    await expect(readLocalFile(name)).rejects.toThrow("ENOENT");
  });

  it("is a no-op for a file that is already gone", async () => {
    await expect(
      deleteLocalFile("33333333-3333-4333-8333-333333333333.csv"),
    ).resolves.toBeUndefined();
  });

  it("rejects a stored name that tries to escape the files directory", async () => {
    await expect(deleteLocalFile("../dashboards/d1.json")).rejects.toThrow(
      "not a stored file name",
    );
  });
});

describe("localFileRefusal", () => {
  it("passes a file at the limit", () => {
    expect(localFileRefusal("big.csv", LOCAL_FILE_MAX_BYTES)).toBeNull();
  });

  it("names the file and rounds its size up, so one byte over does not read as the limit", () => {
    expect(localFileRefusal("big.csv", LOCAL_FILE_MAX_BYTES + 1)).toBe(
      "big.csv is 50.1 MB; the limit is 50 MB.",
    );
  });
});

describe("extensionOf", () => {
  it.each([
    ["prices.csv", "csv"],
    ["PRICES.CSV", "csv"],
    ["archive.tar.gz", "gz"],
    ["noextension", ""],
  ])("reads %s as %s", (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});
