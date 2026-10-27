// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the Business Source License 1.1.
// SPDX-License-Identifier: BUSL-1.1

/** `{symbol}_{timeframe}_{YYYYMMDD-HHmm}.png` (spec §4.6), in the viewer's clock. */
/**
 * How much bigger than the screen a snapshot is RENDERED (owner, 2026-09-27:
 * "export at a scale factor ... 2x or 3x").
 *
 * A constant, not a setting: one value, no UI, and 3x is this line. YAGNI
 * until someone asks to choose per export.
 */
export const SNAPSHOT_SCALE = 2;

export function snapshotName(symbol: string, interval: string, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${symbol}_${interval}_${stamp}.png`;
}

/**
 * The chart's own canvas as PNG bytes. chart.takeScreenshot() composes every
 * pane and the watermark (a same-origin data URI, so the canvas is untainted)
 * into one canvas; toBlob is the async, memory-friendly encoder.
 */
export function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) { reject(new Error("the chart produced no image")); return; }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, "image/png");
  });
}

/** A rectangle in the card body's own CSS pixels. */
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where each panel lands in the composed image, and how big that image is.
 *
 * Pure, and the whole of the decision -- the canvas work below is a loop of
 * drawImage calls over what this returns, so the arithmetic that actually
 * matters can be tested without a canvas (jsdom has none).
 *
 * `pixels` is the panel's OWN canvas size, which is its CSS size times the
 * device pixel ratio. The ratio is taken as the largest across the panels
 * rather than read from `window`: a screenshot is whatever the library made
 * it, and a card dragged between a Retina and a non-Retina display can hold
 * panels that disagree. Taking the largest means no panel is ever scaled UP,
 * so nothing is composed blurrier than it was drawn.
 *
 * Coordinates are relative to the bounding box of the panels themselves, not
 * to the card: a card whose panels leave a margin down one side exports the
 * panels, not the margin.
 */
export function composeLayout(
  parts: readonly { rect: Rect; pixels: { w: number; h: number } }[],
  topInset = 0,
): { width: number; height: number; ratio: number; places: (Rect & { index: number })[] } | null {
  const usable = parts
    .map((part, index) => ({ ...part, index }))
    .filter((part) => part.rect.w > 0 && part.rect.h > 0 && part.pixels.w > 0 && part.pixels.h > 0);
  if (usable.length === 0) return null;

  const ratio = Math.max(...usable.map((part) => part.pixels.w / part.rect.w));
  const minX = Math.min(...usable.map((part) => part.rect.x));
  const minY = Math.min(...usable.map((part) => part.rect.y));
  const maxX = Math.max(...usable.map((part) => part.rect.x + part.rect.w));
  const maxY = Math.max(...usable.map((part) => part.rect.y + part.rect.h));

  // `topInset` is the header band, in the same CSS pixels the rects are in:
  // the image grows by it and every panel moves down by it, so the band is
  // space made for the header rather than something drawn over the chart.
  const top = Math.round(topInset * ratio);
  return {
    width: Math.round((maxX - minX) * ratio),
    height: Math.round((maxY - minY) * ratio) + top,
    ratio,
    places: usable.map((part) => ({
      index: part.index,
      x: Math.round((part.rect.x - minX) * ratio),
      y: Math.round((part.rect.y - minY) * ratio) + top,
      w: Math.round(part.rect.w * ratio),
      h: Math.round(part.rect.h * ratio),
    })),
  };
}

/**
 * Every panel's screenshot stitched into one canvas (owner, 2026-09-27: "the
 * PNG renderer only exports panel1").
 *
 * Since v12.4.0 a card is one chart PER PANEL, and `takeScreenshot()` composes
 * the panes of ONE chart -- so the export had been panel 1 alone, losing the
 * volume and every study pane. The library cannot compose across instances,
 * so this does it: each panel's canvas drawn into an offscreen one at the
 * panel's own place in the card.
 *
 * `background` is painted first because the chart layout is deliberately
 * transparent (the card's own colour shows through a live chart), which in a
 * PNG means a transparent image -- and any gap the panels leave between them
 * would show it too. Null when there is nothing to draw or no 2D context to
 * draw with; the caller keeps its own single-panel path for that.
 */
/**
 * The card's watermark, ready to draw into the export.
 *
 * The on-screen mark is a DOM element behind the panels now (watermark.ts), and
 * `takeScreenshot` captures the chart canvas alone -- it knows nothing about
 * the DOM around it -- so the export would otherwise lose it. Same data URI,
 * so the two cannot drift; null if it will not decode, and the export simply
 * goes without rather than failing over decoration.
 */
export function loadMark(src: string, timeoutMs = MARK_TIMEOUT_MS): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    // BOUNDED. The export must not hang on decoration: an environment that
    // never decodes the image fires neither `onload` nor `onerror` (jsdom is
    // exactly that), and without this the whole save would wait forever on a
    // promise nothing settles. A data URI in a real WebView decodes in well
    // under this; past it the export simply goes without the mark.
    const done = setTimeout(() => { resolve(null); }, timeoutMs);
    const finish = (value: HTMLImageElement | null) => { clearTimeout(done); resolve(value); };
    const image = new Image();
    image.onload = () => { finish(image); };
    image.onerror = () => { finish(null); };
    image.src = src;
  });
}

/** How long `loadMark` waits before the export goes without the mark. */
const MARK_TIMEOUT_MS = 250;

export function composePanels(
  parts: readonly { canvas: HTMLCanvasElement; rect: Rect }[],
  background?: string,
  mark?: { image: HTMLImageElement; opacity: number; padding: number } | null,
  header?: SnapshotHeader | null,
): HTMLCanvasElement | null {
  const layout = composeLayout(
    parts.map((part) => ({ rect: part.rect, pixels: { w: part.canvas.width, h: part.canvas.height } })),
    header === undefined || header === null ? 0 : HEADER_HEIGHT,
  );
  if (layout === null || typeof document === "undefined") return null;
  const out = document.createElement("canvas");
  out.width = layout.width;
  out.height = layout.height;
  const ctx = out.getContext("2d");
  if (ctx === null) return null;
  if (background !== undefined && background !== "") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  // Under the panels, as on screen: the chart layout is transparent, so the
  // mark reads through every one of them. Centred on the WHOLE image rather
  // than on any panel, `contain`-fitted the way the CSS fits the DOM one.
  if (mark !== undefined && mark !== null && mark.image.width > 0 && mark.image.height > 0) {
    const room = { w: Math.max(0, out.width - mark.padding * 2), h: Math.max(0, out.height - mark.padding * 2) };
    const scale = Math.min(room.w / mark.image.width, room.h / mark.image.height);
    if (scale > 0) {
      const w = mark.image.width * scale;
      const h = mark.image.height * scale;
      ctx.save();
      ctx.globalAlpha = mark.opacity;
      ctx.drawImage(mark.image, (out.width - w) / 2, (out.height - h) / 2, w, h);
      ctx.restore();
    }
  }
  for (const place of layout.places) {
    const part = parts[place.index];
    if (part === undefined) continue;
    ctx.drawImage(part.canvas, place.x, place.y, place.w, place.h);
  }
  // Last, in the space `topInset` already reserved for it, so nothing it
  // writes can land under a panel.
  if (header !== undefined && header !== null) drawHeader(ctx, header, out.width / layout.ratio, layout.ratio);
  return out;
}

/** The little of a chart `shootAt` touches; structural so a test needs no library. */
export type Shootable = {
  resize: (width: number, height: number) => void;
  takeScreenshot: () => HTMLCanvasElement;
  options: () => { layout: { fontSize: number } };
  applyOptions: (options: { layout: { fontSize: number } }) => void;
  timeScale: () => {
    getVisibleLogicalRange: () => { from: number; to: number } | null;
    setVisibleLogicalRange: (range: { from: number; to: number }) => void;
  };
};

/**
 * One panel's screenshot, RENDERED at `scale` times its on-screen size.
 *
 * Why re-render rather than enlarge the image: `takeScreenshot()` copies the
 * bitmap the chart has already drawn, at its CSS size times the device pixel
 * ratio, so drawing that canvas bigger interpolates and adds no detail at all.
 * The only way to more pixels of actual chart is to make the chart bigger and
 * let the library draw it again.
 *
 * Two things are restored around the shot, and both matter:
 *
 * `fontSize` is scaled with the chart. Axis labels and time ticks are placed
 * by how many fit in the pixels available, so a chart made twice as wide at an
 * unchanged 12px font simply shows twice as many labels -- a DIFFERENT chart,
 * not a sharper one. Scaling the font keeps the density, so the export is the
 * picture on screen with more pixels in it.
 *
 * The visible LOGICAL range is captured and re-imposed after each resize.
 * lightweight-charts keeps its bar SPACING across a resize, so a chart made
 * twice as wide shows twice as many bars unless the range is put back -- the
 * same trap PanelHost's own resize effect carries a range across.
 *
 * `finally` restores the size, the font and the range whatever happens: a
 * throw mid-shot must not leave the user's card rendering at twice its box.
 */
export function shootAt(chart: Shootable, rect: Rect, scale: number): HTMLCanvasElement | null {
  if (!(rect.w > 0) || !(rect.h > 0) || !(scale > 0)) return null;
  const range = chart.timeScale().getVisibleLogicalRange();
  const restore = (): void => {
    if (range !== null) chart.timeScale().setVisibleLogicalRange(range);
  };
  if (scale === 1) return chart.takeScreenshot();
  const fontSize = chart.options().layout.fontSize;
  try {
    chart.resize(rect.w * scale, rect.h * scale);
    chart.applyOptions({ layout: { fontSize: fontSize * scale } });
    restore();
    return chart.takeScreenshot();
  } finally {
    chart.resize(rect.w, rect.h);
    chart.applyOptions({ layout: { fontSize } });
    restore();
  }
}

/**
 * The card's header, as the export draws it (owner, 2026-09-27: "we need an
 * option to include the chart header in the screenshot").
 *
 * DRAWN, not rasterised. The header on screen is DOM, and a canvas cannot
 * capture DOM without a rasteriser -- a dependency this does not need for
 * five strings. The renderer already holds every one of them, formatted
 * exactly as the header shows them, so the export composes the same reading
 * rather than photographing it.
 */
export type SnapshotHeader = {
  symbol: string;
  name?: string;
  /** The hero price and its change, already formatted by the renderer. */
  price?: string;
  change?: string;
  direction?: "up" | "down" | "flat";
  /** The crosshair readings, as the legend words them. */
  readings?: readonly string[];
  colors: { text: string; muted: string; up: string; down: string };
};

/** The band's height, in the CSS pixels the panel rects are measured in. */
export const HEADER_HEIGHT = 58;

/**
 * Where each piece of the header sits, in CSS pixels from the band's top-left.
 * Pure, so the arithmetic is testable without a canvas -- the draw below is a
 * loop of fillText over what this returns.
 */
export function headerLayout(header: SnapshotHeader, width: number): {
  symbol: { x: number; y: number; size: number };
  name: { x: number; y: number; size: number } | null;
  price: { x: number; y: number; size: number } | null;
  change: { x: number; y: number; size: number } | null;
  readings: { x: number; y: number; size: number } | null;
} {
  const pad = 12;
  return {
    symbol: { x: pad, y: 20, size: 15 },
    name: header.name === undefined || header.name === "" ? null : { x: pad, y: 36, size: 11 },
    // Right-aligned: the caller sets textAlign, so this is the RIGHT edge.
    price: header.price === undefined ? null : { x: width - pad, y: 22, size: 18 },
    change: header.change === undefined ? null : { x: width - pad, y: 40, size: 12 },
    readings: header.readings === undefined || header.readings.length === 0
      ? null
      : { x: pad, y: 52, size: 11 },
  };
}

const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

function drawHeader(ctx: CanvasRenderingContext2D, header: SnapshotHeader, width: number, ratio: number): void {
  const at = headerLayout(header, width);
  const put = (text: string, spot: { x: number; y: number; size: number }, color: string, align: CanvasTextAlign, weight = "400") => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.font = `${weight} ${spot.size * ratio}px ${FONT}`;
    ctx.fillText(text, spot.x * ratio, spot.y * ratio);
  };
  put(header.symbol, at.symbol, header.colors.text, "left", "650");
  if (at.name !== null && header.name !== undefined) put(header.name, at.name, header.colors.muted, "left");
  if (at.price !== null && header.price !== undefined) put(header.price, at.price, header.colors.text, "right", "650");
  if (at.change !== null && header.change !== undefined) {
    const tint = header.direction === "down" ? header.colors.down
      : header.direction === "up" ? header.colors.up : header.colors.muted;
    put(header.change, at.change, tint, "right");
  }
  if (at.readings !== null && header.readings !== undefined) {
    put(header.readings.join("   "), at.readings, header.colors.muted, "left");
  }
}
