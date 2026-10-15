/**
 * The places near one campus: every open place within a straight-line kilometre, nearest first,
 * with about how long the walk is. Distance is the only order here.
 */

import { useMemo, type CSSProperties } from 'react';
import { CAMPUSES, campusById, NEAR_KM, placesNear, walkMinutes } from '../../shared/campuses';
import { guideBySlug } from '../../shared/guides';
import { linesOf } from '../../shared/lines';
import { CityMap, type Bounds, type Marker } from '../components/CityMap';
import { LineDot, lineColor, lineVars } from '../components/Lines';
import { useIndex } from '../data';
import { useCopy, useLocale } from '../i18n';
import { categoryLabel, cuisineLabel, placeNames } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';
import { Icon, Skeleton } from '../ui';
import { NotFoundPage } from './TextPages';

export function NearPage({ campusId }: { campusId: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const campus = campusById(campusId);
  const index = useIndex();
  const near = useMemo(() => (campus ? placesNear(index.data?.places ?? [], campus) : []), [index.data, campus]);
  const highlight = useMemo(() => new Set(near.map((n) => n.entry.id)), [near]);
  const markers = useMemo<Marker[]>(() => (campus ? [{ lat: campus.lat, lng: campus.lng, kind: 'here', label: campus.short, sub: campus.area }] : []), [campus]);
  if (!campus) return <NotFoundPage />;
  // The walk's circle and a little more: a kilometre is about 0.009° of latitude and 0.0144° of longitude here.
  const bounds: Bounds = [campus.lat - 0.0099, campus.lat + 0.0099, campus.lng - 0.0158, campus.lng + 0.0158];
  const guide = guideBySlug('full-for-a-tenner');
  const hasRoute = Boolean(guide?.routes?.[campus.id]);

  return (
    <div className="near-page screen">
      <header className="line-head" style={lineVars(campus.line)}>
        <p className="line-head-kicker">
          {campus.name[locale]} · {campus.area}
        </p>
        <h1>{copy.near.pageTitle(campus.short)}</h1>
        <p>{copy.near.pageLead(near.length)}</p>
        {hasRoute ? (
          <Link className="line-head-link" href={paths.guide(locale, 'full-for-a-tenner', campus.id)}>
            {copy.near.guide} <Icon name="right" size={15} />
          </Link>
        ) : null}
      </header>
      <div className="browse">
        <div className="browse-main">
          {index.data === null ? (
            <Skeleton height={300} />
          ) : (
            <ol className="walk-list">
              {near.map(({ entry, km }) => {
                const names = placeNames({ en: entry.n, zh: entry.z }, locale);
                const line = linesOf(entry)[0];
                return (
                  <li key={entry.id}>
                    <Link href={paths.place(locale, entry.id, entry.s)}>
                      {line ? <LineDot id={line} /> : <i className="line-dot" />}
                      <span className="walk-main">
                        <b>{names.main}</b>
                        {names.other ? <span className="other-name">{names.other}</span> : null}
                        <span className="walk-meta">{[categoryLabel(entry.c, locale), ...entry.k.slice(0, 2).map((value) => cuisineLabel(value, locale))].join(' · ')}</span>
                      </span>
                      <span className="walk-time">
                        <Icon name="walk" size={14} /> {copy.near.walk(walkMinutes(km))}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <aside className="browse-side">
          <CityMap
            entries={index.data?.places ?? []}
            tone="faint"
            bounds={bounds}
            highlight={highlight}
            highlightColor={lineColor(campus.line)}
            ring={{ lat: campus.lat, lng: campus.lng, km: NEAR_KM, color: lineColor(campus.line) }}
            markers={markers}
            label={campus.short}
            className="side-map tall"
          />
          <h2 className="side-title">{copy.near.others}</h2>
          <p className="campus-others">
            {CAMPUSES.filter((other) => other.id !== campus.id).map((other) => (
              <Link key={other.id} className="chip-link" href={paths.near(locale, other.id)} style={{ '--c': lineColor(other.line) } as CSSProperties}>
                <i />
                {other.short}
              </Link>
            ))}
          </p>
        </aside>
      </div>
    </div>
  );
}
