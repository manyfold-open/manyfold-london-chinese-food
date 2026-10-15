/**
 * Menu prices for one dish as a dot per place: where most places sit and how far the dearest are.
 * A price is a fact from a menu, not a judgement; nothing here says which is worth it.
 */

import { price } from '../format';
import { useCopy } from '../i18n';

export interface PriceStats {
  count: number;
  min: number;
  max: number;
  median: number;
}

/** The plain numbers of a list of prices in pence, or null when there are none. */
export function priceStats(prices: readonly number[]): PriceStats | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  return { count: sorted.length, min: sorted[0]!, max: sorted[sorted.length - 1]!, median };
}

/** A whole number of pounds to mark on the axis, every 5 or 10 as the range needs. */
function ticks(min: number, max: number): number[] {
  const span = (max - min) / 100;
  const every = span > 30 ? 1000 : span > 12 ? 500 : 200;
  const out: number[] = [];
  for (let t = Math.ceil(min / every) * every; t <= max; t += every) out.push(t);
  return out;
}

export function PricePlot({ prices, dark = false, width = 330, height = 92 }: { prices: readonly number[]; dark?: boolean; width?: number; height?: number }) {
  const copy = useCopy();
  const stats = priceStats(prices);
  if (!stats) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const lo = Math.max(0, stats.min - 80);
  const hi = Math.max(stats.max + 80, lo + 400);
  const r = 3.4;
  const pitch = r * 2 + 0.6;
  const base = height - 18;
  const x = (p: number) => 8 + ((p - lo) / (hi - lo)) * (width - 16);
  // A dot sits on its price's column; a full column spills into its neighbours, so a common price
  // makes a mound instead of a tower that leaves the plot.
  const tallest = Math.max(1, Math.floor((base - 16) / pitch));
  const columns = new Map<number, number>();
  const dots = sorted.map((p, i) => {
    const home = Math.round(x(p) / pitch);
    let column = home;
    for (let step = 1; (columns.get(column) ?? 0) >= tallest && step < 200; step += 1) column = home + (step % 2 ? (step + 1) / 2 : -step / 2);
    const stack = columns.get(column) ?? 0;
    columns.set(column, stack + 1);
    return { cx: column * pitch, cy: base - stack * pitch, low: i === 0 };
  });
  return (
    <svg className={`price-plot${dark ? ' dark' : ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.dish.prices(stats.count, price(stats.min), price(stats.max), price(stats.median))}>
      <line x1={4} x2={width - 4} y1={base + 6} y2={base + 6} className="plot-axis" />
      {ticks(lo, hi).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={base + 3} y2={base + 9} className="plot-axis" />
          <text x={x(t)} y={height - 1} textAnchor="middle" className="plot-label">
            £{t / 100}
          </text>
        </g>
      ))}
      <line x1={x(stats.median)} x2={x(stats.median)} y1={4} y2={base + 6} className="plot-median" />
      <text x={x(stats.median) + 5} y={10} className="plot-median-label">
        {copy.dayDish.half(price(stats.median))}
      </text>
      {dots.map((dot, i) => (
        <circle key={i} cx={dot.cx} cy={dot.cy} r={r} className={dot.low ? 'plot-dot low' : 'plot-dot'} />
      ))}
    </svg>
  );
}
