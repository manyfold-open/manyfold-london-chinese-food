/**
 * The eight lines (kinds/vocab.ts, LINES) as the Underground draws them: a line's badge, and the
 * diagram where every line runs through Chinatown. The diagram is a picture for pointers; the
 * legend under it carries the same links for everyone else.
 */

import type { CSSProperties, ReactNode } from 'react';
import { LINES, lineById } from '../../shared/lines';
import type { Locale } from '../../shared/i18n';
import { useCopy, useLocale } from '../i18n';
import { Link, navigate } from '../router';
import { paths } from '../routes';

export const lineColor = (id: string): string => `var(${lineById(id)?.color ?? '--line-north'})`;

/** A block in a line's colour: `--c` for the colour, `--on-c` for the text that reads on it in this theme. */
export const lineVars = (id: string): CSSProperties => {
  const color = lineById(id)?.color ?? '--line-north';
  return { '--c': `var(${color})`, '--on-c': `var(--on-${color.slice(2)})` } as CSSProperties;
};

/** A line's roundel-free badge: a ring in its colour and its name. */
export function LineBadge({ id, children }: { id: string; children?: ReactNode }) {
  const locale = useLocale();
  const line = lineById(id);
  if (!line) return null;
  return (
    <span className="line-badge" style={{ '--c': lineColor(id) } as CSSProperties}>
      {children ?? line.label[locale]}
    </span>
  );
}

/** A small ring in a line's colour, as a station marker. */
export const LineDot = ({ id }: { id: string }) => <i className="line-dot" style={{ '--c': lineColor(id) } as CSSProperties} aria-hidden="true" />;

interface TubeProps {
  counts: Record<string, number>;
  hubCount: number;
  /** Lines drawn in grey: none when every line is lit. */
  lit?: readonly string[] | null;
  /** The wide diagram names each line on its run. */
  wide?: boolean;
  labels?: boolean;
}

/**
 * The diagram: each line comes in from its two ends, runs into a bundle through Chinatown and out
 * again. Parallel runs and their 45° bends keep their spacing, as on the real map.
 */
export function TubeMap({ counts, hubCount, lit = null, wide = false, labels = true }: TubeProps) {
  const copy = useCopy();
  const locale = useLocale();
  const W = wide ? 1150 : 358;
  const H = 300;
  const cx = W / 2;
  const half = wide ? 70 : 30;
  const gap = 8.4;
  const stroke = wide ? 7 : 6;
  const padTop = 26;
  const step = (H - padTop - 22) / 7;
  const hubTop = H / 2 - 3.5 * gap;
  return (
    <svg className="tube" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={copy.lines.title}>
      {LINES.map((line, i) => {
        const on = !lit || lit.includes(line.id);
        const color = on ? `var(${line.color})` : 'var(--line2)';
        const bundle = hubTop + i * gap;
        const end = padTop + i * step;
        const top = i < 4;
        const stagger = (top ? 3 - i : i - 4) * 3.6;
        const inLeft = cx - half + stagger;
        const inRight = cx + half - stagger;
        const d = Math.abs(end - bundle);
        const outLeft = inLeft - d;
        const outRight = inRight + d;
        const ticks = wide ? [0.3, 0.62] : [0.45];
        const labelY = top ? end - 9 : end + 17;
        const nameX = 8 + (outLeft - 8) * 0.55;
        const name = `${line.label[locale]}  ${counts[line.id] ?? 0}`;
        return (
          <g key={line.id} className={`tube-line${on ? '' : ' off'}`} onClick={() => navigate(paths.line(locale, line.id))}>
            <path d={`M 8 ${end} H ${outLeft} L ${inLeft} ${bundle} H ${inRight} L ${outRight} ${end} H ${W - 8}`} fill="none" stroke={color} strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
            {ticks.flatMap((f) => [8 + (outLeft - 8) * f, W - 8 - (W - 8 - outRight) * f]).map((x, t) => (
              <rect key={t} x={x - 1.6} y={top ? end - 7 : end + 1} width={3.2} height={6} fill={color} />
            ))}
            {[8, W - 8].map((x) => (
              <circle key={x} cx={x} cy={end} r={5.2} fill="var(--card)" stroke={on ? 'var(--ink)' : 'var(--line2)'} strokeWidth={2.6} />
            ))}
            {labels ? (
              <>
                <text x={4} y={labelY} className="tube-end">
                  {line.ends[0][locale]}
                </text>
                <text x={W - 4} y={labelY} className="tube-end" textAnchor="end">
                  {line.ends[1][locale]}
                </text>
              </>
            ) : null}
            {wide ? <LineName x={nameX} y={end} color={color} text={name} /> : null}
          </g>
        );
      })}
      <rect x={cx - 8} y={hubTop - 9} width={16} height={7 * gap + 18} rx={8} fill="var(--card)" stroke="var(--ink)" strokeWidth={3.2} />
      <text x={cx} y={hubTop - 30} textAnchor="middle" className="tube-hub">
        {copy.lines.hub}
      </text>
      <text x={cx} y={hubTop - 16} textAnchor="middle" className="tube-hub-count">
        {copy.lines.hubCount(hubCount)}
      </text>
    </svg>
  );
}

/** A line's name on its run, in a pill outlined in its colour. Widths are estimated, not measured. */
function LineName({ x, y, color, text }: { x: number; y: number; color: string; text: string }) {
  const width = [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0x2e80 ? 12 : 6.6), 0) + 22;
  return (
    <>
      <rect x={x - width / 2} y={y - 10} width={width} height={20} rx={10} fill="var(--card)" stroke={color} strokeWidth={2.4} />
      <text x={x} y={y + 4} textAnchor="middle" className="tube-name">
        {text}
      </text>
    </>
  );
}

/** The legend: every line, its count, a link to its page. */
export function LineLegend({ counts, variant = 'list' }: { counts: Record<string, number>; variant?: 'list' | 'map' }) {
  const copy = useCopy();
  const locale = useLocale();
  const sorted = [...LINES].sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  return (
    <ul className={variant === 'map' ? 'map-legend' : 'line-legend'}>
      {sorted.map((line) => (
        <li key={line.id} style={{ '--c': `var(${line.color})` } as CSSProperties}>
          <Link href={paths.line(locale, line.id)}>
            <i aria-hidden="true" />
            {line.label[locale]}
            <span>{variant === 'map' ? (counts[line.id] ?? 0) : copy.lines.count(counts[line.id] ?? 0)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The names of a list of lines, joined. */
export const lineNames = (ids: readonly string[], locale: Locale): string => ids.map((id) => lineById(id)?.label[locale] ?? id).join(' · ');

