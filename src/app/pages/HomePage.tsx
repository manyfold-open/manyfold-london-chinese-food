/**
 * The front page, laid out as a search: the filters in a column on the left (a sheet on a phone),
 * and on the right one search box for places, dishes and postcode districts, then the places as
 * a list, a grid of cards or a map. Everything is computed in the browser from the index (one
 * file for every place, src/shared/places-query.ts) and, once someone types, the dish catalog.
 * Places sort by distance, by their newest review or by name: never by how good anyone says they
 * are. What the site is, and why it has no ratings, is on the About page.
 *
 * The search is kept in the page's history entry with how far down the list the reader had got,
 * so Back from a place finds the list as it was, scrolled where it was (src/app/router.tsx). The
 * filters, sort and layout are also remembered in this browser, for the next visit.
 */

import { lazy, Suspense, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { normDish } from '../../shared/dish';
import { normName } from '../../shared/kinds';
import type { IndexEntry } from '../../shared/place-doc';
import { distanceKm, facetCounts, queryPlaces, type PlaceSort } from '../../shared/places-query';
import { FilterPanel, filterCount, NO_FILTERS, readFilters, type Filters } from '../components/Filters';
import type { Camera } from '../components/MapView';
import { PlaceCard, PlaceRow } from '../components/PlaceRow';
import { useDishCatalog, useIndex } from '../data';
import { useCopy, useLocale } from '../i18n';
import { Link, useEntryState } from '../router';
import { paths } from '../routes';
import { Button, Icon, Pill, SearchField, Segmented, Select, Sheet, Skeleton, useToast } from '../ui';

const MapView = lazy(() => import('../components/MapView'));

const PAGE = 60;
/** This browser's filters, sort and layout (localStorage). */
const SAVED = 'lcf.home';

type Layout = 'list' | 'grid' | 'map';

interface HomeState {
  q: string;
  filters: Filters;
  sort: PlaceSort;
  layout: Layout;
  /** Places shown so far: "Show more" adds a page. */
  shown: number;
  near: { lat: number; lng: number } | null;
  camera: Camera | null;
}

const SORTS: readonly PlaceSort[] = ['distance', 'recent', 'name'];
const LAYOUTS: readonly Layout[] = ['list', 'grid', 'map'];
const isSort = (value: unknown): value is PlaceSort => SORTS.includes(value as PlaceSort);
const isLayout = (value: unknown): value is Layout => LAYOUTS.includes(value as Layout);
const finite = (...values: unknown[]) => values.every((value) => typeof value === 'number' && Number.isFinite(value));

/** The search this tab had last: a new visit to the page in the same tab starts from it. */
let last: HomeState | null = null;

/** The filters, sort and layout this browser chose before, or none. */
function saved(): Pick<HomeState, 'filters' | 'sort' | 'layout'> {
  let stored: { filters?: unknown; sort?: unknown; layout?: unknown } = {};
  try {
    stored = (JSON.parse(localStorage.getItem(SAVED) ?? '{}') as typeof stored | null) ?? {};
  } catch {
    // storage blocked or unreadable: start from none
  }
  return { filters: readFilters(stored.filters), sort: isSort(stored.sort) ? stored.sort : 'recent', layout: isLayout(stored.layout) ? stored.layout : 'list' };
}

/** The page's state from its history entry, checked; else the tab's last search, else the saved filters. */
function readHome(stored: unknown): HomeState {
  if (!stored || typeof stored !== 'object') return last ? { ...last, shown: PAGE } : { ...saved(), q: '', shown: PAGE, near: null, camera: null };
  const value = stored as Partial<Record<keyof HomeState, unknown>>;
  const near = value.near as Partial<{ lat: unknown; lng: unknown }> | null | undefined;
  const camera = value.camera as Partial<Record<keyof Camera, unknown>> | null | undefined;
  return {
    q: typeof value.q === 'string' ? value.q : '',
    filters: readFilters(value.filters),
    sort: isSort(value.sort) ? value.sort : 'recent',
    layout: isLayout(value.layout) ? value.layout : 'list',
    shown: typeof value.shown === 'number' && value.shown > PAGE ? Math.floor(value.shown) : PAGE,
    near: near && finite(near.lat, near.lng) ? { lat: near.lat as number, lng: near.lng as number } : null,
    camera: camera && finite(camera.lng, camera.lat, camera.zoom) ? (camera as Camera) : null,
  };
}

export function HomePage() {
  const copy = useCopy();
  const locale = useLocale();
  const toast = useToast();
  const index = useIndex();
  const [home, setHome] = useEntryState('home', readHome);
  const { filters, sort, layout, shown, near } = home;
  const q = useDeferredValue(home.q.trim());
  const [locating, setLocating] = useState(false);
  const [sheet, setSheet] = useState(false);
  const head = useRef<HTMLDivElement>(null);
  const sortLabel = useId();
  const catalog = useDishCatalog(q.length > 0);

  useEffect(() => {
    last = home;
  }, [home]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED, JSON.stringify({ filters, sort, layout }));
    } catch {
      // storage blocked: the choice lasts as long as the page
    }
  }, [filters, sort, layout]);

  const places = useMemo(() => index.data?.places ?? [], [index.data]);
  const query = useMemo(() => ({ q: q || undefined, ...filters, sort, near: near ?? undefined }), [q, filters, sort, near]);
  const found = useMemo(() => queryPlaces(places, query), [places, query]);
  const counts = useMemo(() => (index.data ? facetCounts(places, query) : null), [index.data, places, query]);
  const totals = useMemo(() => (index.data ? facetCounts(places, {}) : null), [index.data, places]);
  const dishes = useMemo(() => {
    if (!q || !catalog.data) return [];
    const wanted = normDish(q);
    const words = normName(q);
    return catalog.data.dishes
      .filter(([key, zh, en]) => key.includes(wanted) || (zh && normDish(zh).includes(wanted)) || (en && normName(en).includes(words)))
      .sort((a, b) => b[3] - a[3])
      .slice(0, 8);
  }, [q, catalog.data]);

  /** A changed list starts at its top: back up to it when the reader is further down. */
  const toTop = () => {
    const element = head.current;
    if (element && element.getBoundingClientRect().top < parseFloat(getComputedStyle(element).scrollMarginTop)) element.scrollIntoView({ block: 'start' });
  };
  /** A new search: its first page of places, from the top. */
  const refine = (patch: Partial<HomeState>) => {
    setHome((previous) => ({ ...previous, ...patch, shown: PAGE }));
    toTop();
  };

  const locate = () => {
    if (near) {
      refine({ near: null, sort: sort === 'distance' ? 'recent' : sort });
      return;
    }
    if (!navigator.geolocation) {
      toast(copy.home.nearDenied);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        refine({ near: { lat: position.coords.latitude, lng: position.coords.longitude }, sort: 'distance' });
      },
      () => {
        setLocating(false);
        toast(copy.home.nearDenied);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const set = filterCount(filters);
  const km = (entry: IndexEntry) => (near && entry.la !== null && entry.lo !== null ? distanceKm(near, { lat: entry.la, lng: entry.lo }) : null);
  const panel = <FilterPanel filters={filters} counts={counts} totals={totals} onChange={(next) => refine({ filters: next })} />;
  const clear = (
    <button type="button" className="link-button" onClick={() => refine({ filters: NO_FILTERS })}>
      {copy.home.clear}
    </button>
  );
  const layouts = [
    { value: 'list' as const, icon: 'list' as const, label: copy.home.list },
    { value: 'grid' as const, icon: 'grid' as const, label: copy.home.grid },
    { value: 'map' as const, icon: 'map' as const, label: copy.home.map },
  ];

  return (
    <div className="home screen">
      <h1 className="visually-hidden">{copy.tagline}</h1>

      <div className="home-search">
        <SearchField value={home.q} label={copy.home.searchPlaceholder} onChange={(value) => setHome((previous) => ({ ...previous, q: value, shown: PAGE }))} />
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
      </div>

      <aside className="home-side" aria-label={copy.home.filters}>
        <div className="side-head">
          <h2>{copy.home.filters}</h2>
          {set > 0 ? clear : null}
        </div>
        {panel}
      </aside>

      <div className="results-head" ref={head}>
        <div className="results-tools">
          <Pill className="filters-button" icon="filter" active={set > 0} onClick={() => setSheet(true)}>
            {copy.home.filters}
            {set > 0 ? ` · ${set}` : ''}
          </Pill>
          <Pill icon="locate" active={near !== null} aria-pressed={near !== null} onClick={locate} disabled={locating}>
            {copy.home.near}
          </Pill>
          <span className="sort">
            <span id={sortLabel} className="sort-label">
              {copy.home.sortLabel}
            </span>
            <Select
              labelledBy={sortLabel}
              value={sort === 'distance' && !near ? 'recent' : sort}
              options={[
                ...(near ? [{ value: 'distance' as const, label: copy.home.sorts.distance }] : []),
                { value: 'recent' as const, label: copy.home.sorts.recent },
                { value: 'name' as const, label: copy.home.sorts.name },
              ]}
              onChange={(value) => refine({ sort: value })}
            />
          </span>
        </div>
        <p className="results-count" aria-live="polite">
          {index.data ? copy.home.count(found.length, places.length) : copy.home.loading}
        </p>
        <Segmented
          label={copy.home.layout}
          choices={layouts.map(({ value, icon, label }) => ({
            value,
            label: (
              <>
                <Icon name={icon} size={15} />
                <span className="layout-label">{label}</span>
              </>
            ),
          }))}
          value={layout}
          onChange={(value) => {
            setHome((previous) => ({ ...previous, layout: value }));
            toTop();
          }}
        />
      </div>

      <div className="results">
        {layout === 'map' ? (
          <Suspense fallback={<div className="map" />}>
            <MapView entries={found} locale={locale} near={near} camera={home.camera} onCamera={(camera) => setHome((previous) => ({ ...previous, camera }))} />
          </Suspense>
        ) : index.data === null ? (
          <div className={layout === 'grid' ? 'place-grid' : 'place-list'}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={layout === 'grid' ? 140 : 64} />
            ))}
          </div>
        ) : found.length === 0 ? (
          <p className="empty">{copy.home.empty}</p>
        ) : (
          <>
            {layout === 'grid' ? (
              <div className="place-grid">
                {found.slice(0, shown).map((entry) => (
                  <PlaceCard key={entry.id} entry={entry} km={km(entry)} />
                ))}
              </div>
            ) : (
              <div className="place-list">
                {found.slice(0, shown).map((entry) => (
                  <PlaceRow key={entry.id} entry={entry} km={km(entry)} />
                ))}
              </div>
            )}
            {found.length > shown ? (
              <div className="more">
                <Button onClick={() => setHome((previous) => ({ ...previous, shown: previous.shown + PAGE }))} icon="down">
                  {copy.home.more(Math.min(PAGE, found.length - shown))}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <Sheet
        open={sheet}
        title={copy.home.filters}
        onClose={() => setSheet(false)}
        action={clear}
        footer={
          <Button variant="primary" onClick={() => setSheet(false)}>
            {copy.home.showResults(found.length)}
          </Button>
        }
      >
        {panel}
      </Sheet>
    </div>
  );
}
