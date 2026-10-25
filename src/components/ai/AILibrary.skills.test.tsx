// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/fake/appdata"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: () => Promise.resolve("/imports/ai-library.json"),
  // vi.fn() (not a plain arrow) so a single test can override with
  // mockResolvedValueOnce/mockRejectedValueOnce, as SettingsDialog.test.tsx does.
  save: vi.fn((opts?: { defaultPath?: string }) => Promise.resolve(`/exports/${opts?.defaultPath ?? "ai-library.json"}`)),
}));

// The tabs have their own tests; here they are stubs so the shell's
// behaviour is what is under test.
vi.mock("./AgentsTab", () => ({ AgentsTab: () => <div data-testid="agents-tab" /> }));
vi.mock("./McpServersTab", () => ({ McpServersTab: () => <div data-testid="mcp-tab" /> }));
vi.mock("./ShareTargetsTab", () => ({ ShareTargetsTab: () => <div data-testid="share-tab" /> }));
vi.mock("./AppearanceTab", () => ({ AppearanceTab: () => <div data-testid="appearance-tab" /> }));
// SkillsTab and SkillEditorDialog are NOT stubbed (AILibrary.test.tsx stubs
// SkillsTab for the shell's own tests): the skills-diff tests
// below drive the real Skills tab and editor through the UI, now that they
// exist (Task 14), rather than only calling commitSkills directly.

import { __resetJsonStoreForTests } from "../../lib/jsonStore";
import { __resetLoggerForTests } from "../../lib/logger";
import { DEFAULT_SETTINGS } from "../../lib/settingsFile";
import type { Skill } from "../../lib/skillsFiles";
import { __reset, __seed } from "../../test/memfs";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSkillsStore } from "../../stores/skillsStore";
import { AILibrary, commitSkills, type DraftSkill } from "./AILibrary";

function renderLibrary(props?: { onClose?: () => void }) {
  return render(<AILibrary onClose={props?.onClose ?? vi.fn()} />);
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return { slug: "a", description: "A skill", content: "# A", enabled: true, updated: "", extra: {}, ...overrides };
}

beforeEach(() => {
  __reset();
  __resetLoggerForTests();
  __resetJsonStoreForTests();
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, draft: null });
  useSkillsStore.setState({ skills: [] });
});

describe("commitSkills", () => {
  beforeEach(() => {
    useSkillsStore.setState({ skills: [] });
  });

  it("removes, then writes, then drops a rename's old slug", async () => {
    const a = skill({ slug: "a" });
    const x = skill({ slug: "x", description: "X skill" });
    useSkillsStore.setState({ skills: [a, x] });
    const remove = vi.spyOn(useSkillsStore.getState(), "remove");
    const upsert = vi.spyOn(useSkillsStore.getState(), "upsert");
    const calls: string[] = [];
    remove.mockImplementation((slug) => {
      calls.push(`remove:${slug}`);
      useSkillsStore.setState({ skills: useSkillsStore.getState().skills.filter((s) => s.slug !== slug) });
      return Promise.resolve();
    });
    upsert.mockImplementation((s, previousSlug) => {
      calls.push(`upsert:${s.slug}:${previousSlug ?? ""}`);
      const rest = useSkillsStore.getState().skills.filter((k) => k.slug !== s.slug && k.slug !== previousSlug);
      useSkillsStore.setState({ skills: [...rest, s] });
      return Promise.resolve();
    });

    // Draft: X is removed; A is renamed to B (a rename with a content change
    // so `changed` is true); nothing else is new.
    const entries: DraftSkill[] = [{ ...a, slug: "b", originalSlug: "a" }];
    const reseed = vi.fn();
    const result = await commitSkills(entries, reseed);

    expect(result).toEqual({ ok: true });
    // Removes first, every write next, and the old slug only once written.
    expect(calls).toEqual(["remove:x", "upsert:b:", "remove:a"]);
  });

  // Review U4: renames applied one at a time deleted a folder another entry
  // had just been written to.
  it("keeps every skill through a cyclic rename (alpha→gamma, beta→alpha, gamma→beta)", async () => {
    vi.restoreAllMocks(); // the tests above spy on the store's upsert/remove
    const { loadSkills } = await import("../../lib/skillsFiles");
    for (const slug of ["alpha", "beta", "gamma"]) await useSkillsStore.getState().upsert(skill({ slug, content: `${slug} body` }));
    const stored = useSkillsStore.getState().skills;
    const by = (slug: string) => stored.find((x) => x.slug === slug)!;
    const entries: DraftSkill[] = [
      { ...by("alpha"), slug: "gamma", originalSlug: "alpha" },
      { ...by("beta"), slug: "alpha", originalSlug: "beta" },
      { ...by("gamma"), slug: "beta", originalSlug: "gamma" },
    ];
    expect(await commitSkills(entries, vi.fn())).toEqual({ ok: true });
    const mine = new Set(["alpha", "beta", "gamma"]);
    const disk = (await loadSkills()).filter((x) => mine.has(x.slug)).map((x) => [x.slug, x.content]).sort();
    expect(disk).toEqual([["alpha", "beta body"], ["beta", "gamma body"], ["gamma", "alpha body"]]);
    expect(useSkillsStore.getState().skills.map((x) => x.slug).filter((x) => mine.has(x))).toEqual(["alpha", "beta", "gamma"]);
  });

  it("a plain rename leaves only the new slug", async () => {
    vi.restoreAllMocks(); // the tests above spy on the store's upsert/remove
    const { loadSkills } = await import("../../lib/skillsFiles");
    await useSkillsStore.getState().upsert(skill({ slug: "old" }));
    const [old] = useSkillsStore.getState().skills;
    expect(await commitSkills([{ ...old, slug: "new", originalSlug: "old" }], vi.fn())).toEqual({ ok: true });
    const slugs = (await loadSkills()).map((x) => x.slug);
    expect(slugs).toContain("new");
    expect(slugs).not.toContain("old");
  });

  it("a failing upsert keeps the dialog open and re-seeds the draft", async () => {
    const a = skill({ slug: "a" });
    useSkillsStore.setState({ skills: [a] });
    const upsert = vi.spyOn(useSkillsStore.getState(), "upsert").mockRejectedValueOnce(new Error("disk full"));
    const entries: DraftSkill[] = [{ ...a, description: "Changed", originalSlug: "a" }];
    const reseed = vi.fn();

    const result = await commitSkills(entries, reseed);

    expect(result).toEqual({ ok: false, error: "a: disk full" });
    // Re-seeded from the store's post-failure state (still just `a`, unchanged).
    expect(reseed).toHaveBeenCalledWith([{ ...a, originalSlug: "a" }]);

    // A second attempt with the store now updated (as if the caller fixed
    // the disk and retried with the unchanged entry) resolves and calls
    // upsert exactly once more.
    upsert.mockResolvedValueOnce(undefined);
    const retry = await commitSkills(entries, reseed);
    expect(retry).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

describe("AILibrary Skills tab (through the UI)", () => {
  beforeEach(() => {
    useSkillsStore.setState({ skills: [] });
  });

  it("a rename writes the new slug and drops the old one after, the removal first, driven through the Skills tab and editor", async () => {
    const a = skill({ slug: "a" });
    const x = skill({ slug: "x", description: "X skill" });
    useSkillsStore.setState({ skills: [a, x] });
    const remove = vi.spyOn(useSkillsStore.getState(), "remove");
    const upsert = vi.spyOn(useSkillsStore.getState(), "upsert");
    const calls: string[] = [];
    remove.mockImplementation((slug) => {
      calls.push(`remove:${slug}`);
      useSkillsStore.setState({ skills: useSkillsStore.getState().skills.filter((s) => s.slug !== slug) });
      return Promise.resolve();
    });
    upsert.mockImplementation((s, previousSlug) => {
      calls.push(`upsert:${s.slug}:${previousSlug ?? ""}`);
      const rest = useSkillsStore.getState().skills.filter((k) => k.slug !== s.slug && k.slug !== previousSlug);
      useSkillsStore.setState({ skills: [...rest, s] });
      return Promise.resolve();
    });

    const onClose = vi.fn();
    renderLibrary({ onClose });
    await userEvent.click(screen.getByRole("tab", { name: "Skills" }));
    // Stage a removal (x) and a rename (a -> b) in the local draft; neither
    // touches the store until Done.
    await userEvent.click(screen.getByRole("button", { name: "Remove x" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit a" }));
    await userEvent.clear(screen.getByLabelText("Slug"));
    await userEvent.type(screen.getByLabelText("Slug"), "b");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(remove).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Removes first, the write next, the renamed-away slug last.
    expect(calls).toEqual(["remove:x", "upsert:b:", "remove:a"]);
    expect(useSkillsStore.getState().skills.map((s) => s.slug)).toEqual(["b"]);
  });

  it("a failing upsert keeps the dialog open with the error and reverts the edit; redoing it and Done again resolves", async () => {
    const a = skill({ slug: "a" });
    useSkillsStore.setState({ skills: [a] });
    const upsert = vi.spyOn(useSkillsStore.getState(), "upsert").mockRejectedValueOnce(new Error("disk full"));

    const onClose = vi.fn();
    renderLibrary({ onClose });
    await userEvent.click(screen.getByRole("tab", { name: "Skills" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit a" }));
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Changed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByText("a: disk full")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // commitSkills re-seeded `entries` from the store's post-failure state
    // (unchanged), so the failed edit no longer shows in the draft.
    expect(screen.getByText("A skill")).toBeInTheDocument();

    // The user redoes the edit and retries; this time the write lands.
    upsert.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Edit a" }));
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Changed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // The mock doesn't itself write to the store (that's commitSkills'/the
    // real store's own job, covered by the direct commitSkills tests
    // above); here what matters is that the retry re-sent the redone edit.
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ slug: "a", description: "Changed" }));
  });

  it("re-seeds the settings draft after a skills failure so further edits still stage", async () => {
    // Same failure setup as the test above: commitDraft succeeds (nulling
    // the settings draft) and commitSkills then fails, which used to leave
    // stageDraft as a silent no-op for the rest of the session.
    const a = skill({ slug: "a" });
    useSkillsStore.setState({ skills: [a] });
    vi.spyOn(useSkillsStore.getState(), "upsert").mockRejectedValueOnce(new Error("disk full"));

    const onClose = vi.fn();
    renderLibrary({ onClose });
    await userEvent.click(screen.getByRole("tab", { name: "Skills" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit a" }));
    await userEvent.clear(screen.getByLabelText("Description"));
    await userEvent.type(screen.getByLabelText("Description"), "Changed");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByText("a: disk full")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    // The dialog is still open with the skills error, but the settings
    // draft commitDraft nulled must have been re-opened -- otherwise a
    // further tab edit's stageDraft silently drops the user's change.
    expect(useSettingsStore.getState().draft).not.toBeNull();
    useSettingsStore.getState().stageDraft({ theme: "dark" });
    expect(useSettingsStore.getState().draft?.patch).toEqual({ theme: "dark" });
  });
});
