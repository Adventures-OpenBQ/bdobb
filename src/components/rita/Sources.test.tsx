// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { card } from "../../test/fixtures";
import { usePdfHighlightStore } from "../../stores/pdfHighlightStore";
import { Sources, citationLink, citedCardId } from "./Sources";

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

describe("quote citations", () => {
  const box = (page: number) => ({ text: "q", page, x0: 1, top: 2, x1: 3, bottom: 4 });
  const REPORT = card({ id: "11111111-1111-4111-8111-111111111111", backendId: "b1", widgetId: "report" });

  it("finds the cited card by Rita's metadata.widget_uuid, else by origin and widget_id", () => {
    expect(citedCardId({ source_info: { metadata: { widget_uuid: REPORT.id } } }, [REPORT])).toBe(REPORT.id);
    expect(citedCardId({ source_info: { origin: "b1", widget_id: "report" } }, [REPORT])).toBe(REPORT.id);
    expect(citedCardId({ source_info: { metadata: { widget_uuid: "gone" }, origin: "b1", widget_id: "report" } }, [REPORT])).toBeNull();
    expect(citedCardId({ source_info: { origin: "b2", widget_id: "report" } }, [REPORT])).toBeNull();
  });

  it("opens a boxed citation on its card at the first box's page", async () => {
    usePdfHighlightStore.setState({ highlight: null });
    const groups = [[box(2)], [box(3), box(2)]];
    render(<Sources cards={[REPORT]} citations={[{ id: "c1", source_info: { type: "widget", origin: "b1", widget_id: "report", name: "Report" }, quote_bounding_boxes: groups }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    expect(usePdfHighlightStore.getState().highlight).toEqual({ cardId: REPORT.id, page: 2, boxes: [box(2), box(2)] });
  });

  it("shows a boxed citation whose card is not on the dashboard as plain text", () => {
    render(<Sources cards={[]} citations={[{ id: "c1", source_info: { type: "widget", origin: "b1", widget_id: "report", name: "Report" }, quote_bounding_boxes: [[box(1)]] }]} />);
    expect(screen.getByText("Report").tagName).not.toBe("BUTTON");
  });
});
