// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

// The lint gate: `pnpm lint`, run by .githooks/pre-push (with typecheck) and
// by scripts/ci.sh. It exists for the two classes of bug the unit suite does
// not reliably catch -- a hook with a wrong or missing dependency, and markup
// a keyboard or screen-reader user cannot operate -- so those rule sets are
// the point, and everything else is kept deliberately light:
//
// - react-hooks: ONLY rules-of-hooks and exhaustive-deps. The plugin's v7
//   "recommended" set also enables the React Compiler rules, which this app
//   does not use.
// - typescript-eslint's recommended set WITHOUT type information: type-aware
//   rules would roughly double the pre-push time, and `tsc --noEmit` already
//   runs in the same hook.
// - no formatter: the style is already consistent by hand, and a formatter
//   would rewrite ~60% of src in one commit while fixes are still being
//   cherry-picked onto older release lines. Revisit once those are done.
//
// Violations that already existed when this gate was added are recorded in
// eslint-suppressions.json (ESLint's bulk suppressions): they do not fail
// the gate, but any NEW violation does, and a suppressed one that is fixed
// drops out of the file on `pnpm lint --prune-suppressions`.
import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      // Vercel build output: prebuilt function bundle, not source.
      ".vercel/**",
      "node_modules/**",
      // Immutable dependency licensing evidence retains upstream source verbatim.
      "LICENSES/dependency-evidence/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      ".reference-backend/**",
      ".superpowers/**",
      // Other branches checked out as git worktrees live INSIDE this
      // directory; linting them would report another commit's code (the
      // same trap vite.config.ts's test exclude documents).
      ".claude/**",
      "docs/**",
      "playwright-report/**",
      "e2e-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // tsconfig's noUnusedLocals / noUnusedParameters already enforce this,
      // with the compiler's own understanding of what counts as used.
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["src/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    files: ["scripts/**/*.{js,mjs}", "e2e/**/*.ts", "*.config.{js,ts}",
      // The Vercel web function and the reference-demo deploy scripts run on Node.
      "web/**/*.mjs", "deploy/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
);
