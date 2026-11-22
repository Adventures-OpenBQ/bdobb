// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, Logical, SeriesAttachedParameter } from 'lightweight-charts';
import type { UdfBar } from './udf';

/** Supported series primitive: wider wick segments under the native candle bodies.
 * mountCandleChart's candle and volume series share the same ordered timestamps,
 * so visible logical indices address this data directly without scanning history.
 */
export class CandleWicks implements ISeriesPrimitive, IPrimitivePaneRenderer {
  private parameters?: SeriesAttachedParameter;
  private bars: readonly UdfBar[] = [];
  private readonly views: readonly IPrimitivePaneView[] = [{zOrder:()=> 'bottom',renderer:()=>this}];
  constructor(private readonly width: number) {}
  attached(parameters: SeriesAttachedParameter): void { this.parameters = parameters; }
  detached(): void { this.parameters = undefined; this.bars = []; }
  setBars(bars: readonly UdfBar[]): void {
    if (!this.parameters) return;
    this.bars = bars;
    this.parameters.requestUpdate();
  }
  updateBar(bar: UdfBar): void {
    const last = this.bars.at(-1);
    this.setBars(last?.time === bar.time ? [...this.bars.slice(0,-1),bar] : [...this.bars,bar]);
  }
  paneViews(): readonly IPrimitivePaneView[] { return this.views; }
  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const parameters = this.parameters;
    if (!parameters || this.bars.length === 0) return;
    const series = parameters.series as ISeriesApi<'Candlestick'>;
    const style = series.options();
    if (!style.wickVisible) return;
    const scale = parameters.chart.timeScale();
    const range = scale.getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(0,Math.floor(range.from)-1);
    const to = Math.min(this.bars.length-1,Math.ceil(range.to)+1);
    const spacing = scale.options().barSpacing;
    target.useBitmapCoordinateSpace(({context,horizontalPixelRatio,verticalPixelRatio,bitmapSize})=>{
      const width = Math.max(1,Math.min(Math.round(this.width*horizontalPixelRatio),Math.floor(spacing*horizontalPixelRatio)));
      context.save();
      try {
        for (let i=from;i<=to;i++) {
          const bar = this.bars[i];
          const x = scale.logicalToCoordinate(i as Logical);
          if (x === null) continue;
          const high = series.priceToCoordinate(bar.high);
          const upperBody = series.priceToCoordinate(Math.max(bar.open,bar.close));
          const lowerBody = series.priceToCoordinate(Math.min(bar.open,bar.close));
          const low = series.priceToCoordinate(bar.low);
          if (high === null || upperBody === null || lowerBody === null || low === null) continue;
          const left = Math.round(x*horizontalPixelRatio)-Math.floor(width/2);
          context.fillStyle = bar.close >= bar.open ? style.wickUpColor : style.wickDownColor;
          const segment = (top:number,bottom:number) => {
            const y = Math.max(0,Math.round(top*verticalPixelRatio));
            const end = Math.min(bitmapSize.height,Math.round(bottom*verticalPixelRatio));
            if (end > y) context.fillRect(left,y,width,end-y);
          };
          segment(high,upperBody);
          segment(lowerBody,low);
        }
      } finally { context.restore(); }
    });
  }
}
