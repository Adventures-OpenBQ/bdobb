// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { type MouseEvent, useState } from "react";
import { createPortal } from "react-dom";
import { sparklineGeometry, type SparklineConfig } from "../../lib/sparkline";

// A fixed intrinsic box. We keep the default (meet) aspect ratio so the marker
// and point-of-interest dots stay round; the cell's own width just letterboxes
// the drawing horizontally. Colors default to currentColor -> the app theme.
const W = 96;
const H = 24;

type Tip = { x: number; y: number; v: number };

/**
 * One table cell as an inline-SVG sparkline. `values` is the row's number array
 * for this column; `config` is the column's parsed sparkline. The maths lives in
 * sparklineGeometry; this component only draws and runs the hover tooltip.
 */
export function SparklineCell({ values, config }: { values: number[]; config: SparklineConfig }) {
  const geo = sparklineGeometry(values, config, W, H);
  const [tip, setTip] = useState<Tip | null>(null);

  const stroke = config.stroke ?? "currentColor";
  const strokeWidth = config.strokeWidth ?? 1;

  function onMove(e: MouseEvent<SVGSVGElement>): void {
    if (!config.tooltip || geo.points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // No layout (tests) -> width 0 -> relX 0 -> nearest stays the first point.
    const relX = rect.width > 0 ? ((e.clientX - rect.left) / rect.width) * W : 0;
    let nearest = geo.points[0];
    for (const p of geo.points) {
      if (Math.abs(p.x - relX) < Math.abs(nearest.x - relX)) nearest = p;
    }
    setTip({ x: e.clientX, y: e.clientY, v: nearest.v });
  }

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block" }}
        role="img"
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
      >
        {config.type === "area" && geo.areaPath ? (
          <path d={geo.areaPath} fill={config.fill ?? "none"} stroke="none" />
        ) : null}

        {config.type === "bar"
          ? geo.bars.map((b, i) => (
              <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={config.fill ?? stroke} />
            ))
          : geo.linePath && (
              <path
                d={geo.linePath}
                fill={config.type === "line" && config.fill ? config.fill : "none"}
                stroke={stroke}
                strokeWidth={strokeWidth}
              />
            )}

        {config.markers?.enabled
          ? geo.points.map((p) => (
              <circle key={p.i} cx={p.x} cy={p.y} r={config.markers?.size ?? 2} fill={config.markers?.fill ?? stroke} />
            ))
          : null}

        {(["minimum", "maximum"] as const).map((k) => {
          const style = config.poi?.[k];
          const idx = k === "minimum" ? geo.minIdx : geo.maxIdx;
          return style && idx >= 0 ? (
            <circle
              key={k}
              cx={geo.points[idx].x}
              cy={geo.points[idx].y}
              r={style.size ?? 3}
              fill={style.fill ?? stroke}
              stroke={style.stroke}
              strokeWidth={style.strokeWidth}
            />
          ) : null;
        })}
      </svg>

      {tip
        ? createPortal(
            <div
              className="sparkline-tooltip"
              style={{
                position: "fixed",
                left: tip.x + 12,
                top: tip.y + 12,
                pointerEvents: "none",
                zIndex: 1000,
                padding: "2px 6px",
                borderRadius: 3,
                fontSize: 11,
                background: "var(--card-bg, #1e1e1e)",
                color: "var(--text, #e6e6e6)",
                border: "1px solid var(--border, #444)",
                whiteSpace: "nowrap",
              }}
            >
              {tip.v}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
