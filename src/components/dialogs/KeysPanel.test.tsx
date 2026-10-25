// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchWidgetData = vi.fn();
const testProviderKey = vi.fn();
const putProviderKey = vi.fn();
vi.mock("../../lib/dataClient", async () => {
  const actual = await vi.importActual<typeof import("../../lib/dataClient")>("../../lib/dataClient");
  return {
    ...actual,
    fetchWidgetData: (...a: unknown[]) => fetchWidgetData(...a),
    testProviderKey: (...a: unknown[]) => testProviderKey(...a),
    putProviderKey: (...a: unknown[]) => putProviderKey(...a),
  };
});

import { __read, __reset } from "../../test/memfs";
import { __resetLoggerForTests } from "../../lib/logger";
import type { BackendConfig, WidgetDef } from "../../lib/types";
import { backend, widget } from "../../test/fixtures";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWidgetRegistryStore } from "../../stores/widgetRegistryStore";
import { useModalDialog } from "../../hooks/useModalDialog";
import { KeysPanel } from "./KeysPanel";

const keysBackend: BackendConfig = backend({
  id: "km",
  name: "key-maint",
  baseUrl: "http://km.local",
});

const keysWidget: WidgetDef = widget({
  id: "provider_api_keys_panel",
  backendId: "km",
  name: "Provider keys",
  type: "keys",
  category: "",
  endpoint: "keys",
  params: [{ paramName: "run_tests", value: "false" }],
});

// tier 3: the row carries a plaintext `value`, which invariant 1 requires
// never reaches any rendered text anywhere in the dashboard or Details.
const keysPayload = {
  tier: 3,
  rows: [{ provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false, value: "sk-SECRET-TIER3" }],
};

function connectKeyMaint() {
  useWidgetRegistryStore.setState({ widgets: [keysWidget] });
  useBackendsStore.setState({ backends: [keysBackend], statuses: {} });
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  useWidgetRegistryStore.setState({ widgets: [] });
  useBackendsStore.setState({ backends: [], statuses: {} });
  fetchWidgetData.mockReset();
  testProviderKey.mockReset();
  putProviderKey.mockReset();
});

describe("KeysPanel", () => {
  it("renders nothing, and fetches nothing, when its backend serves no keys widget", () => {
    useBackendsStore.setState({ backends: [keysBackend], statuses: {} });
    const { container } = render(<KeysPanel backendId="km" />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });

  it("renders nothing, and fetches nothing, when its backend is gone", () => {
    useWidgetRegistryStore.setState({ widgets: [keysWidget] });
    const { container } = render(<KeysPanel backendId="km" />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });

  it("fetches status on mount WITHOUT run_tests and renders the dashboard", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);

    render(<KeysPanel backendId="km" />);

    expect(await screen.findByRole("heading", { name: "FMP" })).toBeInTheDocument();
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    const [backendArg, widgetArg, params] = fetchWidgetData.mock.calls[0];
    expect(backendArg).toBe(keysBackend);
    expect(widgetArg).toBe(keysWidget);
    // seedParams(keysWidget) is { run_tests: "false" }; the mount fetch must
    // not flip it on -- that is the whole point of "status on open".
    expect(params).toEqual({ run_tests: "false" });
  });

  it("probes with run_tests=true only when Check all is clicked", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });
    fetchWidgetData.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    expect(fetchWidgetData.mock.calls[0][2]).toEqual({ run_tests: "true" });
  });

  it("submits a new value through Details then re-probes, and never logs the value", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    putProviderKey.mockResolvedValue({ status: "set", restart_required: true });
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });
    fetchWidgetData.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    await userEvent.type(screen.getByLabelText("New value"), "sk-NEW-SECRET");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(putProviderKey).toHaveBeenCalledWith(keysBackend, keysWidget, "FMP_API_KEY", "sk-NEW-SECRET"),
    );
    // The re-probe after a successful submit is the run_tests fetch.
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    expect(fetchWidgetData.mock.calls[0][2]).toEqual({ run_tests: "true" });
    expect(await screen.findByText(/restart it to pick the key up/i)).toBeInTheDocument();
    expect(__read("logs/bdobb.log") ?? "").not.toContain("sk-NEW-SECRET");
  });

  it("logs a failed submit with the env var but never the value, and shows the fixed failure line", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    putProviderKey.mockRejectedValue(new Error("HTTP 400: bad body"));
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    await userEvent.type(screen.getByLabelText("New value"), "sk-NEW-SECRET");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Save failed. The key was not updated.")).toBeInTheDocument();
    await waitFor(() => {
      const log = __read("logs/bdobb.log") ?? "";
      expect(log).toContain("key submit failed for FMP_API_KEY");
      expect(log).not.toContain("sk-NEW-SECRET");
    });
  });

  it("a re-probe that fails after a successful submit keeps the last-good rows and the restart notice, not an error screen", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValueOnce(keysPayload).mockRejectedValueOnce(new Error("HTTP 503"));
    putProviderKey.mockResolvedValue({ status: "set", restart_required: true });
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    await userEvent.type(screen.getByLabelText("New value"), "sk-NEW-SECRET");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Asserted inside Details, which is still open at this point.
    expect(await screen.findByText(/restart it to pick the key up/i)).toBeInTheDocument();
    // The row is kept on screen -- checked via the card's own Details button
    // rather than a heading query, because Details' <h2> title is also "FMP"
    // while the dialog is open, which would make a heading-role query for
    // "FMP" ambiguous (two matches).
    expect(screen.getByRole("button", { name: "Details for FMP" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // KeysPanel's own notice, not Details' status line (also role="status"),
    // and not ProviderDashboard's ever-present result-count status span --
    // so this is matched by its exact text, not by role.
    expect(screen.getByText("Refresh failed. Showing the last known key status.")).toBeInTheDocument();
    await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("keys status fetch failed"));
  });

  it("shows a non-destructive notice when Refresh fails, keeping the rows on screen, and clears it on the next successful Refresh", async () => {
    connectKeyMaint();
    fetchWidgetData
      .mockResolvedValueOnce(keysPayload)
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce(keysPayload);
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

    // Matched by exact text, not role="status": ProviderDashboard's own
    // result-count span also carries role="status" and is always present,
    // which would make a bare role query ambiguous.
    const notice = await screen.findByText("Refresh failed. Showing the last known key status.");
    expect(notice.textContent).not.toContain("503");
    expect(screen.getByRole("heading", { name: "FMP" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

    await waitFor(() =>
      expect(screen.queryByText("Refresh failed. Showing the last known key status.")).not.toBeInTheDocument(),
    );
  });

  it("guards a stale fetch from a swapped-out backend by request generation", async () => {
    connectKeyMaint();
    let resolveA!: (value: unknown) => void;
    const pendingA = new Promise((resolve) => {
      resolveA = resolve;
    });
    fetchWidgetData.mockReturnValueOnce(pendingA);

    render(<KeysPanel backendId="km" />);
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));

    const widgetB: WidgetDef = { ...keysWidget };
    const backendB: BackendConfig = { ...keysBackend, baseUrl: "http://km2.local" };
    const eodhdPayload = {
      tier: 3,
      rows: [{ provider: "EODHD", env_var: "EODHD_API_KEY", status: "set", demo: false, value: "sk-OTHER" }],
    };
    fetchWidgetData.mockResolvedValueOnce(eodhdPayload);

    act(() => {
      useWidgetRegistryStore.setState({ widgets: [widgetB] });
      useBackendsStore.setState({ backends: [backendB], statuses: {} });
    });

    expect(await screen.findByText("EODHD")).toBeInTheDocument();
    // The dashboard renders the credential inline ("Credential: Own key").
    expect(screen.getByText("Credential: Own key")).toBeInTheDocument();

    // Now let backend A's stale, superseded fetch resolve with the OLD
    // (FMP) payload. The request-generation guard must drop it silently.
    await act(async () => {
      resolveA(keysPayload);
      // Give the resolved-but-superseded promise a turn to (not) land.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByText("FMP")).not.toBeInTheDocument();
    expect(screen.getByText("EODHD")).toBeInTheDocument();
  });

  it("shows a retryable error state when the mount fetch fails, and logs it", async () => {
    connectKeyMaint();
    fetchWidgetData.mockRejectedValueOnce(new Error("HTTP 503")).mockResolvedValueOnce(keysPayload);
    render(<KeysPanel backendId="km" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("keys status fetch failed"));

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("heading", { name: "FMP" })).toBeInTheDocument();
  });

  it("keeps the chosen filter across a Check all refresh", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: /Available/ }));
    expect(screen.getByRole("button", { name: /Available/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Available/ })).toHaveAttribute("aria-pressed", "true");
  });

  // View state (filter/sort) lives in KeysPanel's own useState and survives
  // the tab round trip via SettingsDialog's keysVisited hidden-mount pattern
  // (kept mounted, not remounted) -- this stands in for that with a bare
  // `hidden` wrapper, since KeysPanel's own state persistence needs no
  // special code and does not depend on SettingsDialog itself.
  it("keeps the chosen filter while hidden and shown again (the tab round trip)", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    function Host() {
      const [hidden, setHidden] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setHidden((h) => !h)}>
            toggle
          </button>
          <div hidden={hidden}>
            <KeysPanel backendId="km" />
          </div>
        </>
      );
    }
    render(<Host />);
    await screen.findByRole("heading", { name: "FMP" });
    await userEvent.click(screen.getByRole("button", { name: /Available/ }));
    await userEvent.click(screen.getByRole("button", { name: "toggle" })); // hide
    await userEvent.click(screen.getByRole("button", { name: "toggle" })); // show
    expect(screen.getByRole("button", { name: /Available/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("a single Test preserves a diagnostic code into the Details view", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    testProviderKey.mockResolvedValue({
      result: "error",
      detail: "denied",
      code: "egress_policy_denied",
      checked_at: "2026-09-23T18:30:00Z",
    });
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByText("egress_policy_denied")).toBeInTheDocument();
    expect(screen.getByText(/Connectivity check · key-maint ·/)).toBeInTheDocument();
  });

  // Restored (pass I, lost-test audit): this name was lost when the keys
  // table became the provider dashboard. Ported to Details' Test: exactly one
  // row is re-tested (testProviderKey with that env var) and its result is
  // merged in place -- the button turns into Retest -- and nothing re-probes,
  // so no other vendor is contacted (KeysPanel's testKey, "never fans out").
  it("merges a single-row test result in place without a full re-probe", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    testProviderKey.mockResolvedValue({ result: "ok", detail: "HTTP 200" });
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });
    fetchWidgetData.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));

    await waitFor(() =>
      expect(testProviderKey).toHaveBeenCalledWith(keysBackend, keysWidget, "FMP_API_KEY"),
    );
    expect(await screen.findByRole("button", { name: "Retest" })).toBeInTheDocument();
    expect(fetchWidgetData).not.toHaveBeenCalled();
  });

  // --- Review Focus invariants -------------------------------------------

  // Invariant 1: no rendered DOM text anywhere carries a tier-3 `value`, not
  // the dashboard tiles, not Details, not any debug output path. This is the
  // integration point where the real payload (carrying `value`) flows through
  // KeysPanel into both ProviderDashboard and, once opened, Details.
  it("never renders the tier-3 value, in the dashboard or in Details (Review Focus, invariant 1)", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    const { container } = render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });
    expect(container.textContent).not.toContain("sk-SECRET-TIER3");

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    expect(container.textContent).not.toContain("sk-SECRET-TIER3");
    // Also check every attribute, not just text nodes -- a stray debug prop
    // or title attribute would not show up in textContent.
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(attr.value).not.toContain("sk-SECRET-TIER3");
      }
    }
  });

  // Invariant 2: only Check all (-> onProbe) and a Details submit's re-probe
  // may fetch. Mount, a filter change, a sort change and opening Details must
  // never add a fetch beyond the one cheap status load already covered above.
  it("fetches once on mount and adds no fetch for filter, sort or Details open; Check all adds exactly one (Review Focus, invariant 2)", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    testProviderKey.mockResolvedValue({ result: "ok", detail: "" });
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });
    expect(fetchWidgetData).toHaveBeenCalledTimes(1); // the mount status load

    // "Not checked" (not "Available"): FMP's row carries no `test` result,
    // so it derives to not_checked -- filtering to Available would hide its
    // card and the later Details click below would find no button.
    await userEvent.click(screen.getByRole("button", { name: /Not checked/ })); // filter
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(screen.getByLabelText("Sort"), "attention-first"); // sort
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" })); // Details open
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);

    // Details' own Test/Retest button calls testProviderKey directly and
    // must never trigger a KeysPanel refetch via fetchWidgetData/load().
    await userEvent.click(screen.getByRole("button", { name: "Test" }));
    await waitFor(() => expect(testProviderKey).toHaveBeenCalledTimes(1));
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Done" })); // Details close

    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
  });

  // Invariant 3: with Details open over a parent modal (standing in for
  // Settings, the same idiom SettingsDialog uses via useModalDialog), one
  // Escape closes Details alone through the shared modal stack -- KeysPanel
  // registers no Escape handling of its own, so this exercises the real
  // wiring end to end rather than re-testing useChildDialog in isolation
  // (already covered unit-level in ProviderDetailsDialog.test.tsx).
  it("Escape closes only Details, leaving the parent dialog open (Review Focus, invariant 3)", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    vi.spyOn(HTMLDialogElement.prototype, "showModal");
    vi.spyOn(HTMLDialogElement.prototype, "close");

    function Parent() {
      const [open, setOpen] = useState(true);
      const ref = useModalDialog(() => setOpen(false));
      return (
        <dialog ref={ref} aria-label="Settings">
          {open ? (
            <div hidden={false}>
              settings-body
              <KeysPanel backendId="km" />
            </div>
          ) : null}
        </dialog>
      );
    }
    render(<Parent />);
    await screen.findByRole("heading", { name: "FMP" });
    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    expect(await screen.findByRole("dialog", { name: "FMP" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "FMP" })).not.toBeInTheDocument();
    expect(screen.getByText("settings-body")).toBeInTheDocument();
  });

  it("reads the keys widget on ITS backend only, never the first one found", async () => {
    const otherBackend: BackendConfig = { ...keysBackend, id: "km2", name: "key-maint-2" };
    const otherWidget: WidgetDef = { ...keysWidget, backendId: "km2" };
    useWidgetRegistryStore.setState({ widgets: [keysWidget, otherWidget] });
    useBackendsStore.setState({ backends: [keysBackend, otherBackend], statuses: {} });
    fetchWidgetData.mockResolvedValue(keysPayload);

    render(<KeysPanel backendId="km2" />);

    expect(await screen.findByRole("heading", { name: "FMP" })).toBeInTheDocument();
    const [backendArg, widgetArg] = fetchWidgetData.mock.calls[0];
    expect(backendArg).toBe(otherBackend);
    expect(widgetArg).toBe(otherWidget);
  });
});
