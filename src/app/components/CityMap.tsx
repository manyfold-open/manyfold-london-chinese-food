/**
 * London on a real map wherever a page shows where places are: the front page, a line, a campus,
 * a guide, a dish, a place, and lighting up London. Each place is a dot in its line's colour (or
 * faint, behind the ones the page is about); a dot opens its place. Labels and pins are HTML on the
 * map. MapLibre loads as its own chunk once a map comes near the screen, so a page that never shows
 * one never pays for it. The map page has its own map (MapView), with clusters and the reader.
 */

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { IndexEntry } from '../../shared/place-doc';

export type Bounds = readonly [south: number, north: number, west: number, east: number];
export const LONDON: Bounds = [51.34, 51.66, -0.42, 0.2];
export const CENTRAL: Bounds = [51.43, 51.585, -0.33, 0.07];

export interface Marker {
  lat: number;
  lng: number;
  kind: 'uni' | 'hub' | 'price' | 'here' | 'station' | 'stop' | 'near';
  label: ReactNode;
  sub?: ReactNode;
  href?: string;
  /** CSS translate for the label, to keep neighbours apart. */
  shift?: string;
  color?: string;
}

export interface CityMapProps {
  entries: readonly IndexEntry[];
  /** How dots are coloured: by their first line, one muted tone, or faint behind a highlight. */
  tone: 'line' | 'mono' | 'faint';
  /** Where the map opens. */
  bounds?: Bounds;
  /** All of the bounds in view (contain), or the map filled with them (cover). */
  fit?: 'contain' | 'cover';
  /** Places drawn larger, in a line's colour, over the rest. */
  highlight?: ReadonlySet<string>;
  highlightColor?: string;
  /** Places with a real photo glow. */
  lit?: boolean;
  /** A walk drawn through these points. */
  route?: readonly { lat: number; lng: number }[];
  /** A circle of this many kilometres around a point: how far a walk goes. */
  ring?: { lat: number; lng: number; km: number; color?: string };
  markers?: readonly Marker[];
  /** The dark map whatever the page's theme, for a map on a dark panel. */
  dark?: boolean;
  className?: string;
  label: string;
}

const View = lazy(() => import('./CityMapView'));

export function CityMap(props: CityMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || near) return;
    if (!('IntersectionObserver' in window)) {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) {
        setNear(true);
        observer.disconnect();
      }
    }, { rootMargin: '400px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  const className = `city-map${props.className ? ` ${props.className}` : ''}`;
  const waiting = <div className={className} ref={box} role="img" aria-label={props.label} />;
  return near ? (
    <Suspense fallback={waiting}>
      <View {...props} />
    </Suspense>
  ) : (
    waiting
  );
}
