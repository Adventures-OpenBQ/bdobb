# BDOBB application icons

The application identity is three ascending bars with visible X/Y axes, using
the app's `#22C99B` dark-mode accent, `#16A67F` light-mode accent and `#12161D`
dark background. It is related to the Art's Charts wordmark but does not
replace the chart watermark or individual navigation/tool glyphs.

## Sources and shipped files

| Surface | Source | Shipped assets |
|---|---|---|
| macOS Dock/application | `src/assets/branding/bdobb-macos.svg` | `src-tauri/icons/icon.icns` |
| Windows/Linux | Desktop master, micro favicon for tiny ICO frames | `src-tauri/icons/icon.ico` and PNGs |
| iPadOS/iOS | `src/assets/branding/bdobb-app-square.svg` | `src-tauri/icons/apple/AppIcon.appiconset` |
| Browser tab | `public/favicon.svg`, pixel-aligned at 16px | SVG, multi-frame ICO, PNG fallbacks |
| Apple web shortcut | Square app master | `public/apple-touch-icon.png` |
| Installed web | Square/maskable masters | `public/site.webmanifest` and 192/512px PNGs |
| Inline application identity | `src/assets/branding/bdobb-mark-currentcolor.svg` | Import/inline and inherit `color: var(--accent)` |

The macOS master has an inset rounded tile with a transparent exterior. The
Apple mobile master is opaque and square; never feed the desktop icon to an
iOS export, or the system mask will surround an extra inset tile. The light
SVG is optional artwork, not an automatically configured iOS appearance slot.

The manifest assumes deployment at `/`. It supplies installation metadata,
not a service worker or offline support. The browser's pre-login screen uses
the same chart mark and icon links as the authenticated document.

## Apple project lifecycle

`src-tauri/gen/` remains gitignored. `pnpm ios:init` copies the committed Apple
catalog into the generated project, and Tauri's `beforeDevCommand` and
`beforeBuildCommand` repeat that sync for already-initialized projects.
Existing users do not need to regenerate their Xcode project just to update
the icon. Direct Xcode users should run `node scripts/sync-ios-icons.mjs`
before rebuilding.

Sync skips desktop-only checkouts, validates every catalog reference before
copying, and fails if an existing Apple project lacks its expected catalog.
It never edits signing/project files or desktop icons. Old unreferenced PNG
names may remain in the generated catalog; its replaced `Contents.json`
selects only the new artwork.

## Web privacy boundary

Only the exact branding filenames listed in `web/server.mjs` are available
without authentication, so browser/OS icon fetches work without cookies.
They contain no credentials, user state or private app content. The
allowlist accepts only GET without query parameters and preserves the
existing cross-site checks; it is not a general `public/` directory route.
The manifest is served as `application/manifest+json`. App HTML, bundles,
API routes and dashboard state remain authenticated.

## Regeneration

Normal builds use committed exports and need only the existing Node toolchain.
For artwork changes, edit the SVG masters and regenerate the raster containers:

```sh
python -m pip install cairosvg pillow
python scripts/export-icons.py
pnpm test:run src/lib/appIcons.test.ts scripts/sync-ios-icons.test.mjs scripts/ios.test.mjs
pnpm test:web
```

The exporter preserves separate desktop and mobile sources, custom micro
favicon frames and the 32px-first Windows ICO directory. Review the image
diffs before committing; renderer/library versions can change PNG encoding.
Do not use a blanket `tauri icon` invocation to overwrite all platforms from
one source.

Final release checks on Apple hardware: rebuild/reinstall, inspect the Dock
and iPad Home Screen, and verify the browser tab and Add to Home Screen icon.
OS/browser icon caches may outlive an application update.
