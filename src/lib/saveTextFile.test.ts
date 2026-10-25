// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const save = vi.fn();
const writeTextFile = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...a: unknown[]) => writeTextFile(...a),
}));

const { saveTextFile } = await import("./saveTextFile");

beforeEach(() => {
  save.mockReset();
  writeTextFile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("writes the text at the chosen path and reports success", async () => {
  save.mockResolvedValue("/tmp/out.json");
  await expect(saveTextFile("out.json", "out.json", "hello")).resolves.toBe(true);
  expect(writeTextFile).toHaveBeenCalledWith("/tmp/out.json", "hello");
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

test("offers the given extension when one is passed, e.g. a .txt log export", async () => {
  save.mockResolvedValue("/tmp/bdobb-logs.txt");
  await saveTextFile("bdobb-logs.txt", "bdobb-logs.txt", "line1\n", "txt");
  expect(save).toHaveBeenCalledWith({
    defaultPath: "bdobb-logs.txt",
    filters: [{ name: "bdobb-logs.txt", extensions: ["txt"] }],
  });
  expect(writeTextFile).toHaveBeenCalledWith("/tmp/bdobb-logs.txt", "line1\n");
});

test("browser mode downloads the same bytes via an anchor click after a successful write", async () => {
  vi.stubEnv("MODE", "browser");
  save.mockResolvedValue("/exports/out.txt");
  const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-url");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  const click = vi.fn();
  const nativeCreateElement = document.createElement.bind(document);
  const createElement = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = nativeCreateElement(tag);
    if (tag === "a") el.click = click;
    return el;
  });

  await saveTextFile("out.txt", "out.txt", "hello", "txt");

  expect(createObjectURL).toHaveBeenCalledTimes(1);
  const [blob] = createObjectURL.mock.calls[0];
  expect(blob.type).toBe("text/plain;charset=utf-8");
  expect(click).toHaveBeenCalledTimes(1);
  const anchor = createElement.mock.results.find(r => (r.value as HTMLElement).tagName === "A")!
    .value as HTMLAnchorElement;
  expect(anchor.download).toBe("out.txt");
  expect(anchor.href).toContain("blob:mock-url");
});

test("MODE other than \"browser\" never downloads (Tauri, or the vitest \"test\" mode itself)", async () => {
  save.mockResolvedValue("/tmp/out.txt");
  const createObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

  await saveTextFile("out.txt", "out.txt", "hello", "txt");

  expect(createObjectURL).not.toHaveBeenCalled();
});

test("a cancelled dialog never downloads, even in browser mode", async () => {
  vi.stubEnv("MODE", "browser");
  save.mockResolvedValue(null);
  const createObjectURL = vi.fn();
  vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });

  await expect(saveTextFile("out.txt", "out.txt", "hello", "txt")).resolves.toBe(false);

  expect(createObjectURL).not.toHaveBeenCalled();
});
