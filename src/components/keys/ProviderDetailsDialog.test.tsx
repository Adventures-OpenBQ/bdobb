// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeysRow } from "../renderers/KeysRenderer";
import { deriveProvider } from "../../lib/providerAvailability";
import { useModalDialog } from "../../hooks/useModalDialog";
import { ProviderDetailsDialog } from "./ProviderDetailsDialog";

const derive = (r: Partial<KeysRow> & Pick<KeysRow, "provider" | "env_var" | "status">) => deriveProvider(r as KeysRow);

// Spy without replacing behaviour -- jsdom's stand-in (src/test/setup.ts)
// already implements showModal/close (setting/clearing `open`, which is what
// gives the element its accessible role="dialog"); a full vi.fn() replacement
// would stub that away and every getByRole("dialog", ...) query would find
// nothing to match, same pattern as SkillEditorDialog.test.tsx and
// useChildDialog.test.tsx.
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal");
  vi.spyOn(HTMLDialogElement.prototype, "close");
});

describe("ProviderDetailsDialog", () => {
  it("shows status, credential and explanation in a live status region", () => {
    const p = derive({ provider: "FMP", env_var: "FMP_API_KEY", status: "set", test: { result: "ok", detail: "HTTP 200" } });
    render(<ProviderDetailsDialog provider={p} tier={2} backendName="key-maint" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "FMP" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Available");
    expect(screen.getByText("Credential: Own key")).toBeInTheDocument();
    expect(screen.getByText("HTTP 200")).toBeInTheDocument();
  });

  it("renders the diagnostic block with the backend name and a not-recorded time when checked_at is absent", () => {
    const p = derive({ provider: "Feed", env_var: "FEED", status: "empty", auth: "not_required", test: { result: "no_response", detail: "denied", code: "egress_policy_denied" } });
    render(<ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Connectivity check · km · time not recorded/)).toBeInTheDocument();
    expect(screen.getByText("egress_policy_denied")).toBeInTheDocument();
    expect(screen.getByText("What happened")).toBeInTheDocument();
    expect(screen.getByText(/Review the data backend/)).toBeInTheDocument(); // firewall "what to check"
  });

  it("shows the keyless notice when no key is required and there is no code", () => {
    const p = derive({ provider: "yf", env_var: "YF", status: "empty", auth: "not_required", test: { result: "ok", detail: "passed" } });
    render(<ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText("This provider needs no credential. Availability still depends on the latest service test.")).toBeInTheDocument();
  });

  it("labels the action Test with no result and Retest with one; onTest fires once with the env var", async () => {
    const untested = derive({ provider: "P", env_var: "P_KEY", status: "set" });
    const onTest = vi.fn();
    const { rerender } = render(<ProviderDetailsDialog provider={untested} tier={2} backendName="km" onClose={vi.fn()} onTest={onTest} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Test" })).toBeInTheDocument();
    const tested = derive({ provider: "P", env_var: "P_KEY", status: "set", test: { result: "ok", detail: "" } });
    rerender(<ProviderDetailsDialog provider={tested} tier={2} backendName="km" onClose={vi.fn()} onTest={onTest} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Retest" }));
    // toHaveBeenCalledExactlyOnceWith is unavailable in this vitest version
    // (Invalid Chai property) -- the brief's own documented fallback.
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onTest).toHaveBeenCalledWith("P_KEY");
  });

  it("Manage key shows only at tier 3, clears the field before awaiting, and shows the restart notice", async () => {
    const p = derive({ provider: "P", env_var: "P_KEY", status: "set" });
    let resolve!: (v: { restart_required?: boolean }) => void;
    const onSubmit = vi.fn(() => new Promise<{ restart_required?: boolean }>((r) => { resolve = r; }));
    const { rerender } = render(<ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={onSubmit} />);
    expect(screen.queryByRole("button", { name: "Manage key" })).toBeNull();
    rerender(<ProviderDetailsDialog provider={p} tier={3} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    await userEvent.type(screen.getByLabelText("New value"), "sk-NEW");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith("P_KEY", "sk-NEW");
    // Field is gone (cleared) before the promise settles.
    expect(screen.queryByLabelText("New value")).toBeNull();
    resolve({ restart_required: true });
    expect(await screen.findByText(/Restart it to pick the key up/)).toBeInTheDocument();
  });

  it("shows the fixed failure line and never the rejection text", async () => {
    const p = derive({ provider: "P", env_var: "P_KEY", status: "set" });
    const onSubmit = vi.fn().mockRejectedValue(new Error("HTTP 400: https://x?key=sk-LEAK"));
    render(<ProviderDetailsDialog provider={p} tier={3} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    await userEvent.type(screen.getByLabelText("New value"), "sk-LEAK");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Save failed. The key was not updated.")).toBeInTheDocument();
    expect(screen.queryByText(/sk-LEAK/)).toBeNull();
  });

  it("closes the Manage-key form and drops its draft when the tier drops below 3", async () => {
    const p = derive({ provider: "P", env_var: "P_KEY", status: "set" });
    const { rerender } = render(<ProviderDetailsDialog provider={p} tier={3} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Manage key" }));
    await userEvent.type(screen.getByLabelText("New value"), "sk-DRAFT");
    rerender(<ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByLabelText("New value")).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage key" })).toBeNull();
  });

  it("lists each check on its own line when checks are present", () => {
    const p = derive({
      provider: "Hist",
      env_var: "HIST_KEY",
      status: "set",
      test: { result: "no_response", detail: "timeout", kind: "connectivity", code: "connect_timeout", checked_at: "2026-09-23T12:01:00Z" },
      checks: [
        { kind: "credential", result: "ok", detail: "accepted", checked_at: "2026-09-23T12:01:00Z" },
        { kind: "connectivity", result: "no_response", detail: "timeout", code: "connect_timeout", checked_at: "2026-09-23T12:01:00Z" },
      ],
    });
    render(<ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText(/Credential check · vendor accepted the key ·/)).toBeInTheDocument();
    expect(screen.getByText(/Connectivity check · Timed out ·/)).toBeInTheDocument();
    // The worse connectivity code still shows its What happened / What to check.
    expect(screen.getByText("What to check")).toBeInTheDocument();
  });

  it("a not_installed provider offers no Retest and no connectivity block (Review Focus)", () => {
    const p = derive({ provider: "Congress", env_var: "CONGRESS_KEY", provider_id: "congress_gov", supported: false, status: "empty", test: { result: "skipped", detail: "n/a", code: "not_installed" } });
    render(<ProviderDetailsDialog provider={p} tier={3} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Not installed");
    expect(screen.getByText("Not installed on this backend")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retest" })).toBeNull();
    expect(screen.queryByText("What happened")).toBeNull();
    // Manage key is still available at tier 3 (the credential can be set even
    // though the provider is not installed).
    expect(screen.getByRole("button", { name: "Manage key" })).toBeInTheDocument();
  });

  it("renders no tier-3 value anywhere (Review Focus)", () => {
    const p = deriveProvider({ provider: "P", env_var: "P_KEY", status: "set", value: "sk-SECRET" } as KeysRow);
    const { container } = render(<ProviderDetailsDialog provider={p} tier={3} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(container.textContent).not.toContain("sk-SECRET");
  });

  it("Escape closes only this dialog via the shared modal stack; the parent stays open", async () => {
    // A parent using useModalDialog (Settings) with the Details child mounted
    // after it: the sub-project 2 stack routes one Escape to the child alone.
    function Parent() {
      const [open, setOpen] = useState(true);
      const ref = useModalDialog(() => setOpen(false));
      const p = derive({ provider: "P", env_var: "P_KEY", status: "set" });
      // Mounted false, then flipped true from an effect that only fires
      // after the parent's own useModalDialog mount effect has already
      // pushed its modalStack entry -- mirroring the real app, where the
      // Details child opens from a LATER user action (a rail-row click)
      // once Settings is already open, never in the same initial commit.
      // useChildDialog's doc comment states this ordering explicitly: "this
      // child pushes AFTER the parent pushed its own, [so] the child is on
      // top." Mounting both dialogs in ONE commit does not hold that
      // invariant -- React fires passive effects bottom-up (children
      // before parents), so the child would push first and the parent
      // would end up on top of modalStack, and Escape would close the
      // wrong dialog. That is a harness bug, not a component bug: the
      // component adds no Escape handling of its own by design.
      const [childOpen, setChildOpen] = useState(false);
      useEffect(() => {
        setChildOpen(true);
      }, []);
      return (
        <dialog ref={ref} aria-label="Settings">
          {open ? "settings-body" : null}
          {open && childOpen ? (
            <ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={() => setChildOpen(false)} onTest={vi.fn()} onSubmit={vi.fn()} />
          ) : null}
        </dialog>
      );
    }
    render(<Parent />);
    expect(await screen.findByRole("dialog", { name: "P" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "P" })).toBeNull();
    expect(screen.getByText("settings-body")).toBeInTheDocument();
  });

  it("shows the API usage block with reset, extra balance and as-of time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T14:48:00Z"));
    try {
      const checkedAt = "2026-10-17T14:48:00Z";
      const p = derive({
        provider: "EODHD", env_var: "EODHD_API_KEY", status: "set",
        test: { result: "ok", detail: "HTTP 200", checked_at: checkedAt },
        checks: [{ result: "ok", detail: "HTTP 200", kind: "credential", checked_at: checkedAt,
          usage: { used: 1234, limit: 100000, window: "day", resets_at: "2026-10-18T00:00:00Z", extra: 5000 } }],
      });
      render(<ProviderDetailsDialog provider={p} tier={2} backendName="key-maint" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
      expect(screen.getByText("API usage")).toBeInTheDocument();
      expect(screen.getByText(`${(1234).toLocaleString()} of ${(100000).toLocaleString()} calls today (1.2%)`)).toBeInTheDocument();
      expect(screen.getByText("Resets 00:00 UTC · in 9h 12m")).toBeInTheDocument();
      expect(screen.getByText(`Extra calls remaining: ${(5000).toLocaleString()}`)).toBeInTheDocument();
      expect(screen.getByText(`As of ${new Date(checkedAt).toLocaleString()}`)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits the optional usage lines and the whole block when absent", () => {
    const p = derive({
      provider: "EIA", env_var: "EIA_API_KEY", status: "set", test: { result: "ok", detail: "HTTP 200" },
      checks: [{ result: "ok", detail: "HTTP 200", kind: "credential", usage: { used: 1, limit: 1000, window: "hour", extra: 0 } }],
    });
    const { unmount } = render(<ProviderDetailsDialog provider={p} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText(`1 of ${(1000).toLocaleString()} calls this hour (0.1%)`)).toBeInTheDocument();
    expect(screen.queryByText(/^Resets/)).toBeNull();
    expect(screen.queryByText(/^Extra calls/)).toBeNull();
    expect(screen.getByText("As of time not recorded")).toBeInTheDocument();
    unmount();

    const none = derive({ provider: "FRED", env_var: "FRED_API_KEY", status: "set", test: { result: "ok", detail: "HTTP 200" } });
    render(<ProviderDetailsDialog provider={none} tier={2} backendName="km" onClose={vi.fn()} onTest={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByText("API usage")).toBeNull();
  });
});
