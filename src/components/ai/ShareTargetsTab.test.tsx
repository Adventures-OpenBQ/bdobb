// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import type { ShareTarget } from "../../lib/shareTargets";
import { __reset } from "../../test/memfs";
import { selectEffective, useSettingsStore } from "../../stores/settingsStore";
import { ShareTargetsTab } from "./ShareTargetsTab";

const realSave = useSettingsStore.getState().save;
const notes: ShareTarget = {
  id: "t1",
  name: "Notes",
  kind: "http",
  url: "https://notes.example/in",
  template: '{"title":"{{title}}"}',
  headers: { Authorization: "Bearer x" },
};

const targets = () => selectEffective(useSettingsStore.getState()).shareTargets;

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, save: realSave, draft: null });
  // A draft must already be open for stageDraft to do anything -- AILibrary's
  // beginDraft() on mount, reproduced here since this tab is also rendered
  // standalone in these tests (see McpServersTab.test.tsx for the same setup).
  useSettingsStore.getState().beginDraft();
});

describe("ShareTargetsTab — a race between two edits", () => {
  // Staging is synchronous now (no pending save to race): the risk is two
  // handlers firing in the SAME batch before a re-render -- reading the
  // store fresh at call time (rather than the closed-over `targets` render
  // snapshot) is what keeps both edits, the same mechanism McpServersTab's
  // currentServers() relies on.
  it("keeps a rename that lands just before a second edit fires, ahead of this component's own re-render", () => {
    const wiki: ShareTarget = { ...notes, id: "t2", name: "Wiki" };
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, shareTargets: [notes, wiki] } });
    render(<ShareTargetsTab />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
    const form = screen.getByRole("form", { name: "Edit Notes" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Journal" } });

    // Rename Notes to Journal and remove Wiki in the SAME act() batch, so
    // neither handler's fresh read has yet observed the other's write via a
    // re-render.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Save target" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove Wiki" }));
    });

    expect(targets()).toEqual([{ ...notes, name: "Journal" }]);
  });
});

describe("ShareTargetsTab — the list", () => {
  it("says so when there are none", () => {
    render(<ShareTargetsTab />);
    expect(screen.getByText("No targets yet.")).toBeInTheDocument();
  });

  it("lists each target and removes by id, staging the shorter list", async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, shareTargets: [notes, { ...notes, id: "t2", name: "Wiki" }] },
    });
    render(<ShareTargetsTab />);
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Wiki")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Notes" }));
    await waitFor(() => expect(targets().map((t) => t.id)).toEqual(["t2"]));
  });

  // Review-focus: commitDraft compares staged arrays to the snapshot by
  // reference, so every staged shareTargets write must be a genuinely new
  // array -- never the same reference staged twice, and never a mutation of
  // the existing one.
  it("stages shareTargets as a fresh array on remove", () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, shareTargets: [notes] } });
    render(<ShareTargetsTab />);
    const before = useSettingsStore.getState().settings.shareTargets;
    fireEvent.click(screen.getByRole("button", { name: "Remove Notes" }));
    const staged = useSettingsStore.getState().draft?.patch.shareTargets;
    expect(staged).not.toBe(before);
    expect(staged).toEqual([]);
  });
});

describe("ShareTargetsTab — the form", () => {
  it("adds an http target with headers and clears the form", async () => {
    render(<ShareTargetsTab />);
    await userEvent.type(screen.getByLabelText("Name"), "Notes");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "http");
    await userEvent.type(screen.getByLabelText("URL"), "https://notes.example/in");
    await userEvent.type(screen.getByLabelText("Headers"), "Authorization: Bearer x");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(targets()).toHaveLength(1));
    const saved = targets()[0];
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved).toMatchObject({
      name: "Notes",
      kind: "http",
      url: "https://notes.example/in",
      headers: { Authorization: "Bearer x" },
    });
    expect(saved.tool).toBeUndefined();
    expect(JSON.parse(saved.template)).toEqual({ title: "{{title}}", markdown: "{{markdown}}" });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("shows the Tool field for mcp and requires it", async () => {
    render(<ShareTargetsTab />);
    expect(screen.queryByLabelText("Tool")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Vault");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "mcp");
    await userEvent.type(screen.getByLabelText("URL"), "https://mcp.example/mcp");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Tool name is required for an MCP target.");
    expect(targets()).toEqual([]);
    await userEvent.type(screen.getByLabelText("Tool"), "save_note");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(targets()[0]).toMatchObject({ kind: "mcp", tool: "save_note" }));
    expect(targets()[0].headers).toBeUndefined();
  });

  it("takes a folder path for file", async () => {
    render(<ShareTargetsTab />);
    await userEvent.type(screen.getByLabelText("Name"), "Desk");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "file");
    await userEvent.type(screen.getByLabelText("Folder"), "/Users/me/Notes"); // scrub-allow: a made-up folder, not a real home
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(targets()[0]).toMatchObject({ kind: "file", url: "/Users/me/Notes" })); // scrub-allow: a made-up folder, not a real home
  });

  it("rejects a template that is not a JSON object on blur, and on Save", async () => {
    render(<ShareTargetsTab />);
    const template = screen.getByLabelText("Template");
    await userEvent.clear(template);
    await userEvent.type(template, "[[1, 2]");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Template must be a JSON object.");
    await userEvent.type(screen.getByLabelText("Name"), "Notes");
    await userEvent.type(screen.getByLabelText("URL"), "https://notes.example/in");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(useSettingsStore.getState().draft?.patch.shareTargets).toBeUndefined();
  });

  it("does not let a valid Headers blur wipe a Template error already shown", async () => {
    render(<ShareTargetsTab />);
    const template = screen.getByLabelText("Template");
    await userEvent.clear(template);
    await userEvent.type(template, "[[1, 2]");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Template must be a JSON object.");

    await userEvent.type(screen.getByLabelText("Headers"), "Authorization: Bearer x");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Template must be a JSON object.");
  });

  it("rejects malformed headers on blur", async () => {
    render(<ShareTargetsTab />);
    await userEvent.type(screen.getByLabelText("Headers"), "no colon here");
    await userEvent.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Headers must be one Key: value per line.");
  });

  it("requires a name and an http(s) URL", async () => {
    render(<ShareTargetsTab />);
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required.");
    await userEvent.type(screen.getByLabelText("Name"), "Notes");
    await userEvent.type(screen.getByLabelText("URL"), "notes.example");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an http(s) URL.");
    expect(targets()).toEqual([]);
  });

  it("edits an existing target in place and can cancel", async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, shareTargets: [notes] } });
    render(<ShareTargetsTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
    const form = screen.getByRole("form", { name: "Edit Notes" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Notes");
    expect(within(form).getByLabelText("Headers")).toHaveValue("Authorization: Bearer x");
    await userEvent.clear(within(form).getByLabelText("Name"));
    await userEvent.type(within(form).getByLabelText("Name"), "Journal");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    await waitFor(() => expect(targets()).toEqual([{ ...notes, name: "Journal" }]));
    expect(screen.getByRole("form", { name: "Add target" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Journal" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("form", { name: "Add target" })).toBeInTheDocument();
  });
});
