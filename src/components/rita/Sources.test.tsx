// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sources, citationLink } from "./Sources";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

describe("citationLink", () => {
  it("names widget citations without a url as plain text and drops unsafe urls", () => {
    expect(citationLink({ id: "1", source_info: { type: "widget", name: "Historical Prices" } })).toEqual({
      name: "Historical Prices",
      url: null,
    });
    expect(citationLink({ id: "2", source_info: { url: "https://example.com/a" } })).toEqual({ name: "2", url: "https://example.com/a" });
    expect(citationLink({ id: "3", url: "javascript:alert(1)" })).toBeNull();
    expect(citationLink("junk")).toBeNull();
  });
});

describe("Sources", () => {
  it("opens links externally and renders url-less sources as text", async () => {
    render(
      <Sources
        citations={[
          { id: "a", source_info: { name: "Prices" } },
          { id: "b", source_info: { name: "Docs", url: "https://example.com/docs" } },
        ]}
      />,
    );
    expect(screen.getByText("Prices").tagName).not.toBe("BUTTON");
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("renders nothing without citations", () => {
    const { container } = render(<Sources citations={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
