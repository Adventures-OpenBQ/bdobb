// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { backend } from "../../test/fixtures";
import { useBackendsStore } from "../../stores/backendsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { askBackendCredential, askWorkspaceSignIn, decideDashboardConflict, decideDeletedDashboard, decideWorkspaceConflict, WorkspaceConnectionForm, WorkspaceSignInForm } from "./WorkspaceDialogs";

/** Opens an ask*() inside act (it renders into its own root, outside Testing Library's). Returns the answer's promise in a box so awaiting it does not wait for the answer. */
async function start<T>(open: () => Promise<T>): Promise<{ answer: Promise<T> }> {
  const box = {} as { answer: Promise<T> };
  await act(async () => { box.answer = open(); });
  return box;
}
const conn = { id: "ws1", name: "Work", baseUrl: "https://workspace.example" };
const realSignIn = useWorkspaceStore.getState().signIn;
const realSetCredential = useBackendsStore.getState().setCredential;
beforeEach(() => {
  useWorkspaceStore.setState({ signIn: realSignIn, connections: [], usernames: { ws1: "alice" }, sessions: {} });
  useBackendsStore.setState({ setCredential: realSetCredential, backends: [], runtimeCredentials: [] });
});

describe("WorkspaceConnectionForm", () => {
  it("has name, address and Ask for credentials on startup, and no credential fields", async () => {
    const onSubmit = vi.fn(async () => null);
    render(<WorkspaceConnectionForm title="Add Workspace" initial={{ name: "", serverUrl: "", askOnStartup: false }} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
    await userEvent.type(screen.getByLabelText("Name"), "Work");
    await userEvent.type(screen.getByLabelText("Server address"), "https://workspace.example");
    await userEvent.click(screen.getByLabelText("Ask for credentials on startup"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Work", serverUrl: "https://workspace.example", askOnStartup: true });
  });
});

describe("WorkspaceSignInForm", () => {
  it("shows the refusal, clears the password after every attempt, and passes Remember me", async () => {
    const onSubmit = vi.fn(async () => "Sign-in failed. Check the account details and server address.");
    render(<WorkspaceSignInForm title="Sign in to Work" initialUsername="" onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Remember me")).not.toBeChecked();
    await userEvent.type(screen.getByLabelText("Username or email"), "alice");
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByLabelText("Remember me"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Sign-in failed/)).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith("alice", "synthetic-password", true, expect.any(AbortSignal));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByText(/Signing in can replace another OpenBB Workspace session/)).toBeInTheDocument();
  });

  it("shows a rejected submit as an error and re-enables the form", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("network down"); });
    render(<WorkspaceSignInForm title="Sign in to Work" initialUsername="alice" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toBeEnabled();
  });

  it("Cancel during a pending sign-in aborts it", async () => {
    const onCancel = vi.fn();
    let signal!: AbortSignal;
    render(<WorkspaceSignInForm title="Sign in to Work" initialUsername="alice" onCancel={onCancel} onSubmit={(_u, _p, _r, s) => { signal = s; return new Promise(() => {}); }} />);
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
  });
});

describe("askWorkspaceSignIn", () => {
  it("prefills a remembered username with Remember me ticked; Cancel resolves false", async () => {
    const pending = await start(() => askWorkspaceSignIn(conn));
    expect(await screen.findByRole("dialog", { name: "Sign in to Work" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username or email")).toHaveValue("alice");
    expect(screen.getByLabelText("Remember me")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(pending.answer).resolves.toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a Skip-able step at startup, and resolves true once the store signs in", async () => {
    const signIn = vi.fn(async () => null);
    useWorkspaceStore.setState({ signIn });
    const pending = await start(() => askWorkspaceSignIn(conn, "Step 1 of 2"));
    expect(await screen.findByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Password"), "synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await expect(pending.answer).resolves.toBe(true);
    expect(signIn).toHaveBeenCalledWith(conn, "alice", "synthetic-password", true, expect.any(AbortSignal));
  });
});

describe("askBackendCredential", () => {
  const gateway = backend({ id: "g", name: "Gateway", baseUrl: "https://gateway.workspace.example", headerName: "username", askOnStartup: true });

  it("prefills the stored key, gives the value for this run, and skips", async () => {
    const setCredential = vi.fn(async () => {});
    useBackendsStore.setState({ setCredential, backends: [gateway] });
    let pending = await start(() => askBackendCredential(gateway, "Step 1 of 1"));
    expect(await screen.findByLabelText("Key")).toHaveValue("username");
    expect(screen.queryByLabelText("Password")).toBeNull();
    await userEvent.type(screen.getByLabelText("Value"), "admin@workspace.example");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(pending.answer).resolves.toBe("continued");
    expect(setCredential).toHaveBeenCalledWith("g", "username", "admin@workspace.example", false);
    pending = await start(() => askBackendCredential(gateway, "Step 1 of 1"));
    await userEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await expect(pending.answer).resolves.toBe("skipped");
  });

  it("ticks Remember me and prefills the value only when the value is stored on disk", async () => {
    const remembered = { ...gateway, headerValue: "admin@workspace.example" };
    useBackendsStore.setState({ setCredential: vi.fn(async () => {}), backends: [remembered], runtimeCredentials: [] });
    let pending = await start(() => askBackendCredential(remembered, "Step 1 of 1"));
    expect(await screen.findByLabelText("Value")).toHaveValue("admin@workspace.example");
    expect(screen.getByLabelText("Remember me")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await pending.answer;
    useBackendsStore.setState({ runtimeCredentials: ["g"] });
    pending = await start(() => askBackendCredential(remembered, "Step 1 of 1"));
    expect(await screen.findByLabelText("Value")).toHaveValue("");
    expect(screen.getByLabelText("Remember me")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Skip" }));
    await pending.answer;
  });
});

describe("decideWorkspaceConflict", () => {
  it.each([["Use Work", "server"], ["Keep local", "local"]] as const)("lists each differing setting and answers %s", async (button, choice) => {
    const pending = await start(() => decideWorkspaceConflict("Work", ["Theme: dark → light", "Auto-refresh: off → 5"], []));
    expect(await screen.findByText("Theme: dark → light")).toBeInTheDocument();
    expect(screen.getByText("Auto-refresh: off → 5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: button }));
    await expect(pending.answer).resolves.toBe(choice);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("dashboard sync questions", () => {
  it.each([["Use Work", "server"], ["Keep local", "local"], ["Keep both", "both"]] as const)("a changed-on-both question answers %s", async (button, choice) => {
    const pending = await start(() => decideDashboardConflict("Work", "Macro", "Macro (2)"));
    expect(await screen.findByText('Keep both adds Work\'s copy as "Macro (2)".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: button }));
    await expect(pending.answer).resolves.toBe(choice);
  });

  it("focuses Keep both, so Enter takes the default", async () => {
    const pending = await start(() => decideDashboardConflict("Work", "Macro", "Macro (2)"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep both" })).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(pending.answer).resolves.toBe("both");
  });

  it.each([["Delete", "delete"], ["Keep as local", "keep"]] as const)("a deleted-on-server question answers %s, defaulting to Keep as local", async (button, choice) => {
    const pending = await start(() => decideDeletedDashboard("Work", "Macro"));
    expect(await screen.findByRole("dialog", { name: '"Macro" was deleted on Work' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep as local" })).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: button }));
    await expect(pending.answer).resolves.toBe(choice);
  });
});
