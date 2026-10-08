/**
 * The front page: one search box for places, dishes and postcode districts, the kinds of place,
 * filters, and the list or the map. Everything is computed in the browser from the index (one
 * file for every place, src/shared/places-query.ts) and, once someone types, the dish catalog.
 * Places sort by distance, by their newest review or by name: never by how good anyone says they are.
 */

import { lazy, Suspense, useDeferredValue, useMemo, useState } from 'react';
import { normDish } from '../../shared/dish';
import { normName } from '../../shared/kinds';
import { distanceKm, queryPlaces, type PlaceSort } from '../../shared/places-query';
import { PlaceRow } from '../components/PlaceRow';
import { useDishCatalog, useIndex } from '../data';
import { useCopy, useLocale } from '../i18n';
import { BOROUGH_CODES, boroughLabel, categoryLabel, CATEGORIES, CUISINES, cuisineLabel } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';
import { Button, CheckRow, Pill, SearchField, Segmented, Sheet, Skeleton } from '../ui';

const MapView = lazy(() => import('../components/MapView'));

const PAGE = 60;

interface Filters {
  categories: string[];
  cuisines: string[];
  boroughs: string[];
  openOnly: boolean;
  withMenu: boolean;
  withPhotos: boolean;
}

const NO_FILTERS: Filters = { categories: [], cuisines: [], boroughs: [], openOnly: true, withMenu: false, withPhotos: false };

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

export function HomePage() {
  const copy = useCopy();
  const locale = useLocale();
  const index = useIndex();
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<PlaceSort>('recent');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const catalog = useDishCatalog(q.length > 0);

  const places = useMemo(() => index.data?.places ?? [], [index.data]);
  const found = useMemo(
    () =>
      queryPlaces(places, {
        q: q || undefined,
        categories: filters.categories,
        cuisines: filters.cuisines,
        boroughs: filters.boroughs,
        openOnly: filters.openOnly,
        withMenu: filters.withMenu,
        withPhotos: filters.withPhotos,
        sort,
        near: near ?? undefined,
      }),
    [places, q, filters, sort, near],
  );
  const dishes = useMemo(() => {
    if (!q || !catalog.data) return [];
    const wanted = normDish(q);
    const words = normName(q);
    return catalog.data.dishes
      .filter(([key, zh, en]) => key.includes(wanted) || (zh && normDish(zh).includes(wanted)) || (en && normName(en).includes(words)))
      .sort((a, b) => b[3] - a[3])
      .slice(0, 8);
  }, [q, catalog.data]);

  const locate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setNear({ lat: position.coords.latitude, lng: position.coords.longitude });
        setSort('distance');
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const filterCount = filters.cuisines.length + filters.boroughs.length + (filters.withMenu ? 1 : 0) + (filters.withPhotos ? 1 : 0) + (filters.openOnly ? 0 : 1);

  return (
    <div className="home screen">
      <section className="hero">
        <h1>{copy.tagline}</h1>
        <p className="lead">{copy.description}</p>
        <SearchField value={text} label={copy.home.searchPlaceholder} onChange={(value) => { setText(value); setShown(PAGE); }} />
      </section>

      {dishes.length > 0 ? (
        <section className="dish-hits" aria-label={copy.home.dishesMatching}>
          <h2>{copy.home.dishesMatching}</h2>
          <div className="chips">
            {dishes.map(([key, zh, en, count]) => (
              <Link key={key} className="dish-hit" href={paths.dish(locale, key)}>
                <b>{locale === 'zh' ? (zh ?? en ?? key) : (en ?? zh ?? key)}</b>
                <span>{copy.home.servedAt(count)}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="toolbar">
        <div className="pills" role="group" aria-label={copy.home.category}>
          {CATEGORIES.map((value) => (
            <Pill key={value} active={filters.categories.includes(value)} aria-pressed={filters.categories.includes(value)} onClick={() => setFilters({ ...filters, categories: toggle(filters.categories, value) })}>
              {categoryLabel(value, locale)}
            </Pill>
          ))}
        </div>
        <span className="grow" />
        <Pill icon="filter" active={filterCount > 0} onClick={() => setSheet(true)}>
          {copy.home.filters}
          {filterCount > 0 ? ` · ${filterCount}` : ''}
        </Pill>
        <Pill icon="locate" active={near !== null} onClick={locate} disabled={locating}>
          {copy.home.near}
        </Pill>
        <Segmented
          label={copy.home.sortLabel}
          choices={[
            ...(near ? [{ value: 'distance' as const, label: copy.home.sorts.distance }] : []),
            { value: 'recent' as const, label: copy.home.sorts.recent },
            { value: 'name' as const, label: copy.home.sorts.name },
          ]}
          value={sort === 'distance' && !near ? 'recent' : sort}
          onChange={setSort}
        />
        <Segmented
          label={copy.home.map}
          choices={[
            { value: 'list' as const, label: copy.home.list },
            { value: 'map' as const, label: copy.home.map },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <p className="count" aria-live="polite">
        {index.data ? copy.home.count(found.length, places.length) : copy.home.loading}
      </p>

      {view === 'map' ? (
        <Suspense fallback={<div className="map" />}>
          <MapView entries={found} locale={locale} near={near} />
        </Suspense>
      ) : index.data === null ? (
        <div className="place-list">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={64} />
          ))}
        </div>
      ) : found.length === 0 ? (
        <p className="empty">{copy.home.empty}</p>
      ) : (
        <>
          <div className="place-list">
            {found.slice(0, shown).map((entry) => (
              <PlaceRow
                key={entry.id}
                entry={entry}
                km={near && entry.la !== null && entry.lo !== null ? distanceKm(near, { lat: entry.la, lng: entry.lo }) : null}
              />
            ))}
          </div>
          {found.length > shown ? (
            <div className="more">
              <Button onClick={() => setShown(shown + PAGE)} icon="down">
                {locale === 'zh' ? `再显示 ${Math.min(PAGE, found.length - shown)} 家` : `Show ${Math.min(PAGE, found.length - shown)} more`}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Sheet
        open={sheet}
        title={copy.home.filters}
        onClose={() => setSheet(false)}
        action={
          <button type="button" className="link-button" onClick={() => setFilters(NO_FILTERS)}>
            {copy.home.clear}
          </button>
        }
      >
        <div className="filter-sheet">
          <CheckRow checked={filters.openOnly} label={copy.home.openOnly} onToggle={() => setFilters({ ...filters, openOnly: !filters.openOnly })} />
          <CheckRow checked={filters.withMenu} label={copy.home.withMenu} onToggle={() => setFilters({ ...filters, withMenu: !filters.withMenu })} />
          <CheckRow checked={filters.withPhotos} label={copy.home.withPhotos} onToggle={() => setFilters({ ...filters, withPhotos: !filters.withPhotos })} />
          <h3>{copy.home.cuisine}</h3>
          <div className="pills wrap">
            {CUISINES.map((value) => (
              <Pill key={value} active={filters.cuisines.includes(value)} aria-pressed={filters.cuisines.includes(value)} onClick={() => setFilters({ ...filters, cuisines: toggle(filters.cuisines, value) })}>
                {cuisineLabel(value, locale)}
              </Pill>
            ))}
          </div>
          <h3>{copy.home.borough}</h3>
          <div className="pills wrap">
            {BOROUGH_CODES.map((code) => (
              <Pill key={code} active={filters.boroughs.includes(code)} aria-pressed={filters.boroughs.includes(code)} onClick={() => setFilters({ ...filters, boroughs: toggle(filters.boroughs, code) })}>
                {boroughLabel(code, locale)}
              </Pill>
            ))}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
