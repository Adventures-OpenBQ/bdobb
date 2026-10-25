// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { create } from "zustand";
import { serialize } from "../lib/serialize";
import { deleteSkill, loadSkills, saveSkill, type Skill } from "../lib/skillsFiles";

type SkillsState = {
  skills: Skill[];
  load: () => Promise<void>;
  /** Writes `skill`; when `previousSlug` differs, that folder is deleted afterwards (a rename). */
  upsert: (skill: Skill, previousSlug?: string) => Promise<void>;
  remove: (slug: string) => Promise<void>;
  setEnabled: (slug: string, enabled: boolean) => Promise<void>;
};

const bySlug = (a: Skill, b: Skill) => a.slug.localeCompare(b.slug);

export const useSkillsStore = create<SkillsState>((set, get) => {
  // Chains every action that touches the skills folder, as backendsStore
  // does for backends.json: each read-mutate-write step runs only after the
  // previous one has both written to disk and published via set().
  const enqueue = <T,>(step: () => Promise<T>) => serialize("store:skills", step);

  return {
    skills: [],

    load: () =>
      enqueue(async () => {
        set({ skills: await loadSkills() });
      }),

    upsert: (skill, previousSlug) =>
      enqueue(async () => {
        await saveSkill(skill);
        if (previousSlug !== undefined && previousSlug !== skill.slug) await deleteSkill(previousSlug);
        const rest = get().skills.filter((s) => s.slug !== skill.slug && s.slug !== previousSlug);
        set({ skills: [...rest, skill].sort(bySlug) });
      }),

    remove: (slug) =>
      enqueue(async () => {
        await deleteSkill(slug);
        set({ skills: get().skills.filter((s) => s.slug !== slug) });
      }),

    setEnabled: (slug, enabled) =>
      enqueue(async () => {
        const current = get().skills.find((s) => s.slug === slug);
        if (!current) return;
        const next = { ...current, enabled, updated: new Date().toISOString() };
        await saveSkill(next);
        set({ skills: get().skills.map((s) => (s.slug === slug ? next : s)) });
      }),
  };
});
