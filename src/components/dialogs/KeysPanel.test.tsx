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
import { useProviderKeysStore } from "../../stores/providerKeysStore";
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

const keysPayload = {
  tier: 3,
  rows: [{ provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false, value: "sk-SECRET" }],
};

// Carries every field a real tier-3, fully-populated key-maint row can have,
// including the four the hand-off must ALSO strip besides `value`
// (provider_id, supported, auth, checks) — see "hands the store exactly the
// five safe fields" below.
const fullTierThreeRow = {
  provider: "FMP",
  env_var: "FMP_API_KEY",
  provider_id: "fmp",
  supported: true,
  status: "set" as const,
  demo: false,
  value: "sk-SECRET-DO-NOT-LEAK",
  auth: "required" as const,
  test: { result: "ok", detail: "" },
  checks: [{ result: "ok", detail: "" }],
};

const REAL_REFRESH = useProviderKeysStore.getState().refresh;
const REAL_APPLY = useProviderKeysStore.getState().applyKeyMaintRows;

function connectKeyMaint() {
  useWidgetRegistryStore.setState({ widgets: [keysWidget] });
  useBackendsStore.setState({ backends: [keysBackend], statuses: {} });
}

/**
 * A minimal stand-in for the real enclosing dialog (SettingsDialog's
 * Provider-keys tab), built from the SAME useModalDialog hook SettingsDialog
 * itself uses rather than mounting SettingsDialog's full tree (which drags in
 * Tauri fs/dialog plugins, foldersStore and settingsStore). It exercises the
 * real modalStack mechanism: a child dialog (Details, via useChildDialog)
 * pushes its entry after this one's, so it sits on top and one Escape closes
 * only it -- exactly the "closes an open edit form on Escape and leaves the
 * list up" case ConnectionsDialog.test.tsx covers for its own child editor.
 */
function SettingsHarness({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalDialog(onClose);
  return (
    <dialog ref={dialogRef} aria-label="Settings">
      <KeysPanel backendId="km" />
    </dialog>
  );
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  useWidgetRegistryStore.setState({ widgets: [] });
  useBackendsStore.setState({ backends: [], statuses: {} });
  fetchWidgetData.mockReset();
  testProviderKey.mockReset();
  putProviderKey.mockReset();
  // The store's real action is captured at module load and put back here:
  // the tests below replace it with a spy, and vi.restoreAllMocks() does not
  // undo a setState (same reason WidgetLibrary.test.tsx keeps REAL_ACTIONS).
  useProviderKeysStore.setState({
    status: {},
    probe: {},
    source: "none",
    refresh: REAL_REFRESH,
    applyKeyMaintRows: REAL_APPLY,
  });
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

  it("reads the keys widget on ITS backend only, never the first one found", async () => {
    const otherBackend: BackendConfig = { ...keysBackend, id: "km2", name: "key-maint-2" };
    const otherWidget: WidgetDef = { ...keysWidget, backendId: "km2" };
    useWidgetRegistryStore.setState({ widgets: [keysWidget, otherWidget] });
    useBackendsStore.setState({ backends: [keysBackend, otherBackend], statuses: {} });
    fetchWidgetData.mockResolvedValue(keysPayload);

    render(<KeysPanel backendId="km2" />);

    expect(await screen.findByRole("heading", { name: "FMP" })).toBeInTheDocument();
    const [backend, widget] = fetchWidgetData.mock.calls[0];
    expect(backend).toBe(otherBackend);
    expect(widget).toBe(otherWidget);
  });

  it("fetches status on mount WITHOUT run_tests and renders the dashboard", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);

    render(<KeysPanel backendId="km" />);

    expect(await screen.findByRole("heading", { name: "FMP" })).toBeInTheDocument();
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    const [backend, widget, params] = fetchWidgetData.mock.calls[0];
    expect(backend).toBe(keysBackend);
    expect(widget).toBe(keysWidget);
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
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(1));
    expect(fetchWidgetData.mock.calls[0][2]).toEqual({ run_tests: "true" });
    expect(await screen.findByText(/restart it to pick the key up/i)).toBeInTheDocument();
    expect(__read("logs/bdobb.log") ?? "").not.toContain("sk-NEW-SECRET");
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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // KeysPanel's own notice, matched by exact text rather than role="status"
    // since ProviderDashboard's own result-count span also carries that role.
    expect(screen.getByText("Refresh failed. Showing the last known key status.")).toBeInTheDocument();
    await waitFor(() => expect(__read("logs/bdobb.log") ?? "").toContain("keys status fetch failed"));
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
    expect(screen.getByText("Credential: Own key")).toBeInTheDocument();

    await act(async () => {
      resolveA(keysPayload);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByText("FMP")).not.toBeInTheDocument();
    expect(screen.getByText("EODHD")).toBeInTheDocument();
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

  it("a single Test in Details preserves a diagnostic code and calls onTest once", async () => {
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
    expect(testProviderKey).toHaveBeenCalledTimes(1);
  });

  it("merges key-maint's {checks, test} reply so a Retest refreshes checks and usage", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    const usage = { used: 42, limit: 100000, window: "day" };
    const credential = { result: "ok", detail: "HTTP 200", kind: "credential", checked_at: "2026-10-17T14:48:00Z", usage };
    testProviderKey.mockResolvedValue({ checks: [credential], test: credential });
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    await userEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(await screen.findByText(`42 of ${(100000).toLocaleString()} calls today (0.0%)`)).toBeInTheDocument();
    expect(screen.getByText(/Credential check · /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retest" })).toBeInTheDocument();
  });

  // Review-Focus-pinned invariant: a tier-3 row's `value` is the plaintext
  // credential. Nothing in the dashboard or Details ever reads `row.value`,
  // so it must never surface anywhere in the rendered DOM -- not as text,
  // not as an attribute (e.g. a stray `title` or `value=` on an unrelated
  // input) -- regardless of which view is open.
  it("never renders a tier-3 row's plaintext value anywhere in the DOM", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload); // value: "sk-SECRET"
    const { container } = render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });

    expect(container.innerHTML).not.toContain("sk-SECRET");

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    expect(await screen.findByRole("dialog", { name: "FMP" })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("sk-SECRET");

    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    expect(container.innerHTML).not.toContain("sk-SECRET");
  });

  it("does not fetch beyond the mount load on filter, sort, or Details-open; Check all fetches exactly once more", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    render(<KeysPanel backendId="km" />);
    await screen.findByRole("heading", { name: "FMP" });
    expect(fetchWidgetData).toHaveBeenCalledTimes(1); // the mount load only

    // "Not checked" (not "Available"): FMP's row here has no `test` result,
    // so it is itself in the not_checked category -- filtering to Available
    // would hide the card this test still needs to click Details on.
    await userEvent.click(screen.getByRole("button", { name: /Not checked/ }));
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);

    await userEvent.selectOptions(screen.getByRole("combobox"), "name-desc");
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    expect(await screen.findByRole("dialog", { name: "FMP" })).toBeInTheDocument();
    expect(fetchWidgetData).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));
    await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
  });

  // Details (ProviderDetailsDialog) is a useChildDialog stacked over the
  // panel's actual host (SettingsDialog's Provider-keys tab). Exercised here
  // against a minimal stand-in built from the SAME useModalDialog hook
  // SettingsDialog uses, so the assertion is against the real modalStack
  // mechanism rather than a mock of it.
  it("Escape closes only the open Details dialog, not an enclosing Settings dialog", async () => {
    connectKeyMaint();
    fetchWidgetData.mockResolvedValue(keysPayload);
    const onClose = vi.fn();
    render(<SettingsHarness onClose={onClose} />);
    await screen.findByRole("heading", { name: "FMP" });

    await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
    expect(screen.getByRole("dialog", { name: "FMP" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "FMP" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // D4: the Library's provider badges take their colour from
  // providerKeysStore's probe map, so a Key Maintenance probe has to reach it
  // -- otherwise the badges keep showing the state before the refresh. v4 is
  // the owning line for this bridge; the render below it changed (table ->
  // dashboard + Details) but this hand-off did not.
  describe("keeps providerKeysStore in step (the applyKeyMaintRows hand-off)", () => {
    /** Replaces the store's own action, which would otherwise recompute state. */
    function spyOnApply() {
      const applyKeyMaintRows = vi.fn();
      useProviderKeysStore.setState({ applyKeyMaintRows });
      return applyKeyMaintRows;
    }

    it("does not touch the store on the plain status fetch at mount", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValue(keysPayload);
      const apply = spyOnApply();

      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      expect(apply).not.toHaveBeenCalled();
    });

    it("hands the store the probed rows after a successful Check all", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValue(keysPayload);
      const apply = spyOnApply();
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      expect(apply).toHaveBeenCalledWith([
        { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false },
      ]);
      expect(fetchWidgetData).toHaveBeenCalledTimes(2); // mount + Check all, nothing more
    });

    // The C9 addition: a fully-populated tier-3 row carries provider_id,
    // supported, auth and checks besides value -- none of those five may
    // reach the store either, only the five explicitly re-mapped fields.
    it("hands the store exactly the five safe fields, dropping value/provider_id/supported/auth/checks", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValue({ tier: 3, rows: [fullTierThreeRow] });
      const apply = spyOnApply();
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      const [rows] = apply.mock.calls[0] as [Array<Record<string, unknown>>];
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(Object.keys(row).sort()).toEqual(["demo", "env_var", "provider", "status", "test"]);
      for (const forbidden of ["value", "provider_id", "supported", "auth", "checks"]) {
        expect(row).not.toHaveProperty(forbidden);
      }
    });

    it("skips a row that is not an object rather than failing the whole probe", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValue({
        tier: 3,
        rows: [null, { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false }, "not a row"],
      });
      const apply = spyOnApply();
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      expect(apply).toHaveBeenCalledWith([
        { provider: "FMP", env_var: "FMP_API_KEY", status: "set", demo: false },
      ]);
      expect(screen.queryByText(/refresh failed/i)).not.toBeInTheDocument();
      expect(__read("logs/bdobb.log") ?? "").not.toContain("keys status fetch failed");
    });

    it("hands the store the rows after a successful submit, whose re-probe is a Check all", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValue(keysPayload);
      putProviderKey.mockResolvedValue({ status: "set", restart_required: false });
      const apply = spyOnApply();
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Details for FMP" }));
      await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
      await userEvent.type(screen.getByLabelText("New value"), "sk-NEW-SECRET");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    });

    it("does not touch the store when the probe itself failed", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValueOnce(keysPayload).mockRejectedValueOnce(new Error("HTTP 503"));
      const apply = spyOnApply();
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

      await screen.findByText("Refresh failed. Showing the last known key status.");
      expect(apply).not.toHaveBeenCalled();
    });

    it("ignores a probe whose payload is not the keys shape", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValueOnce(keysPayload).mockResolvedValueOnce({ unexpected: true });
      const apply = spyOnApply();
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

      await waitFor(() => expect(fetchWidgetData).toHaveBeenCalledTimes(2));
      expect(apply).not.toHaveBeenCalled();
    });

    it("colours the Library's badges from the rows it just probed", async () => {
      connectKeyMaint();
      fetchWidgetData.mockResolvedValue({
        tier: 3,
        rows: [{ provider: "FMP", env_var: "FMP_API_KEY", status: "set", test: { result: "ok", detail: "" } }],
      });
      render(<KeysPanel backendId="km" />);
      await screen.findByRole("heading", { name: "FMP" });

      await userEvent.click(screen.getByRole("button", { name: "Check all providers" }));

      await waitFor(() => expect(useProviderKeysStore.getState().probe.fmp).toBe("green"));
      expect(useProviderKeysStore.getState().source).toBe("key-maint");
    });
  });
});
