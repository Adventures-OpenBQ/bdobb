// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The fake service: the two requests a form section makes, answered per test.
const fetchWidgetData = vi.fn();
const putSettings = vi.fn();
vi.mock("../../../lib/dataClient", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/dataClient")>("../../../lib/dataClient");
  return {
    ...actual,
    fetchWidgetData: (...a: unknown[]) => fetchWidgetData(...a),
    putSettings: (...a: unknown[]) => putSettings(...a),
  };
});

import { __reset } from "../../../test/memfs";
import { __resetLoggerForTests } from "../../../lib/logger";
import { backend, widget } from "../../../test/fixtures";
import { SettingsForm } from "./SettingsForm";

const svc = backend({ id: "rss", name: "rss-ticker", baseUrl: "http://rss.local" });
const w = widget({ id: "rss_ticker_settings", backendId: "rss", type: "settings", endpoint: "settings", settingsUi: { kind: "form" } });

const fields = () => [
  { id: "poll_seconds", label: "Poll interval", type: "number", value: 60, min: 10, max: 3600, unit: "s", help: "How often feeds are read." },
  { id: "source", label: "Source name", type: "text", value: "wire" },
  { id: "paused", label: "Paused", type: "boolean", value: false },
  { id: "depth", label: "Depth", type: "select", value: 5, options: [{ value: 5, label: "Five" }, { value: 10, label: "Ten" }] },
  { id: "uploads", label: "Uploads", type: "boolean", value: false, readOnly: true, readOnlyReason: "TA_STUDIES_API is off." },
  { id: "colour", label: "Colour", type: "color", value: "#ff0000" },
];
const section = (over: Record<string, unknown> = {}) => ({ version: 1, title: "RSS ticker", description: "Tuning.", fields: fields(), ...over });

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  fetchWidgetData.mockReset();
  putSettings.mockReset();
});

describe("SettingsForm", () => {
  it("draws every field type from GET {endpoint}, locks read-only fields with their reason, and shows an unknown type read-only", async () => {
    fetchWidgetData.mockResolvedValue(section());
    render(<SettingsForm backend={svc} widget={w} />);

    expect(await screen.findByLabelText("Poll interval")).toHaveValue(60);
    expect(fetchWidgetData).toHaveBeenCalledWith(svc, w, {});
    expect(screen.getByText("How often feeds are read.")).toBeInTheDocument();
    expect(screen.getByLabelText("Source name")).toHaveValue("wire");
    expect(screen.getByLabelText("Paused")).not.toBeChecked();
    expect(screen.getByLabelText("Depth")).toHaveDisplayValue("Five");
    expect(screen.getByLabelText("Uploads")).toBeDisabled();
    expect(screen.getByText("TA_STUDIES_API is off.")).toBeInTheDocument();
    expect(screen.getByLabelText("Colour")).toHaveAttribute("readonly");
    expect(screen.getByText(/type \(color\) needs a newer app version/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves only the changed fields, typed as the description types them, and shows the notice", async () => {
    fetchWidgetData.mockResolvedValue(section());
    const saved = fields().map((f) => (f.id === "poll_seconds" ? { ...f, value: 120 } : f.id === "depth" ? { ...f, value: 10 } : f));
    putSettings.mockResolvedValue({ ok: true, body: section({ fields: saved, notice: "Takes effect on restart." }) });
    render(<SettingsForm backend={svc} widget={w} />);

    const poll = await screen.findByLabelText("Poll interval");
    await userEvent.clear(poll);
    await userEvent.type(poll, "120");
    await userEvent.selectOptions(screen.getByLabelText("Depth"), "Ten");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(putSettings).toHaveBeenCalledWith(svc, w, { poll_seconds: 120, depth: 10 });
    expect(await screen.findByText("Takes effect on restart.")).toBeInTheDocument();
    expect(screen.getByLabelText("Poll interval")).toHaveValue(120);
    expect(screen.getByLabelText("Depth")).toHaveDisplayValue("Ten");
  });

  it("puts each 422 message by its field and keeps the values as typed", async () => {
    fetchWidgetData.mockResolvedValue(section());
    putSettings.mockResolvedValue({ ok: false, errors: { poll_seconds: "At least 10 seconds." } });
    render(<SettingsForm backend={svc} widget={w} />);

    const poll = await screen.findByLabelText("Poll interval");
    await userEvent.clear(poll);
    await userEvent.type(poll, "5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("At least 10 seconds.")).toBeInTheDocument();
    expect(screen.getByLabelText("Poll interval")).toHaveValue(5);
  });

  it("shows any other save failure at section level and keeps every edit", async () => {
    fetchWidgetData.mockResolvedValue(section());
    putSettings.mockRejectedValue(new Error("HTTP 500"));
    render(<SettingsForm backend={svc} widget={w} />);

    const source = await screen.findByLabelText("Source name");
    await userEvent.clear(source);
    await userEvent.type(source, "tape");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");
    expect(screen.getByLabelText("Source name")).toHaveValue("tape");
  });

  it("refuses a cleared or non-numeric number without sending anything", async () => {
    fetchWidgetData.mockResolvedValue(section());
    render(<SettingsForm backend={svc} widget={w} />);

    await userEvent.clear(await screen.findByLabelText("Poll interval"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Enter a number.")).toBeInTheDocument();
    expect(putSettings).not.toHaveBeenCalled();
  });

  it("shows a service that is down with a Retry, and loads on Retry", async () => {
    fetchWidgetData.mockRejectedValueOnce(new Error("fetch failed (http://rss.local/settings)")).mockResolvedValueOnce(section());
    render(<SettingsForm backend={svc} widget={w} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("fetch failed");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByLabelText("Poll interval")).toBeInTheDocument();
  });

  it("draws no fields for a newer contract version", async () => {
    fetchWidgetData.mockResolvedValue(section({ version: 2 }));
    render(<SettingsForm backend={svc} widget={w} />);
    expect(await screen.findByText("Needs a newer app version.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Poll interval")).not.toBeInTheDocument();
  });

  it("makes a malformed body a section error, not a crash", async () => {
    fetchWidgetData.mockResolvedValue("<html>oops</html>");
    render(<SettingsForm backend={svc} widget={w} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("not a JSON object");
  });

  it("handles a field id of __proto__ as data: sent as an own key, its 422 shown by its field", async () => {
    const body = section({ fields: [{ id: "__proto__", label: "Odd", type: "text", value: "a" }] });
    fetchWidgetData.mockResolvedValue(body);
    putSettings.mockResolvedValue({ ok: false, errors: JSON.parse('{"__proto__":"Not allowed."}') });
    render(<SettingsForm backend={svc} widget={w} />);

    const odd = await screen.findByLabelText("Odd");
    // Untouched, the field must not look changed (`"__proto__" in {}` is true).
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(odd, "b");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const sent = putSettings.mock.calls[0][2] as Record<string, unknown>;
    expect(Object.getPrototypeOf(sent)).toBeNull();
    expect(Object.keys(sent)).toEqual(["__proto__"]);
    expect(sent["__proto__"]).toBe("ab");
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
  });

  it("shows a 422 whose ids match no field as the section-level message", async () => {
    fetchWidgetData.mockResolvedValue(section());
    putSettings.mockResolvedValue({ ok: false, errors: { values: "bad payload", poll_seconds: "At least 10 seconds." } });
    render(<SettingsForm backend={svc} widget={w} />);

    await userEvent.type(await screen.findByLabelText("Source name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("bad payload");
    expect(screen.getByText("At least 10 seconds.")).toBeInTheDocument();
  });

  it("locks the fields while a save is in flight, so nothing typed is lost", async () => {
    fetchWidgetData.mockResolvedValue(section());
    let finish: (v: unknown) => void = () => {};
    putSettings.mockReturnValue(new Promise((r) => (finish = r)));
    render(<SettingsForm backend={svc} widget={w} />);

    await userEvent.type(await screen.findByLabelText("Source name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByLabelText("Source name")).toBeDisabled();
    finish({ ok: true, body: section() });
    await waitFor(() => expect(screen.getByLabelText("Source name")).toBeEnabled());
  });
});

describe("SettingsForm ids", () => {
  it("gives two sections serving the same form their own control ids, each label resolving to its own control", async () => {
    fetchWidgetData.mockResolvedValue(section());
    render(
      <>
        <div data-testid="one"><SettingsForm backend={svc} widget={w} /></div>
        <div data-testid="two"><SettingsForm backend={svc} widget={w} /></div>
      </>,
    );
    for (const id of ["one", "two"]) {
      const scope = within(await screen.findByTestId(id));
      const input = await scope.findByLabelText("Source name");
      expect(scope.getByText("Source name")).toHaveProperty("htmlFor", input.id);
    }
    const ids = screen.getAllByLabelText("Source name").map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });
});
