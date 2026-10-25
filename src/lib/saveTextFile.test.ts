// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const save = vi.fn();
const writeTextFile = vi.fn();
const writeFile = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...a: unknown[]) => writeTextFile(...a),
  writeFile: (...a: unknown[]) => writeFile(...a),
}));

const { saveTextFile, saveBinaryFile } = await import("./saveTextFile");

// jsdom (unlike a real browser) never implements the Blob URL methods at
// all, so vi.spyOn below has no property to attach to. A no-op stub gives it
// one; the browser-download tests still assert the mocked calls happened.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "";
  URL.revokeObjectURL = () => {};
}

beforeEach(() => {
  save.mockReset();
  writeTextFile.mockReset();
  writeFile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("writes the text at the chosen path and reports success", async () => {
  save.mockResolvedValue("/tmp/out.json");
  await expect(saveTextFile("out.json", "out.json", "hello")).resolves.toBe(true);
  expect(writeTextFile).toHaveBeenCalledWith("/tmp/out.json", "hello", undefined);
});

test("a cancelled dialog writes nothing and reports it", async () => {
  save.mockResolvedValue(null);
  await expect(saveTextFile("out.json", "out.json", "hello")).resolves.toBe(false);
  expect(writeTextFile).not.toHaveBeenCalled();
});

test("offers the given name and a json filter by default", async () => {
  save.mockResolvedValue("/tmp/out.json");
  await saveTextFile("bdobb-settings.json", "bdobb-settings.json", "{}");
  expect(save).toHaveBeenCalledWith({
    defaultPath: "bdobb-settings.json",
    filters: [{ name: "bdobb-settings.json", extensions: ["json"] }],
  });
});

test("saveBinaryFile writes the bytes at the chosen path with a png filter", async () => {
  save.mockResolvedValue("/tmp/chart.png");
  const bytes = new Uint8Array([1, 2, 3]);
  await expect(saveBinaryFile("chart.png", "chart.png", bytes, "png")).resolves.toBe(true);
  expect(save).toHaveBeenCalledWith({
    defaultPath: "chart.png",
    filters: [{ name: "chart.png", extensions: ["png"] }],
  });
  expect(writeFile).toHaveBeenCalledWith("/tmp/chart.png", bytes, undefined);
});

test("a given extension replaces the default json filter", async () => {
  save.mockResolvedValue("/tmp/bdobb-logs.txt");
  await saveTextFile("bdobb-logs.txt", "Log files", "line one\n", "txt");
  expect(save).toHaveBeenCalledWith({
    defaultPath: "bdobb-logs.txt",
    filters: [{ name: "Log files", extensions: ["txt"] }],
  });
});

test("triggers an anchor download of the same text under --mode browser", async () => {
  vi.stubEnv("MODE", "browser");
  save.mockResolvedValue("/tmp/bdobb-logs.txt");
  writeTextFile.mockResolvedValue(undefined);
  const click = vi.fn();
  const anchor = { href: "", download: "", click, remove: vi.fn() } as unknown as HTMLAnchorElement;
  const create = vi.spyOn(document, "createElement").mockReturnValue(anchor);
  vi.spyOn(document.body, "append").mockImplementation(() => undefined as never);
  const createURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  const written = await saveTextFile("bdobb-logs.txt", "Log files", "line one\n", "txt");

  expect(written).toBe(true);
  expect(create).toHaveBeenCalledWith("a");
  expect(anchor.download).toBe("bdobb-logs.txt");
  expect(click).toHaveBeenCalled();
  expect(createURL).toHaveBeenCalled();
  expect((createURL.mock.calls[0][0] as Blob).type).toBe("text/plain;charset=utf-8");
  expect(anchor.href).toBe("blob:x");
});

test("does not touch the DOM outside browser mode", async () => {
  vi.stubEnv("MODE", "test");
  save.mockResolvedValue("/tmp/x.txt");
  writeTextFile.mockResolvedValue(undefined);
  const create = vi.spyOn(document, "createElement");

  const written = await saveTextFile("x.txt", "Logs", "hi\n", "txt");

  expect(written).toBe(true);
  expect(create).not.toHaveBeenCalledWith("a");
});

test("a cancelled dialog never reaches the browser-download branch", async () => {
  vi.stubEnv("MODE", "browser");
  save.mockResolvedValue(null);
  const create = vi.spyOn(document, "createElement");

  await expect(saveTextFile("x.txt", "Logs", "hi\n", "txt")).resolves.toBe(false);
  expect(create).not.toHaveBeenCalledWith("a");
});
