// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseSettingsDescription } from "./settingsForm";

const good = () => ({
  version: 1,
  title: "RSS ticker",
  description: "Tuning.",
  fields: [
    { id: "poll_seconds", label: "Poll interval", type: "number", value: 60, min: 10, max: 3600, step: 5, unit: "s", help: "How often." },
    { id: "source", label: "Source", type: "text", value: "wire" },
    { id: "paused", label: "Paused", type: "boolean", value: false, readOnly: true, readOnlyReason: "Locked." },
    { id: "depth", label: "Depth", type: "select", value: 5, options: [{ value: 5, label: "Five" }, { value: 10, label: "Ten" }] },
    { id: "colour", label: "Colour", type: "color", value: "#f00" },
  ],
});

describe("parseSettingsDescription", () => {
  it("reads every field type, its constraints and its lock", () => {
    const parsed = parseSettingsDescription({ ...good(), notice: "Takes effect on restart." });
    if (!parsed.ok) throw new Error("expected ok");
    const [poll, source, paused, depth, colour] = parsed.section.fields;
    expect(poll).toMatchObject({ type: "number", known: true, value: 60, min: 10, max: 3600, step: 5, unit: "s", help: "How often.", readOnly: false });
    expect(source).toMatchObject({ type: "text", known: true, value: "wire" });
    expect(paused).toMatchObject({ readOnly: true, readOnlyReason: "Locked." });
    expect(depth.options).toEqual([{ value: 5, label: "Five" }, { value: 10, label: "Ten" }]);
    expect(colour).toMatchObject({ type: "color", known: false, value: "#f00" });
    expect(parsed.section.notice).toBe("Takes effect on restart.");
    expect(parsed.section.title).toBe("RSS ticker");
  });

  it("refuses to draw a description from a newer contract", () => {
    expect(parseSettingsDescription({ ...good(), version: 2 })).toEqual({ ok: false, newer: true });
  });

  it("makes a malformed body a section error, never a throw", () => {
    for (const raw of [null, "<html>", [], { fields: [] }, { version: "1", fields: [] }, { version: 1 }]) {
      const parsed = parseSettingsDescription(raw);
      expect(parsed.ok).toBe(false);
      expect(parsed).toHaveProperty("newer", false);
    }
  });

  it("makes a malformed known field a section error", () => {
    const withField = (field: unknown) => parseSettingsDescription({ ...good(), fields: [field] });
    expect(withField({ label: "no id", type: "text", value: "" }).ok).toBe(false);
    expect(withField({ id: "n", type: "number", value: "60" }).ok).toBe(false);
    expect(withField({ id: "b", type: "boolean", value: "yes" }).ok).toBe(false);
    expect(withField({ id: "s", type: "select", value: 3, options: [{ value: 5, label: "Five" }] }).ok).toBe(false);
    expect(parseSettingsDescription({ ...good(), fields: [good().fields[1], good().fields[1]] }).ok).toBe(false);
  });
});
