/**
 * One line: every open place on it (src/shared/lines.ts), on a map of London and in a list, newest
 * review first or nearest first. A line is a way to browse, never a ranking of what is on it.
 */

import { useMemo, useState } from 'react';
import { LINES, lineById, onLine } from '../../shared/lines';
import { distanceKm, queryPlaces } from '../../shared/places-query';
import { CityMap, LONDON } from '../components/CityMap';
import { LineBadge, lineColor, lineVars } from '../components/Lines';
import { PlaceRow } from '../components/PlaceRow';
import { useIndex } from '../data';
import type { Near } from '../geo';
import { useLocate } from '../geo';
import { useCopy, useLocale } from '../i18n';
import { cuisineLabel } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';
import { Button, Pill, Skeleton } from '../ui';
import { NotFoundPage } from './TextPages';

const PAGE = 60;

export function LinePage({ id }: { id: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const line = lineById(id);
  const index = useIndex();
  const [near, setNear] = useState<Near | null>(null);
  const [shown, setShown] = useState(PAGE);
  const { locating, locate } = useLocate(setNear);
  const places = useMemo(() => (index.data?.places ?? []).filter((entry) => entry.t !== 'closed' && onLine(entry, id)), [index.data, id]);
  const sorted = useMemo(() => queryPlaces(places, { sort: near ? 'distance' : 'recent', near: near ?? undefined }), [places, near]);
  const highlight = useMemo(() => new Set(places.map((entry) => entry.id)), [places]);
  if (!line) return <NotFoundPage />;
  const open = places.filter((entry) => entry.t === 'open').length;

  return (
    <div className="line-page screen">
      <header className="line-head" style={lineVars(id)}>
        <p className="line-head-kicker">{copy.lines.title}</p>
        <h1>{line.label[locale]}</h1>
        <p>{copy.lines.pageLead(open)}</p>
        <p className="line-head-ends">
          {line.ends[0][locale]} ⇄ {copy.lines.hub} ⇄ {line.ends[1][locale]}
        </p>
      </header>
      <div className="browse">
        <div className="browse-main">
          <div className="browse-tools">
            <Pill icon="locate" active={near !== null} aria-pressed={near !== null} disabled={locating} onClick={() => (near ? setNear(null) : locate())}>
              {copy.home.near}
            </Pill>
            <span className="muted">{copy.home.count(sorted.length, sorted.length)}</span>
          </div>
          {index.data === null ? (
            <Skeleton height={300} />
          ) : (
            <div className="place-list">
              {sorted.slice(0, shown).map((entry) => (
                <PlaceRow key={entry.id} entry={entry} lines={[id]} km={near && entry.la !== null && entry.lo !== null ? distanceKm(near, { lat: entry.la, lng: entry.lo }) : null} />
              ))}
            </div>
          )}
          {sorted.length > shown ? (
            <div className="more">
              <Button icon="down" onClick={() => setShown((count) => count + PAGE)}>
                {copy.home.more(Math.min(PAGE, sorted.length - shown))}
              </Button>
            </div>
          ) : null}
        </div>
        <aside className="browse-side">
          <CityMap entries={index.data?.places ?? []} tone="faint" bounds={LONDON} highlight={highlight} highlightColor={lineColor(id)} label={line.label[locale]} className="side-map" />
          <h2 className="side-title">{copy.lines.cuisines}</h2>
          <p className="tags">
            {line.cuisines.map((cuisine) => (
              <span key={cuisine} className="tag">
                {cuisineLabel(cuisine, locale)}
              </span>
            ))}
          </p>
          <h2 className="side-title">{copy.lines.others}</h2>
          <p className="line-others">
            {LINES.filter((other) => other.id !== id).map((other) => (
              <Link key={other.id} href={paths.line(locale, other.id)}>
                <LineBadge id={other.id} />
              </Link>
            ))}
          </p>
        </aside>
      </div>
    </div>
  );
}
