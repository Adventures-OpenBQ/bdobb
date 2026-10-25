// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { Skill } from "../../lib/skillsFiles";

/**
 * A skill as it sits in the draft: `originalSlug` is null for a brand new
 * entry, else the slug it was loaded/renamed from -- commitSkills' rename
 * detection and upsert's `previousSlug` both read it.
 *
 * Its own module rather than living on AILibrary: SkillEditorDialog and
 * SkillsTab both need this type, and AILibrary imports both of them, so a
 * DraftSkill import from AILibrary would cycle back through it.
 */
export type DraftSkill = Skill & { originalSlug: string | null };
