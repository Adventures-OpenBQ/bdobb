// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settingsFile";
import { resolvedTheme } from "./theme";
import { useSettingsStore } from "../stores/settingsStore";
import { stubMatchMedia, type MatchMediaStub } from "../test/matchMedia";

let media: MatchMediaStub | null = null;

function setTheme(theme: "dark" | "light" | "system") {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme } });
}

afterEach(() => {
  media?.restore();
  media = null;
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

describe("resolvedTheme", () => {
  it("reads the store without a React render", () => {
    media = stubMatchMedia(false);
    setTheme("light");
    expect(resolvedTheme()).toBe("light");

    setTheme("system");
    expect(resolvedTheme()).toBe("light");

    media.set(true);
    expect(resolvedTheme()).toBe("dark");
  });

  it("never consults matchMedia for an explicit theme", () => {
    media = stubMatchMedia(true);
    setTheme("light");
    expect(resolvedTheme()).toBe("light");
    expect(media.queries).toEqual([]);
  });

  it("falls back to dark where matchMedia does not exist", () => {
    setTheme("system");
    expect(resolvedTheme()).toBe("dark");
  });
});
