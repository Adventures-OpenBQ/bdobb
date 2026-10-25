# Plan: workspace minimum resolution, uniform zoom and the Workspaces dialog

Spec: docs/superpowers/specs/2026-10-12-resolution-default-workspace-design.md
(second revision). Each task is red → green → refactor, with the gates
(`tsc --noEmit`, `eslint`, the touched vitest files) run after each.

1. `src/lib/screenFit.ts` replaces `screenClass.ts`: `MinResolution`,
   `MIN_RES_LIMITS`, `COMMON_SIZES`, `zoomFor`, `fits`, `pickLaunchWorkspace`,
   `listScreens`, `readLaunchScreen` (moved unchanged). Tests first, porting
   the readLaunchScreen cases.
2. `workspacesFile.ts`: drop `defaultFor`; add `minResolution` and
   `openAtLaunch` with validation. Tests first.
3. `workspacesStore.ts`: draft gains `minResolution` and `openAtLaunch`;
   `effectiveWorkspace` and `commitDraft` carry them; Duplicate drops
   `openAtLaunch`; `setDefaultFor`/`launchWorkspaceFor` become
   `setOpenAtLaunch`. Tests first.
4. `bootstrap.ts`: `openLaunchWorkspace` uses `pickLaunchWorkspace`. Tests.
5. `railMenu.ts` + `LeftRail.tsx`: one "Open at launch" checkbox item. Tests.
6. `WorkspaceGrid.tsx` + `useScreenSize` hook + CSS: the zoom wrapper, 1 while
   arranging. Tests.
7. `WorkspaceDialog.tsx` + `dialogs.css`: header, notice strip, sidebar cards,
   minimum select with Custom, launch checkbox, dirty bar, Save/Open/Delete.
   Existing dialog tests updated for Save/Open; new tests for each piece.
8. Help topic and guide; PR description; per-OS qualification list.
9. `useScreenSize` follows monitor moves (spec §4.1): `readCurrentScreen` in
   `screenFit.ts`; the hook re-reads it on mount, `resize`, and the window's
   `onMoved`/`onScaleChanged` (debounced 150 ms), falling back to
   `window.screen`, dropping stale reads. Browser shim gains `onMoved`/
   `onScaleChanged`. Tests first.
