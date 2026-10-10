/**
 * Where a dish can be eaten: every place whose menu lists it or whose reviews mention it, as a
 * list or on the map. The view, where the reader is and where the map was left are kept in the
 * page's history entry, so Back from a place finds the page as it was (src/app/router.tsx).
 */

import { lazy, Suspense, useMemo } from 'react';
import { standardDish } from '../../shared/dish';
import type { IndexEntry } from '../../shared/place-doc';
import { distanceKm } from '../../shared/places-query';
import { DishImage } from '../components/DishImage';
import { useDish, useIllustrations, useIndex } from '../data';
import { distance, price } from '../format';
import { readCamera, readNear, useLocate, type Camera, type Near } from '../geo';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, placeNames } from '../labels';
import { Link, useEntryState } from '../router';
import { paths } from '../routes';
import { Icon, Pill, Segmented, Skeleton } from '../ui';

const MapView = lazy(() => import('../components/MapView'));

type Layout = 'list' | 'map';

interface DishState {
  layout: Layout;
  near: Near | null;
  camera: Camera | null;
}

function readDish(stored: unknown): DishState {
  const value = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof DishState, unknown>>;
  return { layout: value.layout === 'map' ? 'map' : 'list', near: readNear(value.near), camera: readCamera(value.camera) };
}

export function DishPage({ dishKey }: { dishKey: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const dish = useDish(dishKey);
  const index = useIndex();
  const illustrations = useIllustrations();
  const [state, setState] = useEntryState('dish', readDish);
  const { layout, near } = state;
  const { locating, locate } = useLocate((found) => setState((previous) => ({ ...previous, near: found })));
  const entry = standardDish(dishKey);
  const name = (locale === 'zh' ? entry?.zh : entry?.en) ?? dish.data?.places[0]?.entry[locale === 'zh' ? 'name_zh' : 'name_en'] ?? dishKey;

  const rows = useMemo(() => {
    const byId = new Map((index.data?.places ?? []).map((place) => [place.id, place]));
    const seen = new Map<string, { place: IndexEntry; via: string; price: number | null; photo: string | null }>();
    for (const row of dish.data?.places ?? []) {
      const place = byId.get(row.place_id);
      if (!place || seen.has(place.id)) continue;
      seen.set(place.id, { place, via: row.via, price: row.entry.price_pence, photo: row.entry.photo });
    }
    const list = [...seen.values()];
    const km = (place: IndexEntry) => (near && place.la !== null && place.lo !== null ? distanceKm(near, { lat: place.la, lng: place.lo }) : null);
    return list
      .map((row) => ({ ...row, km: km(row.place) }))
      .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || (a.via === b.via ? 0 : a.via === 'menu' ? -1 : 1) || (a.place.n ?? a.place.z ?? '').localeCompare(b.place.n ?? b.place.z ?? ''));
  }, [dish.data, index.data, near]);
  const places = useMemo(() => rows.map((row) => row.place), [rows]);
  const ready = dish.data !== null && index.data !== null;

  return (
    <div className="dish-page screen">
      <nav className="crumbs">
        <Link href={paths.home(locale)}>{copy.nav.home}</Link>
        <Icon name="right" size={14} />
        <span>{name}</span>
      </nav>
      <header className="dish-head">
        <DishImage photo={null} dish={dishKey} name={name} illustrations={illustrations.data} size="full" />
        <div>
          <h1>{copy.dish.title(name)}</h1>
          {entry ? <p className="other-name">{locale === 'zh' ? entry.en : entry.zh}</p> : null}
          {entry ? <p className="lead">{entry.description}</p> : null}
          {dish.data ? <p className="meta">{rows.length ? copy.dish.lead(rows.length) : copy.dish.none}</p> : null}
        </div>
      </header>
      {ready && rows.length > 0 ? (
        <div className="dish-tools">
          <Pill
            icon="locate"
            active={near !== null}
            aria-pressed={near !== null}
            disabled={locating}
            onClick={() => (near ? setState((previous) => ({ ...previous, near: null })) : locate())}
          >
            {copy.home.near}
          </Pill>
          <Segmented
            label={copy.home.layout}
            choices={[
              { value: 'list' as const, icon: 'list' as const, label: copy.home.list },
              { value: 'map' as const, icon: 'map' as const, label: copy.home.map },
            ].map(({ value, icon, label }) => ({
              value,
              label: (
                <>
                  <Icon name={icon} size={15} />
                  <span className="layout-label">{label}</span>
                </>
              ),
            }))}
            value={layout}
            onChange={(value) => setState((previous) => ({ ...previous, layout: value }))}
          />
        </div>
      ) : null}
      {!ready ? (
        <Skeleton height={200} />
      ) : layout === 'map' && rows.length > 0 ? (
        <Suspense fallback={<div className="map" />}>
          <MapView
            entries={places}
            locale={locale}
            near={near}
            camera={state.camera}
            onCamera={(camera) => setState((previous) => ({ ...previous, camera }))}
            onLocate={locate}
            locating={locating}
            fit
          />
        </Suspense>
      ) : (
        <div className="place-list">
          {rows.map(({ place, via, price: pence, photo, km }) => {
            const names = placeNames({ en: place.n, zh: place.z }, locale);
            return (
              <Link key={place.id} className="place-row" href={paths.place(locale, place.id, place.s)}>
                {photo ? <DishImage photo={photo} dish={null} name={name} illustrations={null} /> : null}
                <span className="place-row-main">
                  <b>{names.main}</b>
                  {names.other ? <span className="other-name">{names.other}</span> : null}
                  <span className="place-row-meta">{via === 'menu' ? copy.dish.onMenu : copy.dish.inReviews}</span>
                </span>
                <span className="place-row-end">
                  {pence !== null ? <b>{price(pence)}</b> : null}
                  <span>{[km !== null ? distance(km, locale) : null, boroughLabel(place.b, locale), place.o].filter(Boolean).join(' · ')}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
