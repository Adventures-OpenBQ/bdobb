// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { backend, widget } from "../test/fixtures";
import type { SettingsUi, WidgetDef } from "./types";
import { serviceSettingsEntries } from "./settingsSections";

const settings = (id: string, backendId: string, name: string, settingsUi: SettingsUi): WidgetDef =>
  widget({ id, backendId, name, type: "settings", endpoint: "settings", settingsUi });
const keysSettings = (backendId: string, name = "Provider API Keys"): WidgetDef =>
  settings("provider_api_keys_settings", backendId, name, { kind: "app", name: "keys" });
const keysWidget = (backendId: string, name = "Provider API Keys (panel)"): WidgetDef =>
  widget({ id: "provider_api_keys_panel", backendId, name, type: "keys", endpoint: "keys" });

const nas = backend({ id: "nas", name: "NAS" });
const laptop = backend({ id: "laptop", name: "Laptop" });

describe("serviceSettingsEntries", () => {
  it("has no Keys entry at all when no backend runs key-maint", () => {
    expect(serviceSettingsEntries([], [])).toEqual([]);
    expect(serviceSettingsEntries([settings("r", "nas", "RSS ticker", { kind: "form" })], [nas]).map((e) => e.kind)).toEqual(["form"]);
  });

  it("labels a Keys section with the settings widget's own name, and binds it to the keys widget on the SAME backend", () => {
    const entries = serviceSettingsEntries([keysSettings("nas"), keysWidget("nas")], [nas]);
    expect(entries).toEqual([{ id: "keys:nas", label: "Provider API Keys", kind: "keys", backendId: "nas" }]);
  });

  it("takes whatever name the settings widget gives, like any other section", () => {
    const entries = serviceSettingsEntries([keysSettings("nas", "Vendor keys"), keysWidget("nas")], [nas]);
    expect(entries.map((e) => e.label)).toEqual(["Vendor keys"]);
  });

  it("still finds keys the old way on a backend with only the type: keys widget (openbb-docker v3.0.2), labelled with that widget's name", () => {
    expect(serviceSettingsEntries([keysWidget("nas")], [nas])).toEqual([
      { id: "keys:nas", label: "Provider API Keys (panel)", kind: "keys", backendId: "nas" },
    ]);
  });

  it("falls back to 'Provider API Keys' on the old path when the keys widget has no name of its own", () => {
    for (const name of ["", "provider_api_keys_panel"]) {
      expect(serviceSettingsEntries([keysWidget("nas", name)], [nas]).map((e) => e.label)).toEqual(["Provider API Keys"]);
    }
  });

  it("skips a keys settings widget whose backend serves no keys widget to bind to", () => {
    expect(serviceSettingsEntries([keysSettings("nas")], [nas])).toEqual([]);
  });

  it("gives several key-maint backends one section each, sorted and named for their backends", () => {
    const entries = serviceSettingsEntries(
      [keysWidget("nas", "Provider API Keys"), keysSettings("laptop"), keysWidget("laptop")],
      [nas, laptop],
    );
    expect(entries.map((e) => [e.id, e.label])).toEqual([
      ["keys:laptop", "Provider API Keys (Laptop)"],
      ["keys:nas", "Provider API Keys (NAS)"],
    ]);
  });

  it("sorts by backend name, then widget name", () => {
    const entries = serviceSettingsEntries(
      [
        settings("c", "nas", "Charts", { kind: "form" }),
        settings("r", "laptop", "RSS ticker", { kind: "form" }),
        settings("a", "laptop", "Archive", { kind: "form" }),
        keysSettings("nas"),
        keysWidget("nas"),
      ],
      [nas, laptop],
    );
    expect(entries.map((e) => e.label)).toEqual(["Archive", "RSS ticker", "Charts", "Provider API Keys"]);
  });

  it("carries the backend and widget a form section reads from", () => {
    const w = settings("r", "nas", "RSS ticker", { kind: "form" });
    const [entry] = serviceSettingsEntries([w], [nas]);
    expect(entry).toEqual({ id: "svc:nas:r", label: "RSS ticker", kind: "form", backendId: "nas", backend: nas, widget: w });
  });

  it("marks page as unsupported, and an unknown app name or ui as needing a newer app", () => {
    const entries = serviceSettingsEntries(
      [
        settings("p", "nas", "Paged", { kind: "page", path: "/p" }),
        settings("s", "nas", "Studies", { kind: "app", name: "studies" }),
        settings("u", "nas", "Unknown", { kind: "unknown" }),
      ],
      [nas],
    );
    expect(entries.map((e) => [e.label, e.kind])).toEqual([
      ["Paged", "unsupported"],
      ["Studies", "newer"],
      ["Unknown", "newer"],
    ]);
  });

  it("skips widgets whose backend is not configured", () => {
    expect(serviceSettingsEntries([settings("r", "gone", "RSS ticker", { kind: "form" }), keysWidget("gone")], [nas])).toEqual([]);
  });
});
