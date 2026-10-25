// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactNode, SVGProps } from "react";

/**
 * The six fixed rail rows, each with its own glyph, and `workspace`, the one
 * glyph every workspace row carries. Dashboard and folder rows have none --
 * their names and their kbd badges do that job.
 */
export type RailIconName = "add" | "library" | "apps" | "workspace" | "connections" | "settings" | "help";

type Glyph = {
  viewBox: string;
  /** Painted with var(--accent) instead of inheriting the row's colour. */
  accent?: true;
  /** Fill/stroke mode: the two supplied glyphs paint themselves, the three drawn here do not. */
  paint: SVGProps<SVGSVGElement>;
  body: ReactNode;
};

/** The gear's eight teeth, as rotations about the 24x24 box's centre. */
const GEAR_TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

const GLYPHS: Record<RailIconName, Glyph> = {
  // A plus, in the same green the tab bar's quick-add button uses -- this row
  // IS the quick-add action, and it is the rail's only accented glyph. Two
  // round-capped strokes rather than a filled cross: one width to tune.
  add: {
    viewBox: "0 0 24 24",
    accent: true,
    paint: { fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" },
    body: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
  },
  // Three book spines on a shelf. Rects, not path data: a rounded rectangle
  // written as a path is four arcs of noise for a shape the element already
  // names.
  library: {
    viewBox: "0 0 24 24",
    paint: { fill: "currentColor" },
    body: (
      <>
        <rect x="3" y="4" width="4" height="16" rx="1" />
        <rect x="9" y="4" width="4" height="16" rx="1" />
        <rect x="15" y="4" width="4" height="16" rx="1" />
      </>
    ),
  },
  // A 2x2 grid of tiles: 7x7 each with a 2 gap, so the block spans 4..20 and
  // sits centred in the 24 box without a transform.
  apps: {
    viewBox: "0 0 24 24",
    paint: { fill: "currentColor" },
    body: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </>
    ),
  },
  // A workspace's row: a rounded square holding a wide bar over a narrow one,
  // with a small tile beside the first -- a page laid out in panels, which is
  // what a workspace is. "Layout" by M Yudi Maulana, from the Noun Project
  // (https://thenounproject.com/icon/layout-3135559/), CC BY 3.0 -- see
  // src/assets/icons/LICENSE.md. The path is the published one, untouched,
  // with the credit text dropped (the download's two <text> lines, which sit
  // below the artwork) and the viewBox cropped from 42x52.5 to 42x42, the
  // square the artwork sits in with the source's own 5-unit margin. The
  // source also fills each of the three openings with a <rect> one unit
  // smaller all round, so that a pane is a filled shape ringed by a hairline;
  // those three rects are left out here. At 20px the hairline is half a
  // pixel and the published drawing reads as a solid square -- without the
  // rects the panes are open, and show as the rail's background through the
  // block (the user's ruling, 2026-10-01). Drawn in the interface's text
  // colour instead of black.
  workspace: {
    viewBox: "0 0 42 42",
    paint: { fill: "currentColor" },
    body: (
      <path d="M27,5H15A10,10,0,0,0,5,15V27A10,10,0,0,0,15,37H27A10,10,0,0,0,37,27V15A10,10,0,0,0,27,5ZM10.5,14A1.498,1.498,0,0,1,12,12.5H22A1.498,1.498,0,0,1,23.5,14v5A1.498,1.498,0,0,1,22,20.5H12A1.498,1.498,0,0,1,10.5,19Zm21,14A1.498,1.498,0,0,1,30,29.5H12A1.498,1.498,0,0,1,10.5,28V24A1.498,1.498,0,0,1,12,22.5H30A1.498,1.498,0,0,1,31.5,24Zm0-9A1.498,1.498,0,0,1,30,20.5H27A1.498,1.498,0,0,1,25.5,19V14A1.498,1.498,0,0,1,27,12.5h3A1.498,1.498,0,0,1,31.5,14Z" />
    ),
  },
  // The Connections row: nodes joined by links, which is what a set of
  // backend connections is. "connection" by Muh Syafri, from the Noun Project (https://thenounproject.com/icon/connection-8239243/),
  // CC BY 3.0 -- see src/assets/icons/LICENSE.md. Drawing as published: one
  // path, whose fill-rule is evenodd (it is what leaves each node a ring).
  // Changes: the download's two <text> credit lines dropped, and the viewBox
  // cropped from 110x135 to the 100x100 box the artwork sits in.
  connections: {
    viewBox: "0 0 100 100",
    paint: { fill: "currentColor" },
    body: (
      <path
        fillRule="evenodd"
        d="m20.141 21.152 17.863 14.887c-1.7969 2.625-2.8477 5.8008-2.8477 9.2188 0 2.1719 0.42578 4.2422 1.1953 6.1406l-11.883 6.1992c-1.9844-2.75-5.2148-4.5391-8.8633-4.5391-6.0273 0-10.922 4.8945-10.922 10.926 0 6.0273 4.8945 10.922 10.922 10.922 6.0312 0 10.926-4.8945 10.926-10.922 0-1.2695-0.21875-2.4883-0.61328-3.6211l11.883-6.1992c2.4883 3.8164 6.5273 6.5312 11.223 7.2461l-0.94531 16.684c-4.2266 0.53125-7.5039 4.1445-7.5039 8.5156 0 4.7383 3.8477 8.5859 8.5859 8.5859 4.7383 0 8.582-3.8477 8.582-8.5859 0-4.0352-2.793-7.4258-6.5469-8.3398l0.94141-16.684c5.5586-0.21484 10.41-3.207 13.195-7.6289l14.895 7.4883c-0.16406 0.62109-0.25391 1.2734-0.25391 1.9492 0 4.1992 3.4141 7.6094 7.6133 7.6094 4.1992 0 7.6094-3.4102 7.6094-7.6094s-3.4102-7.6094-7.6094-7.6094c-2.4102 0-4.5586 1.1211-5.9531 2.8711l-14.895-7.4883c0.71484-1.8359 1.1055-3.8281 1.1055-5.9102 0-3.6602-1.2031-7.0352-3.2344-9.7578l12.691-11.484c1.8945 1.5703 4.3242 2.5156 6.9688 2.5156 6.0312 0 10.926-4.8984 10.926-10.926 0-6.0273-4.8945-10.922-10.926-10.922-6.0273 0-10.922 4.8945-10.922 10.922 0 2.2578 0.68359 4.3555 1.8594 6.0938l-12.691 11.488c-2.9062-2.6523-6.7734-4.2734-11.016-4.2734-4.4805 0-8.543 1.8086-11.496 4.7305l-17.867-14.887c0.80859-1.3867 1.2734-2.9961 1.2734-4.7109 0-5.168-4.1953-9.3633-9.3633-9.3633s-9.3633 4.1953-9.3633 9.3633c0 5.1641 4.1953 9.3633 9.3633 9.3633 2.3242 0 4.4531-0.85156 6.0938-2.2578zm29.02 59.996c3.0156 0 5.4609 2.4453 5.4609 5.4609s-2.4453 5.4648-5.4609 5.4648-5.4648-2.4492-5.4648-5.4648 2.4492-5.4609 5.4648-5.4609zm-33.555-24.969c4.3086 0 7.8047 3.4961 7.8047 7.8047 0 4.3047-3.4961 7.8008-7.8047 7.8008-4.3047 0-7.8008-3.4961-7.8008-7.8008 0-4.3086 3.4961-7.8047 7.8008-7.8047zm71.98 2.7266c2.4766 0 4.4883 2.0117 4.4883 4.4883 0 2.4766-2.0117 4.4883-4.4883 4.4883-2.4805 0-4.4922-2.0117-4.4922-4.4883 0-2.4766 2.0117-4.4883 4.4922-4.4883zm-36.086-26.871c7.2969 0 13.223 5.9219 13.223 13.223 0 7.2969-5.9258 13.219-13.223 13.219s-13.223-5.9219-13.223-13.219c0-7.3008 5.9258-13.223 13.223-13.223zm32.77-24.23c4.3086 0 7.8047 3.4922 7.8047 7.8008 0 4.3086-3.4961 7.8047-7.8047 7.8047-4.3047 0-7.8008-3.4961-7.8008-7.8047 0-4.3086 3.4961-7.8008 7.8008-7.8008zm-70.223 0c3.4453 0 6.2422 2.793 6.2422 6.2422 0 3.4453-2.7969 6.2422-6.2422 6.2422s-6.2422-2.7969-6.2422-6.2422c0-3.4492 2.7969-6.2422 6.2422-6.2422z"
      />
    ),
  },
  // A cog: eight identical teeth rotated about (12,12), over an annulus
  // drawn as two arcs with fill-rule evenodd -- which is what hollows the
  // centre. Outer radius 7.4, inner 4.4; the teeth start at 1.6 and run to
  // 5.4 so they overlap the ring rather than float above it.
  settings: {
    viewBox: "0 0 24 24",
    paint: { fill: "currentColor" },
    body: (
      <>
        {GEAR_TEETH.map((deg) => (
          <path key={deg} d="M10.6 1.6h2.8v3.8h-2.8z" transform={`rotate(${deg} 12 12)`} />
        ))}
        <path
          fillRule="evenodd"
          d="M12 4.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8zm0 3a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8z"
        />
      </>
    ),
  },
  // A question mark in a ring. Stroked, not filled, so it reads at 20px:
  // the ring, the hook, and a short round-capped stub for the dot (a real
  // zero-length subpath is not portably painted).
  help: {
    viewBox: "0 0 24 24",
    paint: { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" },
    body: (
      <>
        <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
        <path d="M9.4 9.3a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.8.7-.8 1.4v.6" />
        <path d="M12 16.8v1.2" />
      </>
    ),
  },
};

/**
 * One inline glyph for a fixed rail row or a workspace row. Decorative by construction: the row
 * carries the accessible name, so the svg is aria-hidden and unfocusable.
 * No props beyond `name` -- no size, no title, no colour override.
 */
export function RailIcon({ name }: { name: RailIconName }) {
  const glyph = GLYPHS[name];
  return (
    <svg
      className={glyph.accent ? "rail-icon rail-icon-accent" : "rail-icon"}
      width="20"
      height="20"
      viewBox={glyph.viewBox}
      aria-hidden="true"
      focusable="false"
      {...glyph.paint}
    >
      {glyph.body}
    </svg>
  );
}
