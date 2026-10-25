// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { __read, __reset } from "../test/memfs";
import { exportChat } from "./chatExportFile";

const save = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => save(...a) }));

beforeEach(() => {
  __reset();
  save.mockReset();
});

describe("exportChat", () => {
  it("writes the markdown to the chosen path", async () => {
    save.mockResolvedValue("/tmp/out.md");
    expect(await exportChat("# hi", "hi.md")).toBe("/tmp/out.md");
    expect(save).toHaveBeenCalledWith({ defaultPath: "hi.md", filters: [{ name: "Markdown", extensions: ["md"] }] });
    expect(__read("/tmp/out.md")).toBe("# hi");
  });

  it("returns null when the dialog is cancelled", async () => {
    save.mockResolvedValue(null);
    expect(await exportChat("# hi", "hi.md")).toBeNull();
  });
});
