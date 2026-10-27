// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/**
 * The `panels` widget parameter (spec: panels and series): a percentage
 * layout of a card's chart panels, one lightweight-charts instance per
 * panel. The wire/UI text is `;`-joined rows, each row six comma-joined
 * numbers -- `top,left,width,height` as a percent of the card body, then
 * `xmargin,ymargin` in pixels, or `P<n>` to INHERIT panel n's -- followed by any number of `key=value`
 * extras. Only four extra keys exist: `xs`/`xe` (date expressions bounding
 * the panel's own x-range, or `P<n>` -- 1-based -- taking panel n's own
 * `xs`/`xe`, and where it has none the edge it is actually showing: the
 * loaded window's) and `ymin`/`ymax` (a fixed number, or `P<n>` borrowing
 * another panel's own y-scale). Default:
 * `DEFAULT_PANELS_TEXT`, a price panel over a volume panel, 70/30.
 *
 * This module is the pure codec plus `scaleOrder`, which topologically
 * sorts panels by their `ymin`/`ymax` references so the renderer can scale
 * a borrowed axis only after its source panel has been scaled, and reports
 * any reference cycle instead of looping forever, plus any panel that is
 * merely downstream of one. Nothing here touches lightweight-charts or
 * React -- that is T3's job.
 *
 * The four geometry fields also accept EXPRESSIONS (user, 2026-09-26), which
 * this module resolves to the plain numbers every consumer already reads
 * (`panelRect`, `axisAlign`, PanelHost, the apps.json codec, the mini-map) --
 * so nothing downstream changes -- while keeping the expression as written on
 * a `*Expr` field for round-tripping and so the editor can tell a relative
 * field from a literal one. There are two grammars, chosen by the field:
 *
 *   - `top` and `left` are POSITIONS. They take an EDGE anchor: `CT`/`CB` and
 *     `P<n>T`/`P<n>B` for `top` (the chart's or panel n's top/bottom edge),
 *     `CL`/`CR` and `P<n>L`/`P<n>R` for `left`, each with an optional `± n`
 *     percentage-point offset. `P2.left = P1R+2` puts P2 two points right of
 *     P1's right edge -- the whole "steal space from a neighbour" mechanism.
 *     `R`/`B` are anchors you REFERENCE (a panel's right edge is `left+width`,
 *     its bottom `top+height`, computed the same way `overlapRects` does), not
 *     fields you set: there is no `right` or `bottom` field.
 *   - `width` and `height` are EXTENTS. They take a bare `P<n>` meaning that
 *     panel's size on the SAME axis, with `*`/`/` scaling and an optional
 *     `± n`: `P1/2` is half of P1, `P1*2/3` two thirds, `P1/2-2` half minus 2
 *     points. Multiplicative binds tighter than additive; only the first
 *     operand is an anchor.
 *
 * Resolution reuses the same cycle machinery as the y-scale references: a
 * loop, a reference to a missing panel, a cross-axis anchor (`left = P1T`), a
 * bare `P<n>` where an edge belongs, or an anchored operand where an extent
 * belongs is refused into `problems`, the offending field dropped to a literal
 * -- never silently resolved to a plausible-looking wrong number. Every chain
 * must bottom out in a literal or a chart anchor (0/100); one that cannot is
 * reported as underdetermined per axis. After resolution, each panel's numbers
 * are range-checked (positions in 0..100, extents positive, and the panel must
 * fit: `left+width <= 100`, `top+height <= 100`) -- arithmetic makes an
 * out-of-range result reachable from valid inputs, so the check is on the
 * RESULT, and it is reported, never clamped. Pure-literal panels saved before
 * this feature are checked too, so a hand-typed `height: 110` is caught.
 */
export type PanelDef = {
  top: number;
  left: number;
  width: number;
  height: number; // percent of the card body
  xmargin: number;
  ymargin: number; // pixels -- always RESOLVED, so nothing downstream knows about references
  /**
   * The panel (1-based) this margin was written as inheriting from -- `P1` in the margin's
   * place (the owner's design, 2026-09-21: "If P1 has a margin of 25 and P2 has P1 in that
   * field, then it would inherit the 25"). Alignment between panels is STATED, the way
   * `ymin=P1` states a shared scale. Kept only so the text round-trips as written.
   */
  xmarginRef?: number;
  ymarginRef?: number;
  /**
   * The geometry EXPRESSION each field was written as, when it is not a plain
   * number -- `top`/`left` an edge anchor (`P1R+2`, `CB`), `width`/`height` an
   * extent (`P1/2`, `P1*2/3`). The resolved value stays in `top`/`left`/
   * `width`/`height`, exactly as before; this is kept only so the text
   * round-trips as written and so a consumer can tell a RELATIVE field (this
   * present) from a LITERAL one (this absent) without re-parsing -- the mini-map
   * shades them differently and the resize tool offers a handle only on a
   * literal edge, because a relative one follows its anchor. A field whose
   * reference could not be resolved is dropped back to a literal (this cleared)
   * and reported in `problems`.
   */
  topExpr?: string;
  leftExpr?: string;
  widthExpr?: string;
  heightExpr?: string;
  xs?: string | { ref: number };
  xe?: string | { ref: number }; // date expressions, resolved by the caller (S/E/T-grammar) -- opaque here; `ref` is another panel's 1-based number (user ruling 2026-09-24)
  ymin?: number | { ref: number };
  ymax?: number | { ref: number }; // `ref` is another panel's 1-based number
};

// 64 and not 56 (v12.4.8): the margin is now OBEYED (axisAlign.ts), and the
// library needs 62px to draw a two-decimal price such as `336.00`. At 56 an
// ordinary equity chart fell back to one decimal out of the box.
export const DEFAULT_PANELS_TEXT = `{
  "P1": {"top": 0, "left": 0, "width": 100, "height": 70, "xmargin": 24, "ymargin": 64},
  "P2": {"top": 70, "left": 0, "width": 100, "height": 30, "xmargin": 24, "ymargin": 64}
}`;

const EXTRA_KEYS = ["xs", "xe", "ymin", "ymax"] as const;

function isRefKey(key: string): key is "ymin" | "ymax" {
  return key === "ymin" || key === "ymax";
}

/** `P<n>` -> `{ ref: n }`, a bare finite number -> itself, anything else -> undefined (caller records the problem). */
function parseRefValue(value: string): number | { ref: number } | undefined {
  const p = /^P(\d+)$/.exec(value);
  if (p) return { ref: Number(p[1]) };
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const HEAD_KEYS = ["top", "left", "width", "height", "xmargin", "ymargin"] as const;

// ---- geometry expression grammar (user, 2026-09-26) ----
// `top`/`left` (fields 0/1) parse as EDGES; `width`/`height` (fields 2/3) as
// EXTENTS. `GEOM_KEYS` is the four field names in row order, and `EXPR_FIELD`
// maps each to the PanelDef property that carries its written expression.
const GEOM_KEYS = ["top", "left", "width", "height"] as const;
const EXPR_FIELD = { top: "topExpr", left: "leftExpr", width: "widthExpr", height: "heightExpr" } as const;

type Side = "L" | "R" | "T" | "B";
// An edge anchor: a chart edge (`panel` undefined) or panel n's edge, plus a
// signed percentage-point offset. Its side gives its axis: L/R are x, T/B y.
type Edge = { panel?: number; side: Side; offset: number };
// An extent: panel n's size on this field's axis, with `*`/`/` scalings and
// `+`/`-` offsets in the order written (only the first operand is the anchor).
type Ext = { ref: number; ops: { op: "*" | "/" | "+" | "-"; num: number }[] };

// The chart's own edges. All four are concrete, which is what lets a chain of
// references bottom out: `CL`/`CT` are 0, `CR`/`CB` are 100.
const CHART_EDGE: Record<Side, number> = { L: 0, R: 100, T: 0, B: 100 };
const sideAxis = (s: Side): "x" | "y" => (s === "L" || s === "R" ? "x" : "y");

/** `CR-2`, `P1R+2`, `cb` -> an Edge; anything else (a bare number, `P1`, `P1*2`) -> undefined. */
function parseEdge(field: string): Edge | undefined {
  const m = /^\s*(?:C|P(\d+))([LRTB])\s*([+-]\s*\d+(?:\.\d+)?)?\s*$/i.exec(field);
  if (m === null) return undefined;
  return {
    panel: m[1] === undefined ? undefined : Number(m[1]),
    side: m[2].toUpperCase() as Side,
    offset: m[3] === undefined ? 0 : Number(m[3].replace(/\s+/g, "")),
  };
}

/** `P1`, `P1/2`, `P1*2/3`, `P1/2-2` -> an Ext; anything else (a number, `P1R`, `CR`) -> undefined. */
function parseExt(field: string): Ext | undefined {
  const m = /^\s*P(\d+)((?:\s*[*/+-]\s*\d+(?:\.\d+)?)*)\s*$/i.exec(field);
  if (m === null) return undefined;
  const ops: Ext["ops"] = [];
  for (const t of m[2].matchAll(/([*/+-])\s*(\d+(?:\.\d+)?)/g)) {
    ops.push({ op: t[1] as Ext["ops"][number]["op"], num: Number(t[2]) });
  }
  return { ref: Number(m[1]), ops };
}

/**
 * Evaluate an extent's op chain against its anchor value, standard precedence:
 * `*`/`/` bind tighter than `+`/`-`, each folded left-to-right. So `P1*2/3` is
 * `(P1*2)/3` and `P1/2-2` is `(P1/2)-2`.
 */
function applyOps(base: number, ops: Ext["ops"]): number {
  const operands: number[] = [base];
  const adds: ("+" | "-")[] = [];
  for (const { op, num } of ops) {
    if (op === "*") operands[operands.length - 1] *= num;
    else if (op === "/") operands[operands.length - 1] /= num;
    else { operands.push(num); adds.push(op); }
  }
  let out = operands[0];
  adds.forEach((op, k) => { out = op === "+" ? out + operands[k + 1] : out - operands[k + 1]; });
  return out;
}

/**
 * The dict form (v12.4.12, user ruling 2026-09-21: "I want the stored format to make
 * sense"): `{"P1": {"top": 0, ...}, "P2": {...}}`, one panel per line, keyed by the
 * names every reference already uses. Read by REWRITING each panel as a compact row and
 * handing it to the one validator below -- so the two forms cannot come to mean
 * different things, and every rule (margins, references, extras) exists once.
 *
 * Single quotes are taken as a Python dict's, on a second try only: the first parse is
 * strict JSON, which is what `encodePanels` writes.
 * ponytail: a setting whose VALUE holds a comma or a semicolon (a group named
 * "Rates, EU") splits wrongly on the way through the compact row -- the limit the
 * compact text always had. Upgrade path: validate the dict directly, once one does.
 */
function dictRows(text: string, problems: string[]): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch {
    try { parsed = JSON.parse(text.replace(/'/g, '"')); } catch (err) {
      problems.push(`panels: not a valid dict (${(err as Error).message})`);
      return [];
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    problems.push("panels: expected a dict of panels, P1, P2, ...");
    return [];
  }
  const rows: string[] = [];
  Object.entries(parsed).forEach(([name, value], i) => {
    const n = i + 1;
    if (name !== `P${n}`) problems.push(`panel ${n}: is named "${name}", expected "P${n}" -- panels are numbered in order`);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`panel ${n}: expected a dict`);
      return;
    }
    const panel = value as Record<string, unknown>;
    const missing = HEAD_KEYS.find((key) => panel[key] === undefined);
    if (missing !== undefined) { problems.push(`panel ${n}: "${missing}" is missing`); return; }
    const extras = Object.keys(panel).filter((key) => !(HEAD_KEYS as readonly string[]).includes(key));
    rows.push([...HEAD_KEYS.map((key) => String(panel[key])), ...extras.map((key) => `${key}=${String(panel[key])}`)].join(","));
  });
  return rows;
}

/**
 * Text -> panels, never throwing: a malformed row or extra is skipped (or,
 * for a value, just left unset) and recorded in `problems` naming the row
 * -- the editor shows these next to the field rather than losing the rest
 * of a mostly-good paste. Row numbers count `;`-separated segments in the
 * given text (blank segments, e.g. a trailing `;`, are dropped first and
 * do not consume a number); a row that fails the six-number prefix never
 * becomes a panel, so a LATER validation pass (missing-panel references,
 * below) necessarily numbers against the successfully parsed list instead
 * -- the two can only disagree when a text mixes a malformed row with a
 * dangling `P<n>`, which nothing here needs to get right.
 */
export function parsePanels(text: string): { panels: PanelDef[]; problems: string[] } {
  const problems: string[] = [];
  const panels: PanelDef[] = [];
  // Either form: a dict (what is written since v12.4.12) or the compact rows a card
  // saved before then still holds.
  const rows = text.trim().startsWith("{")
    ? dictRows(text.trim(), problems)
    : text.split(";").map((row) => row.trim()).filter((row) => row !== "");

  // The parsed form of each panel's four geometry fields, index-aligned with
  // `panels`: a plain number for a literal, an Edge (top/left) or Ext
  // (width/height) for an expression. Resolved into the panels below.
  const rawGeom: { top: number | Edge; left: number | Edge; width: number | Ext; height: number | Ext }[] = [];

  rows.forEach((row, i) => {
    const n = i + 1;
    const fields = row.split(",").map((f) => f.trim());
    if (fields.length < 6) {
      problems.push(`panel ${n}: expected 6 numbers, got ${fields.length}`);
      return;
    }
    // Geometry (top,left = edges; width,height = extents): each field is its
    // own expression or a plain number as every card wrote them before the
    // grammar. A field that is neither (a typo, or a bare `P1` where an edge
    // needs a side) is rejected exactly like any other non-number, naming it.
    const geom: (number | Edge | Ext)[] = [];
    let bad = -1;
    for (let at = 0; at < 4; at += 1) {
      const parsed = at < 2 ? parseEdge(fields[at]) : parseExt(fields[at]);
      if (parsed !== undefined) { geom.push(parsed); continue; }
      const num = Number(fields[at]);
      if (Number.isFinite(num)) { geom.push(num); continue; }
      bad = at; break;
    }
    if (bad !== -1) {
      problems.push(`panel ${n}: field ${bad + 1} ("${fields[bad]}") is not a number`);
      return;
    }
    // The two margin places may name a panel instead; it is resolved once every row is in.
    const marginRef = (field: string): number | undefined => {
      const match = /^P(\d+)$/.exec(field);
      return match ? Number(match[1]) : undefined;
    };
    const xRef = marginRef(fields[4]);
    const yRef = marginRef(fields[5]);
    const xmargin = xRef !== undefined ? 0 : Number(fields[4]);
    const ymargin = yRef !== undefined ? 0 : Number(fields[5]);
    if (!Number.isFinite(xmargin)) { problems.push(`panel ${n}: field 5 ("${fields[4]}") is not a number`); return; }
    if (!Number.isFinite(ymargin)) { problems.push(`panel ${n}: field 6 ("${fields[5]}") is not a number`); return; }

    // Resolved numbers keep the shape every consumer reads; an expression field
    // gets a placeholder now and its resolved value once every row is in, and
    // carries its written text on `*Expr` for round-trip and the editor.
    const lit = (v: number | Edge | Ext): number => (typeof v === "number" ? v : 0);
    const panel: PanelDef = {
      top: lit(geom[0]), left: lit(geom[1]), width: lit(geom[2]), height: lit(geom[3]), xmargin, ymargin,
    };
    if (typeof geom[0] !== "number") panel.topExpr = fields[0];
    if (typeof geom[1] !== "number") panel.leftExpr = fields[1];
    if (typeof geom[2] !== "number") panel.widthExpr = fields[2];
    if (typeof geom[3] !== "number") panel.heightExpr = fields[3];
    if (xRef !== undefined) panel.xmarginRef = xRef;
    if (yRef !== undefined) panel.ymarginRef = yRef;

    for (const raw of fields.slice(6)) {
      const eq = raw.indexOf("=");
      if (eq === -1) { problems.push(`panel ${n}: malformed extra "${raw}"`); continue; }
      const key = raw.slice(0, eq).trim();
      const value = raw.slice(eq + 1).trim();
      if (key === "xs" || key === "xe") {
        const ref = /^P(\d+)$/.exec(value);
        panel[key] = ref === null ? value : { ref: Number(ref[1]) };
        continue;
      }
      if (isRefKey(key)) {
        const parsed = parseRefValue(value);
        if (parsed === undefined) { problems.push(`panel ${n}: ${key} "${value}" is neither a number nor P<n>`); continue; }
        panel[key] = parsed;
        continue;
      }
      problems.push(`panel ${n}: unknown key "${key}"`);
    }
    panels.push(panel);
    rawGeom.push({
      top: geom[0] as number | Edge, left: geom[1] as number | Edge,
      width: geom[2] as number | Ext, height: geom[3] as number | Ext,
    });
  });

  // A P<n> naming a panel outside 1..panels.length can only be found once
  // every row is in, so it is its own pass -- and the offending ref is
  // cleared rather than left dangling, so scaleOrder never has to know
  // this problem exists.
  panels.forEach((panel, i) => {
    for (const key of EXTRA_KEYS) {
      const value = panel[key];
      if (typeof value === "object" && (value.ref < 1 || value.ref > panels.length)) {
        problems.push(`panel ${i + 1}: ${key} references missing panel P${value.ref}`);
        delete panel[key];
      }
    }
  });

  // Inherited margins, resolved through any chain. A reference that cannot be followed
  // -- a missing panel, or a loop -- is reported and that margin falls back to the
  // default, with the reference dropped so nothing downstream ever sees it.
  for (const [key, refKey, fallback] of [["xmargin", "xmarginRef", 24], ["ymargin", "ymarginRef", 64]] as const) {
    const follow = (start: number): number | "missing" | "circular" => {
      const seen = new Set<number>();
      let at = start;
      for (;;) {
        if (seen.has(at)) return "circular";
        seen.add(at);
        const next = panels[at][refKey];
        if (next === undefined) return panels[at][key];
        if (next < 1 || next > panels.length) return at === start ? "missing" : "circular";
        at = next - 1;
      }
    };
    const resolved = panels.map((panel, i) => (panel[refKey] === undefined ? panel[key] : follow(i)));
    panels.forEach((panel, i) => {
      const value = resolved[i];
      if (typeof value === "number") { panel[key] = value; return; }
      problems.push(value === "missing"
        ? `panel ${i + 1}: ${key} references missing panel P${panel[refKey]}`
        : `panel ${i + 1}: ${key} reference P${panel[refKey]} is circular`);
      panel[key] = fallback;
      delete panel[refKey];
    });
  }

  resolveGeometry(panels, rawGeom, problems);

  return { panels, problems };
}

/**
 * Resolve the geometry expressions in `rawGeom` into the plain `top`/`left`/
 * `width`/`height` numbers on `panels`, reporting into `problems`. Four passes:
 *
 *   1. Per-field validation an expression can fail on its own -- a cross-axis
 *      edge (`left = P1T`) or a reference to a panel that does not exist. A
 *      field that fails here is dropped to a literal fallback so nothing
 *      downstream tries to resolve it, and its panel is excluded from the
 *      range checks (it is already reported).
 *   2. Cycle and determinacy classification over the reference graph. A node is
 *      one panel-field's resolution; its neighbours are the fields it reads
 *      (an `R`/`B` anchor reads the referent's left/top AND its extent, since
 *      the edge is their sum). `tarjanSCC` -- the SAME detector the y-scale
 *      references use -- gives the cycles; a field on one is refused as
 *      circular. A field not on a cycle but reachable to one can never bottom
 *      out either, and is refused as underdetermined, naming its axis.
 *   3. The remaining fields form a DAG and resolve by memoised recursion.
 *   4. Each surviving panel's numbers are range-checked (positions in 0..100,
 *      extents positive, the panel fits inside the chart). Arithmetic makes an
 *      out-of-range RESULT reachable from valid inputs, so the check is on the
 *      result, reported with the computed number -- never clamped.
 */
function resolveGeometry(
  panels: PanelDef[],
  rawGeom: { top: number | Edge; left: number | Edge; width: number | Ext; height: number | Ext }[],
  problems: string[],
): void {
  const failed = new Set<number>();
  // Drop field `f` (0=top,1=left,2=width,3=height) of panel `i` back to a
  // literal: clear its expression, zero its raw and resolved value so nothing
  // resolves against it, and exclude the panel from the range checks.
  const dropExpr = (i: number, f: number): void => {
    const key = GEOM_KEYS[f];
    delete panels[i][EXPR_FIELD[key]];
    rawGeom[i][key] = 0;
    panels[i][key] = 0;
    failed.add(i);
  };

  // 1. Cross-axis and missing-panel references, per field.
  panels.forEach((panel, i) => {
    for (let f = 0; f < 4; f += 1) {
      const key = GEOM_KEYS[f];
      const raw = rawGeom[i][key];
      if (typeof raw === "number") continue;
      if (f < 2) {
        const edge = raw as Edge;
        const axis = f === 0 ? "y" : "x";
        if (sideAxis(edge.side) !== axis) {
          problems.push(`panel ${i + 1}: ${key} "${panel[EXPR_FIELD[key]]}" references a ${sideAxis(edge.side)} edge, but ${key} is a${axis === "x" ? "n x" : " y"} field -- axes do not mix`);
          dropExpr(i, f);
          continue;
        }
        if (edge.panel !== undefined && (edge.panel < 1 || edge.panel > panels.length)) {
          problems.push(`panel ${i + 1}: ${key} references missing panel P${edge.panel}`);
          dropExpr(i, f);
        }
      } else {
        const ext = raw as Ext;
        if (ext.ref < 1 || ext.ref > panels.length) {
          problems.push(`panel ${i + 1}: ${key} references missing panel P${ext.ref}`);
          dropExpr(i, f);
        }
      }
    }
  });

  // The reference graph: a node is `panel i0 * 4 + field`. Edges point at what a
  // field must read first. `R`/`B` are not stored fields, so a reference to
  // panel k's right edge reads k's left (1) and width (2); its bottom reads
  // k's top (0) and height (3).
  const node = (panel1: number, f: number): number => (panel1 - 1) * 4 + f;
  const neighbours = (v: number): number[] => {
    const i = Math.floor(v / 4);
    const f = v % 4;
    const key = GEOM_KEYS[f];
    const raw = rawGeom[i][key];
    if (typeof raw === "number") return [];
    if (f < 2) {
      const edge = raw as Edge;
      if (edge.panel === undefined) return []; // a chart anchor grounds the chain
      switch (edge.side) {
        case "T": return [node(edge.panel, 0)];
        case "B": return [node(edge.panel, 0), node(edge.panel, 3)];
        case "L": return [node(edge.panel, 1)];
        default: return [node(edge.panel, 1), node(edge.panel, 2)]; // R
      }
    }
    return [node((raw as Ext).ref, f)]; // width reads width, height reads height
  };

  // 2. Cycles (reusing the y-scale detector) and the fields blocked behind them.
  const components = tarjanSCC(panels.length * 4, neighbours);
  const cyclic = new Set<number>();
  for (const component of components) {
    if (component.length > 1 || neighbours(component[0]).includes(component[0])) {
      for (const v of component) cyclic.add(v);
    }
  }
  const blockedCache = new Map<number, boolean>();
  const isBlocked = (v: number): boolean => {
    const cached = blockedCache.get(v);
    if (cached !== undefined) return cached;
    const result = cyclic.has(v) || neighbours(v).some(isBlocked);
    blockedCache.set(v, result);
    return result;
  };

  // 3. Resolve the acyclic remainder. Only ever called on a field that is
  // neither cyclic nor blocked, so its dependencies are all resolvable too and
  // the recursion terminates; the `visiting` guard only saves us from hanging
  // on a classification bug.
  const memo = new Map<number, number>();
  const visiting = new Set<number>();
  const value = (v: number): number => {
    const cached = memo.get(v);
    if (cached !== undefined) return cached;
    if (visiting.has(v)) return 0;
    visiting.add(v);
    const i = Math.floor(v / 4);
    const f = v % 4;
    const raw = rawGeom[i][GEOM_KEYS[f]];
    let out: number;
    if (typeof raw === "number") out = raw;
    else if (f < 2) {
      const edge = raw as Edge;
      const anchor = edge.panel === undefined
        ? CHART_EDGE[edge.side]
        : edge.side === "T" ? value(node(edge.panel, 0))
          : edge.side === "B" ? value(node(edge.panel, 0)) + value(node(edge.panel, 3))
            : edge.side === "L" ? value(node(edge.panel, 1))
              : value(node(edge.panel, 1)) + value(node(edge.panel, 2));
      out = anchor + edge.offset;
    } else {
      const ext = raw as Ext;
      out = applyOps(value(node(ext.ref, f)), ext.ops);
    }
    visiting.delete(v);
    memo.set(v, out);
    return out;
  };

  panels.forEach((panel, i) => {
    for (let f = 0; f < 4; f += 1) {
      const key = GEOM_KEYS[f];
      if (typeof rawGeom[i][key] === "number") continue; // literal, or dropped in pass 1
      const v = i * 4 + f;
      if (cyclic.has(v)) {
        problems.push(`panel ${i + 1}: ${key} "${panel[EXPR_FIELD[key]]}" is a circular reference`);
        dropExpr(i, f);
      } else if (isBlocked(v)) {
        const concrete = f === 0 || f === 3 ? "height" : "width";
        problems.push(`panel ${i + 1}: ${key} "${panel[EXPR_FIELD[key]]}" is underdetermined -- the ${concrete === "height" ? "y" : "x"} axis never reaches a concrete ${concrete} (a literal or a chart edge)`);
        dropExpr(i, f);
      } else {
        panel[key] = value(v);
      }
    }
  });

  // 4. Range and fit of the resolved numbers. Skips a panel already reported in
  // an earlier pass. The messages carry the computed value -- with references
  // the fault can originate in another panel, so the number is what explains it.
  const EPS = 1e-9;
  panels.forEach((panel, i) => {
    if (failed.has(i)) return;
    const { top, left, width, height } = panel;
    // For an extent, name the panel it borrowed from and that panel's size, so
    // "resolves to 120" reads as "P1*2 where P1 is 60".
    const from = (f: number): string => {
      const key = GEOM_KEYS[f];
      const expr = panel[EXPR_FIELD[key]];
      if (expr === undefined) return "";
      const raw = rawGeom[i][key];
      if (typeof raw !== "number" && f >= 2) return ` (${expr} where P${(raw as Ext).ref} is ${panels[(raw as Ext).ref - 1][key]})`;
      return ` (${expr})`;
    };
    if (top < -EPS || top > 100 + EPS) problems.push(`panel ${i + 1}: top resolves to ${top}${from(0)}, outside 0..100`);
    if (left < -EPS || left > 100 + EPS) problems.push(`panel ${i + 1}: left resolves to ${left}${from(1)}, outside 0..100`);
    if (width <= EPS) problems.push(`panel ${i + 1}: width resolves to ${width}${from(2)}; a panel needs a positive width`);
    else if (left + width > 100 + EPS) problems.push(`panel ${i + 1}: left + width = ${left + width}${from(2)} exceeds 100; the panel runs past the right edge`);
    if (height <= EPS) problems.push(`panel ${i + 1}: height resolves to ${height}${from(3)}; a panel needs a positive height`);
    else if (top + height > 100 + EPS) problems.push(`panel ${i + 1}: top + height = ${top + height}${from(3)} exceeds 100; the panel runs past the bottom edge`);
  });
}

/**
 * The inverse of `parsePanels`, in the dict form (v12.4.12): valid JSON, one
 * panel per line. Numbers print as JSON prints them (`70`, `12.5`). Settings
 * always print in the canonical `xs,xe,ymin,ymax` order regardless of how
 * `parsePanels` read them, so a round-trip through the editor normalizes a
 * hand-edited text -- and rewrites a compact v12.4.0 one as a dict.
 */
export function encodePanels(panels: PanelDef[]): string {
  if (panels.length === 0) return "";
  const lines = panels.map((p, i) => {
    const margin = (px: number, ref: number | undefined): number | string => (ref === undefined ? px : `P${ref}`);
    // A geometry field prints its expression as written, not the number it
    // resolved to -- the same round-trip the margin references get.
    const geom = (n: number, expr: string | undefined): number | string => (expr === undefined ? n : expr);
    const entries: [string, number | string][] = [
      ["top", geom(p.top, p.topExpr)], ["left", geom(p.left, p.leftExpr)],
      ["width", geom(p.width, p.widthExpr)], ["height", geom(p.height, p.heightExpr)],
      ["xmargin", margin(p.xmargin, p.xmarginRef)], ["ymargin", margin(p.ymargin, p.ymarginRef)],
    ];
    for (const key of EXTRA_KEYS) {
      const value = p[key];
      if (value !== undefined) entries.push([key, typeof value === "object" ? `P${value.ref}` : value]);
    }
    // Entry by entry, not a regex over JSON.stringify's output: a value may itself
    // hold `":` or `,"`, and only the stringifier knows where a string ends.
    return `  "P${i + 1}": {${entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(", ")}}`;
  });
  return `{\n${lines.join(",\n")}\n}`;
}

/** Whether the `...` (hidden settings) button should be highlighted for this panel. */
export function hasExtras(p: PanelDef): boolean {
  return EXTRA_KEYS.some((key) => p[key] !== undefined);
}

/** In-range `ymin`/`ymax` panel references from one panel, 1-based, ymin before ymax. Out-of-range refs (parsePanels already strips these; a caller building PanelDef by hand might not) are silently dropped -- scaleOrder has no channel to report a problem through. */
function refTargets(panels: PanelDef[], node: number): number[] {
  const panel = panels[node - 1];
  const targets: number[] = [];
  for (const value of [panel.ymin, panel.ymax]) {
    if (typeof value === "object" && Number.isInteger(value.ref) && value.ref >= 1 && value.ref <= panels.length) {
      targets.push(value.ref);
    }
  }
  return targets;
}

/**
 * Tarjan's SCC over an arbitrary directed graph on nodes `0..nodeCount-1`. A
 * component of size 1 with no self-reference is not a cycle -- just a node
 * visited on its own -- the caller decides what counts as a real cycle. This is
 * the ONE cycle detector in this module: the y-scale references
 * (`stronglyConnected`) and the geometry references (`resolveGeometry`) both
 * feed it their own graph as a `neighbours` function.
 */
function tarjanSCC(nodeCount: number, neighbours: (v: number) => number[]): number[][] {
  let counter = 0;
  const index = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const components: number[][] = [];

  function connect(v: number): void {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of neighbours(v)) {
      if (!index.has(w)) {
        connect(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: number[] = [];
      let w: number;
      do {
        w = stack.pop() as number;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  }

  for (let v = 0; v < nodeCount; v += 1) if (!index.has(v)) connect(v);
  return components;
}

/**
 * SCCs over the `refTargets` (`ymin`/`ymax`) graph, in the 1-based panel
 * numbering `scaleOrder` works in. A thin wrapper over `tarjanSCC`: panels are
 * nodes `0..n-1` there, mapped back to `1..n` here.
 */
function stronglyConnected(panels: PanelDef[]): number[][] {
  return tarjanSCC(panels.length, (v) => refTargets(panels, v + 1).map((t) => t - 1))
    .map((component) => component.map((v) => v + 1));
}

/** One cycle's members in reference order, starting from its lowest-numbered panel and following refs depth-first. */
function walkCycle(start: number, component: Set<number>, panels: PanelDef[]): number[] {
  const path: number[] = [];
  const visited = new Set<number>();
  const visit = (node: number): void => {
    if (visited.has(node)) return;
    visited.add(node);
    path.push(node);
    for (const next of refTargets(panels, node).filter((t) => component.has(t)).sort((a, b) => a - b)) visit(next);
  };
  visit(start);
  return path;
}

/**
 * The order to scale panels in -- a panel borrowing another's `ymin`/`ymax`
 * (a `P<n>` ref) must be scaled after the panel it borrows from. `order`
 * lists every panel that is neither cyclic nor blocked, in a stable
 * topological order (an unconstrained panel keeps its original position
 * among the others left standing, rather than jumping to wherever a naive
 * "smallest ready node" scan would put it). `cycles` lists the 1-based
 * members of each reference cycle -- a panel actually ON a cycle -- in
 * reference order (`[1, 2]` for `P1 -> P2 -> P1`; `[n]` for a panel
 * referencing itself). `blocked` is a flat list of every panel that is not
 * itself cyclic but references (directly or transitively) a cyclic or
 * already-blocked panel, so its scale can never resolve either; such a
 * panel is a dependent of the cycle, not a member of it, so it is not
 * folded into `cycles`.
 */
export function scaleOrder(panels: PanelDef[]): { order: number[]; cycles: number[][]; blocked: number[] } {
  const components = stronglyConnected(panels);
  const isGenuineCycle = (component: number[]): boolean =>
    component.length > 1 || refTargets(panels, component[0]).includes(component[0]);

  const cyclic = new Set<number>();
  for (const component of components) if (isGenuineCycle(component)) for (const v of component) cyclic.add(v);

  // A panel that is not itself cyclic but depends (directly or through a
  // chain of refs) on one can never be scaled either -- its dependency
  // never comes in. Memoized: a non-cyclic panel's dependency chain is
  // provably acyclic (any real loop would already be one of the SCCs
  // above), so this recursion always terminates.
  const blockedCache = new Map<number, boolean>();
  const isBlocked = (v: number): boolean => {
    const cached = blockedCache.get(v);
    if (cached !== undefined) return cached;
    const result = cyclic.has(v) || refTargets(panels, v).some(isBlocked);
    blockedCache.set(v, result);
    return result;
  };

  // Post-order DFS, rooted at each panel 1..n in turn: a panel is only
  // appended once everything it references has gone in first.
  const order: number[] = [];
  const visited = new Set<number>();
  const visit = (v: number): void => {
    if (visited.has(v) || isBlocked(v)) return;
    visited.add(v);
    for (const dep of refTargets(panels, v)) visit(dep);
    order.push(v);
  };
  for (let v = 1; v <= panels.length; v += 1) visit(v);

  // A component that isn't a genuine cycle is always a singleton (any real
  // mutual reachability would already have been caught above), so a
  // blocked one contributes its single member to the flat `blocked` list
  // rather than a nested group.
  const cycles: number[][] = [];
  const blocked: number[] = [];
  for (const component of components) {
    if (isGenuineCycle(component)) cycles.push(walkCycle(Math.min(...component), new Set(component), panels));
    else if (isBlocked(component[0])) blocked.push(component[0]);
  }

  return {
    order,
    cycles: cycles.sort((a, b) => Math.min(...a) - Math.min(...b)),
    blocked: blocked.sort((a, b) => a - b),
  };
}

/**
 * `[1, 2]` -> `P1 → P2 → P1`: a `scaleOrder` cycle rendered as the loop closed on
 * its first member, the way the spec names it.
 *
 * It lives beside `scaleOrder` because it formats what `scaleOrder` returns. It was
 * previously defined twice -- identically -- in PanelFields.tsx and LayoutEditor.tsx,
 * the two places that render a circular-panel-link refusal.
 */
export function loopText(loop: number[]): string {
  return [...loop, loop[0]].map((n) => `P${n}`).join(" → ");
}

/** A panel's percentage rect resolved against the card body's pixel size. Margins (`xmargin`/`ymargin`) are the renderer's axis padding, not part of this geometry. */
/**
 * Where panel `i` overlaps any OTHER panel, as rectangles in the same percentage
 * units the panels themselves use. Empty when it overlaps nothing.
 *
 * Overlap is strict on BOTH axes. Two panels that merely touch -- P1 running
 * 0..60 and P2 starting at exactly 60 -- are ADJACENT, which is the normal
 * stacked layout and must not be reported (user, 2026-09-26). Only a genuine
 * numeric intersection counts, so the comparisons are `>` and never `>=`.
 *
 * Both axes are tested, not just the vertical one. Panels carry `left` and
 * `width` as well as `top` and `height`, so two side-by-side panels sharing a
 * row do not overlap even though their vertical ranges are identical. Testing
 * only the vertical would report every side-by-side layout as broken.
 *
 * Nothing else in this file checked geometry: `parsePanels`'s `problems` are
 * parse and shape errors (a bad name, a missing key) and `scaleOrder`'s cycles
 * are axis REFERENCE loops. Overlap is its own question and this is its pass.
 */
export function overlapRects(
  panels: PanelDef[], i: number,
): { left: number; top: number; width: number; height: number }[] {
  const a = panels[i];
  if (a === undefined) return [];
  const out: { left: number; top: number; width: number; height: number }[] = [];
  for (let j = 0; j < panels.length; j += 1) {
    if (j === i) continue;
    const b = panels[j];
    if (b === undefined) continue;
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.left + a.width, b.left + b.width);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.top + a.height, b.top + b.height);
    if (right > left && bottom > top) out.push({ left, top, width: right - left, height: bottom - top });
  }
  return out;
}

export function panelRect(p: PanelDef, bodyW: number, bodyH: number): { x: number; y: number; w: number; h: number } {
  return { x: (p.left / 100) * bodyW, y: (p.top / 100) * bodyH, w: (p.width / 100) * bodyW, h: (p.height / 100) * bodyH };
}
