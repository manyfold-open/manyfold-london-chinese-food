/**
 * The guides (src/shared/guides.ts): their list, and one guide. A filter guide lists every place its
 * filter takes, newest review first or nearest first. A route guide walks from a campus: its stops
 * in walking order, each with the dishes on its menu that answer the guide, priced from the place's
 * menu as it is now, nearest first. Neither is a ranking, and each page says how its places were chosen.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CAMPUSES, campusById, nearestStation, walkMinutes, type Campus } from '../../shared/campuses';
import { GUIDES, guideBySlug, inGuide, type Guide, type GuideStop } from '../../shared/guides';
import type { DocItem, IndexEntry, PlaceDoc } from '../../shared/place-doc';
import { distanceKm, queryPlaces } from '../../shared/places-query';
import { DishImage } from '../components/DishImage';
import { CityMap, LONDON, type Bounds, type Marker } from '../components/CityMap';
import { lineColor, lineVars } from '../components/Lines';
import { PlaceRow } from '../components/PlaceRow';
import { useIllustrations, useIndex, usePlace } from '../data';
import { price } from '../format';
import type { Near } from '../geo';
import { useLocate } from '../geo';
import { useCopy, useLocale } from '../i18n';
import { placeNames } from '../labels';
import { Link, navigate } from '../router';
import { paths } from '../routes';
import { shareCard } from '../share';
import { Button, Icon, Pill, Skeleton, useToast } from '../ui';
import { NotFoundPage } from './TextPages';

export function GuidesPage() {
  const copy = useCopy();
  const locale = useLocale();
  const index = useIndex();
  const places = index.data?.places ?? [];
  return (
    <div className="guides-page screen">
      <header className="page-intro">
        <h1>{copy.guides.title}</h1>
        <p>{copy.guides.lead}</p>
      </header>
      <div className="guide-shelf">
        {GUIDES.map((guide) => (
          <Link key={guide.slug} className="guide-tile" href={paths.guide(locale, guide.slug)} style={lineVars(guide.line)}>
            <span className="guide-tag">
              {guide.tag[locale]} · {copy.guides.issue(guide.issue)}
            </span>
            <b>{guide.title[locale]}</b>
            <span className="guide-dek">{guide.dek[locale]}</span>
            <span className="guide-count">
              {guide.routes
                ? copy.guides.campuses(Object.keys(guide.routes).length)
                : index.data
                  ? copy.guides.places(places.filter((entry) => inGuide(guide.filter ?? {}, entry)).length)
                  : ''}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function GuidePage({ slug, campus: campusId }: { slug: string; campus: string | null }) {
  const guide = guideBySlug(slug);
  if (!guide) return <NotFoundPage />;
  if (guide.routes) {
    const ids = Object.keys(guide.routes);
    const campus = campusById(campusId ?? ids[0]!);
    if (!campus || !guide.routes[campus.id]) return <NotFoundPage />;
    return <RouteGuide key={campus.id} guide={guide} campus={campus} stops={guide.routes[campus.id]!} />;
  }
  if (campusId) return <NotFoundPage />;
  return <FilterGuide guide={guide} />;
}

function Cover({ guide, children }: { guide: Guide; children?: ReactNode }) {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <header className="guide-head" style={lineVars(guide.line)}>
      <div className="guide-head-text">
        <p className="guide-issue">
          <span>{guide.tag[locale]}</span>
          <span>{copy.guides.issue(guide.issue)}</span>
        </p>
        <h1>{guide.title[locale]}</h1>
        <p className="guide-head-dek">{guide.dek[locale]}</p>
      </div>
      {children}
    </header>
  );
}

function ShareButton({ make }: { make: () => Parameters<typeof shareCard>[0] }) {
  const copy = useCopy();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      icon="share"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        shareCard(make(), 'london-chinese-food.png')
          .catch(() => toast(copy.share.failed))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? copy.share.making : copy.guides.share}
    </Button>
  );
}

function FilterGuide({ guide }: { guide: Guide }) {
  const copy = useCopy();
  const locale = useLocale();
  const index = useIndex();
  const [near, setNear] = useState<Near | null>(null);
  const { locating, locate } = useLocate(setNear);
  const places = useMemo(() => (index.data?.places ?? []).filter((entry) => inGuide(guide.filter ?? {}, entry)), [index.data, guide]);
  const sorted = useMemo(() => queryPlaces(places, { sort: near ? 'distance' : 'recent', near: near ?? undefined }), [places, near]);
  const highlight = useMemo(() => new Set(places.map((entry) => entry.id)), [places]);
  const bounds = useMemo(() => boundsOf(places.flatMap((entry) => (entry.la !== null && entry.lo !== null ? [{ lat: entry.la, lng: entry.lo }] : []))) ?? LONDON, [places]);
  return (
    <div className="guide-page screen">
      <Cover guide={guide} />
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
          ) : sorted.length === 0 ? (
            <p className="empty">{copy.guides.empty}</p>
          ) : (
            <div className="place-list">
              {sorted.map((entry) => (
                <PlaceRow key={entry.id} entry={entry} lines={[guide.line]} km={near && entry.la !== null && entry.lo !== null ? distanceKm(near, { lat: entry.la, lng: entry.lo }) : null} />
              ))}
            </div>
          )}
        </div>
        <aside className="browse-side">
          <CityMap entries={index.data?.places ?? []} tone="faint" bounds={bounds} highlight={highlight} highlightColor={lineColor(guide.line)} label={guide.title[locale]} className="side-map tall" />
          <p className="guide-rule">{guide.rule[locale]}</p>
          <ShareButton
            make={() => ({
              kicker: `${guide.tag[locale]} · ${copy.guides.issue(guide.issue)}`,
              title: guide.title[locale],
              lead: guide.dek[locale],
              rows: sorted.slice(0, 9).map((entry) => ({ label: placeNames({ en: entry.n, zh: entry.z }, locale).main, value: entry.o ?? undefined })),
              line: guide.line,
              site: copy.brand.name,
              path: paths.guide(locale, guide.slug),
            })}
          />
        </aside>
      </div>
    </div>
  );
}

/** A box around some points with a margin, or null for none. */
function boundsOf(points: readonly { lat: number; lng: number }[], margin = 0.15): Bounds | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const dLat = Math.max(0.004, (north - south) * margin);
  const dLng = Math.max(0.006, (east - west) * margin);
  return [south - dLat, north + dLat, west - dLng, east + dLng];
}

/** A stop's menu items, by key, as the menu has them now. */
const itemsOf = (doc: PlaceDoc | null, keys: readonly string[]): DocItem[] =>
  doc ? keys.flatMap((key) => doc.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items.filter((item) => item.key === key))).slice(0, 1)) : [];

function RouteGuide({ guide, campus, stops }: { guide: Guide; campus: Campus; stops: readonly GuideStop[] }) {
  const copy = useCopy();
  const locale = useLocale();
  const index = useIndex();
  const [docs, setDocs] = useState<Record<string, PlaceDoc>>({});
  const byId = useMemo(() => new Map((index.data?.places ?? []).map((entry) => [entry.id, entry])), [index.data]);
  const located = stops.flatMap((stop) => {
    const entry = byId.get(stop.place);
    return entry && entry.la !== null && entry.lo !== null && entry.t !== 'closed' ? [{ stop, entry, lat: entry.la, lng: entry.lo, km: distanceKm(campus, { lat: entry.la, lng: entry.lo }) }] : [];
  });
  // Memoised on the stops found, so the maps do not redraw on every render.
  const found = located.map((l) => l.stop.place).join();
  const route = useMemo(() => [{ lat: campus.lat, lng: campus.lng }, ...located.map(({ lat, lng }) => ({ lat, lng }))], [campus, found]);
  const stations = [...new Set(located.map(({ lat, lng }) => nearestStation({ lat, lng })?.name).filter((name): name is string => Boolean(name)))];
  const markers = useMemo<Marker[]>(
    () => [
      { lat: campus.lat, lng: campus.lng, kind: 'uni', label: campus.short },
      ...located.map(({ entry, lat, lng }, i) => ({ lat, lng, kind: 'stop' as const, label: i + 1, sub: placeNames({ en: entry.n, zh: entry.z }, locale).main, href: paths.place(locale, entry.id, entry.s), shift: i % 2 ? '-17px 30%' : undefined })),
    ],
    [campus, found, locale],
  );
  const priced = Object.values(docs).flatMap((doc) => itemsOf(doc, stops.find((stop) => stop.place === doc.id)?.items ?? []).flatMap((item) => (item.price_pence !== undefined ? [item.price_pence] : [])));
  const farthest = located.length ? walkMinutes(Math.max(...located.map((l) => l.km))) : null;
  const campuses = CAMPUSES.filter((c) => guide.routes?.[c.id]);

  return (
    <div className="guide-page screen">
      <Cover guide={guide}>
        <div className="route-card">
          <p className="route-cap">{copy.guides.route([campus.short, ...stations.slice(0, 3)].join(' → '))}</p>
          <RouteStrip names={[campus.short, ...stations.slice(0, 3)]} />
          <div className="route-stats">
            <div>
              <b>{located.length}</b>
              <span>{copy.guides.stopsUnit(located.length)}</span>
            </div>
            <div>
              <b>{farthest ?? '…'}</b>
              <span>{copy.guides.lastStop}</span>
            </div>
            <div>
              <b>{priced.length ? price(Math.min(...priced)) : '…'}</b>
              <span>{copy.guides.cheapest}</span>
            </div>
          </div>
        </div>
      </Cover>
      <nav className="campus-picker" aria-label={copy.guides.pick}>
        {campuses.map((c) => (
          <button key={c.id} type="button" className={c.id === campus.id ? 'on' : undefined} aria-pressed={c.id === campus.id} onClick={() => navigate(paths.guide(locale, guide.slug, c.id), { replace: true })}>
            {c.short}
          </button>
        ))}
      </nav>
      <div className="browse">
        <ol className="stops">
          {located.map(({ stop, entry, km }, i) => (
            <Stop key={stop.place} n={i + 1} stop={stop} entry={entry} minutes={walkMinutes(km)} onDoc={(doc) => setDocs((previous) => (previous[doc.id] ? previous : { ...previous, [doc.id]: doc }))} />
          ))}
        </ol>
        <aside className="browse-side">
          <CityMap
            entries={index.data?.places ?? []}
            tone="faint"
            bounds={boundsOf(route, 0.25) ?? LONDON}
            fit="contain"
            route={route}
            markers={markers}
            label={guide.title[locale]}
            className="side-map tall"
          />
          <p className="guide-rule">{guide.rule[locale]}</p>
          <ShareButton
            make={() => ({
              kicker: `${guide.tag[locale]} · ${campus.short}`,
              title: guide.title[locale],
              lead: guide.dek[locale],
              rows: located.flatMap(({ stop, entry }, i) => {
                const name = placeNames({ en: entry.n, zh: entry.z }, locale).main;
                const items = itemsOf(docs[stop.place] ?? null, stop.items);
                return items.length
                  ? items.map((item) => ({ label: `${i + 1} · ${name} · ${(locale === 'zh' ? (item.name_zh ?? item.name_en) : (item.name_en ?? item.name_zh)) ?? ''}`, value: item.price_pence !== undefined ? price(item.price_pence) : undefined }))
                  : [{ label: `${i + 1} · ${name}` }];
              }),
              line: guide.line,
              site: copy.brand.name,
              path: paths.guide(locale, guide.slug, campus.id),
            })}
          />
        </aside>
      </div>
    </div>
  );
}

/** The walk as a strip of line with its stations. */
function RouteStrip({ names }: { names: readonly string[] }) {
  const W = 520;
  const y = 18;
  return (
    <svg className="route-strip" viewBox={`0 0 ${W} 52`} aria-hidden="true">
      <path d={`M 12 ${y} H ${W - 12}`} className="route-strip-line" />
      {names.map((name, i) => {
        const x = names.length === 1 ? 12 : 12 + ((W - 24) * i) / (names.length - 1);
        const end = i === 0 || i === names.length - 1;
        return (
          <g key={`${name}-${i}`}>
            <circle cx={x} cy={y} r={end ? 7.5 : 5.5} className={end ? 'route-strip-end' : 'route-strip-stop'} />
            <text x={x} y={y + 26} textAnchor={i === 0 ? 'start' : i === names.length - 1 ? 'end' : 'middle'}>
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Stop({ n, stop, entry, minutes, onDoc }: { n: number; stop: GuideStop; entry: IndexEntry; minutes: number; onDoc: (doc: PlaceDoc) => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const { data: doc } = usePlace(stop.place);
  const illustrations = useIllustrations();
  useEffect(() => {
    if (doc) onDoc(doc);
  }, [doc, onDoc]);
  const names = placeNames({ en: entry.n, zh: entry.z }, locale);
  const items = itemsOf(doc, stop.items);
  const dishes = new Set(items.map((item) => item.dish).filter(Boolean));
  const review = doc?.reviews.find((r) => r.dishes.some((d) => d.dish !== null && dishes.has(d.dish))) ?? null;
  const translated = review && review.language !== locale && review.translation;
  const station = entry.la !== null && entry.lo !== null ? nearestStation({ lat: entry.la, lng: entry.lo }) : null;
  return (
    <li className="stop">
      <span className="stop-no">{n}</span>
      <div className="stop-body">
        <div className="stop-head">
          <div>
            <h3>
              <Link href={paths.place(locale, entry.id, entry.s)}>{names.main}</Link>
              {names.other ? <small>{names.other}</small> : null}
            </h3>
            <p className="stop-where">
              <Icon name="walk" size={14} />
              {station ? `${station.name} · ` : ''}
              {copy.guides.walkTo(minutes)}
            </p>
          </div>
          {items[0]?.dish ? (
            <span className="stop-pic">
              <DishImage photo={items[0].photo?.id ?? null} dish={items[0].dish} name={items[0].name_zh ?? items[0].name_en ?? ''} illustrations={illustrations.data} />
            </span>
          ) : null}
        </div>
        {doc === null ? (
          <Skeleton height={30} width="60%" />
        ) : (
          <p className="eat">
            {items.map((item) => (
              <span key={item.key}>
                {(locale === 'zh' ? (item.name_zh ?? item.name_en) : (item.name_en ?? item.name_zh)) ?? ''} <b>{item.price_pence !== undefined ? price(item.price_pence) : ''}</b>
              </span>
            ))}
          </p>
        )}
        {review ? (
          <blockquote className="stop-quote">
            “{translated ? review.translation : review.excerpt}”<cite>{[translated ? copy.quotes.translated : null, review.publication].filter(Boolean).join(' · ')}</cite>
          </blockquote>
        ) : null}
      </div>
    </li>
  );
}
