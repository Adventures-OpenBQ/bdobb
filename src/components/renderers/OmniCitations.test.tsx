// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (u: string) => openUrl(u) }));

import { OmniCitations } from "./OmniCitations";

beforeEach(() => openUrl.mockReset());

describe("OmniCitations", () => {
  it("renders nothing when there are no citations", () => {
    const { container } = render(<OmniCitations citations={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("links a web citation to its origin", () => {
    render(<OmniCitations citations={[{ type: "web", name: "OpenBB", origin: "https://openbb.co" }]} />);
    const link = screen.getByRole("link", { name: "OpenBB" });
    expect(link).toHaveAttribute("href", "https://openbb.co");
  });

  it("opens a web citation externally instead of navigating the app's own webview", () => {
    render(<OmniCitations citations={[{ type: "web", name: "OpenBB", origin: "https://openbb.co" }]} />);

    // fireEvent.click returns false when the event's default was prevented.
    const notCancelled = fireEvent.click(screen.getByRole("link", { name: "OpenBB" }));

    expect(notCancelled).toBe(false);
    expect(openUrl).toHaveBeenCalledWith("https://openbb.co");
  });

  it("renders a non-web citation as text with its type, no link", () => {
    render(<OmniCitations citations={[{ type: "widget", name: "Price Table" }]} />);
    expect(screen.getByText("Price Table")).toBeInTheDocument();
    expect(screen.getByText("widget")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
