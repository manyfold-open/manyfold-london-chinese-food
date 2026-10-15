/**
 * Where a dish can be eaten: every place whose menu lists it or whose quotes name it. What the
 * menus charge, as a plot and in plain words; the places by price, by distance from the reader, or
 * by borough, as a table or on the map; what a writer said about it; dishes like it. The order is
 * never how good a place's version is. In English, a card to show the staff: the name in
 * characters and in pinyin. The view and where the map was left are kept in the history entry, so
 * Back from a place finds the page as it was (src/app/router.tsx).
 */

import { lazy, Suspense, useMemo, type CSSProperties } from 'react';
import { DISH_PINYIN } from '../../../kinds/dish-pinyin';
import { DISH_VOCAB } from '../../../kinds/dish-vocab';
import { standardDish } from '../../shared/dish';
import { LINES } from '../../shared/lines';
import type { IndexEntry } from '../../shared/place-doc';
import { distanceKm } from '../../shared/places-query';
import { DishImage } from '../components/DishImage';
import { CityMap, LONDON, type Marker } from '../components/CityMap';
import { LineBadge } from '../components/Lines';
import { PricePlot, priceStats } from '../components/PricePlot';
import { useDish, useIllustrations, useIndex, usePlace } from '../data';
import { distance, price } from '../format';
import { readCamera, readNear, useLocate, type Camera, type Near } from '../geo';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, categoryLabel, placeNames } from '../labels';
import { Link, useEntryState } from '../router';
import { paths } from '../routes';
import { Button, Icon, Segmented, Skeleton } from '../ui';

const MapView = lazy(() => import('../components/MapView'));

type Order = 'price' | 'near' | 'area';
type Layout = 'list' | 'map';

interface DishState {
  order: Order;
  layout: Layout;
  near: Near | null;
  camera: Camera | null;
  shown: number;
}

const PAGE = 20;

function readDish(stored: unknown): DishState {
  const value = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof DishState, unknown>>;
  return {
    order: value.order === 'near' || value.order === 'area' ? value.order : 'price',
    layout: value.layout === 'map' ? 'map' : 'list',
    near: readNear(value.near),
    camera: readCamera(value.camera),
    shown: typeof value.shown === 'number' && value.shown > PAGE ? Math.floor(value.shown) : PAGE,
  };
}

const lineOfCuisine = new Map(LINES.flatMap((line) => line.cuisines.map((cuisine) => [cuisine, line.id] as const)));

interface Row {
  place: IndexEntry;
  via: 'menu' | 'review';
  pence: number | null;
  photo: string | null;
  km: number | null;
}

export function DishPage({ dishKey }: { dishKey: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const dish = useDish(dishKey);
  const index = useIndex();
  const illustrations = useIllustrations();
  const [state, setState] = useEntryState('dish', readDish);
  const { order, layout, near, shown } = state;
  const { locating, locate } = useLocate((found) => setState((previous) => ({ ...previous, near: found, order: 'near' })));
  const entry = standardDish(dishKey);
  const name = (locale === 'zh' ? entry?.zh : entry?.en) ?? dish.data?.places[0]?.entry[locale === 'zh' ? 'name_zh' : 'name_en'] ?? dishKey;
  const other = entry ? (locale === 'zh' ? entry.en : entry.zh) : null;
  const line = entry ? lineOfCuisine.get(entry.cuisine) : undefined;

  const rows = useMemo(() => {
    const byId = new Map((index.data?.places ?? []).map((place) => [place.id, place]));
    const seen = new Map<string, Row>();
    for (const row of dish.data?.places ?? []) {
      const place = byId.get(row.place_id);
      if (!place) continue;
      const known = seen.get(place.id);
      // One row per place: its menu's price when it has one, else what its quotes say.
      if (known && !(known.pence === null && row.entry.price_pence !== null)) continue;
      const km = near && place.la !== null && place.lo !== null ? distanceKm(near, { lat: place.la, lng: place.lo }) : null;
      seen.set(place.id, { place, via: row.via, pence: row.entry.price_pence, photo: row.entry.photo ?? known?.photo ?? null, km });
    }
    return [...seen.values()];
  }, [dish.data, index.data, near]);

  const sorted = useMemo(() => {
    const byName = (a: Row, b: Row) => (a.place.n ?? a.place.z ?? '').localeCompare(b.place.n ?? b.place.z ?? '');
    const list = [...rows];
    if (order === 'near' && near) return list.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || byName(a, b));
    if (order === 'area') return list.sort((a, b) => boroughLabel(a.place.b, locale).localeCompare(boroughLabel(b.place.b, locale)) || (a.pence ?? Infinity) - (b.pence ?? Infinity));
    return list.sort((a, b) => (a.pence ?? Infinity) - (b.pence ?? Infinity) || byName(a, b));
  }, [rows, order, near, locale]);

  const prices = rows.flatMap((row) => (row.pence !== null ? [row.pence] : []));
  const stats = priceStats(prices);
  const low = sorted.find((row) => row.pence === stats?.min);
  const high = [...rows].reverse().find((row) => row.pence === stats?.max) ?? rows.find((row) => row.pence === stats?.max);
  const places = useMemo(() => sorted.map((row) => row.place), [sorted]);
  const highlight = useMemo(() => new Set(rows.map((row) => row.place.id)), [rows]);
  const markers = useMemo<Marker[]>(() => {
    const priced = rows.filter((row) => row.pence !== null && row.place.la !== null && row.place.lo !== null);
    if (priced.length < 2) return [];
    const min = priced.reduce((a, b) => (b.pence! < a.pence! ? b : a));
    const max = priced.reduce((a, b) => (b.pence! > a.pence! ? b : a));
    return [
      { lat: min.place.la!, lng: min.place.lo!, kind: 'price', label: price(min.pence!), sub: placeNames({ en: min.place.n, zh: min.place.z }, locale).main, href: paths.place(locale, min.place.id, min.place.s), shift: '-60% -125%' },
      { lat: max.place.la!, lng: max.place.lo!, kind: 'price', label: price(max.pence!), sub: placeNames({ en: max.place.n, zh: max.place.z }, locale).main, href: paths.place(locale, max.place.id, max.place.s), shift: '6% 10%' },
    ];
  }, [rows, locale]);
  const photos = rows.filter((row) => row.photo).length;
  const ready = dish.data !== null && index.data !== null;
  const related = useMemo(
    () => (entry ? DISH_VOCAB.filter((d) => d.cuisine === entry.cuisine && d.zh !== entry.zh && illustrations.data?.dishes[d.zh]).slice(0, 4) : []),
    [entry, illustrations.data],
  );
  const quotedAt = dish.data?.places.find((row) => row.via === 'review')?.place_id ?? null;

  return (
    <div className="dish-page screen">
      <nav className="crumbs">
        <Link href={paths.dishes(locale)}>{copy.nav.dishes}</Link>
        <Icon name="right" size={14} />
        {line ? (
          <>
            <Link href={paths.line(locale, line)}>
              <LineBadge id={line} />
            </Link>
            <Icon name="right" size={14} />
          </>
        ) : null}
        <span>{name}</span>
      </nav>
      <div className="dish-top">
        <div className="dish-hero">
          <DishImage photo={null} dish={dishKey} name={name} illustrations={illustrations.data} size="full" />
        </div>
        <div className="dish-intro">
          <p className="dish-kicker">{copy.dish.title(name)}</p>
          <h1>{name}</h1>
          <p className="dish-sub">
            {other ? <span>{other}</span> : null}
            {line ? <LineBadge id={line} /> : null}
          </p>
          {locale === 'en' && entry ? (
            <div className="staff">
              <span className="staff-big">{entry.zh}</span>
              <span>
                <span className="staff-label">{copy.dish.staff.label}</span>
                {DISH_PINYIN[entry.zh] ? <span className="staff-py">{DISH_PINYIN[entry.zh]}</span> : null}
                <small>{copy.dish.staff.point}</small>
              </span>
            </div>
          ) : null}
          {/* The standard dish's description is written in English, for illustration prompts. */}
          {entry && locale === 'en' ? <p className="lead">{entry.description}</p> : null}
          {!ready ? (
            <Skeleton height={120} />
          ) : stats ? (
            <>
              <p className="dish-lede">{copy.dish.prices(rows.length, price(stats.min), price(stats.max), price(stats.median))}</p>
              <div className="plot-box">
                <PricePlot prices={prices} width={540} height={100} />
                <p className="plot-caption">
                  <span>{copy.dish.plotCaption}</span>
                  <span>{copy.dish.listed(stats.count)}</span>
                </p>
              </div>
              {low && high && stats.max >= stats.min * 2 ? (
                <p className="fact-sticker">
                  <span className="fact-times">×{(stats.max / stats.min).toFixed(1)}</span>
                  <span>
                    {copy.dish.spread((stats.max / stats.min).toFixed(1), price(stats.min), low.place.o ?? '', price(stats.max), high.place.o ?? '')}
                    <small>{copy.dish.portions}</small>
                  </span>
                </p>
              ) : null}
            </>
          ) : (
            <p className="dish-lede">{rows.length ? copy.dish.lead(rows.length) : copy.dish.none}</p>
          )}
        </div>
      </div>

      {ready && rows.length > 0 ? (
        <div className="browse dish-browse">
          <div className="browse-main">
            <div className="browse-tools">
              <Segmented
                label={copy.home.sortLabel}
                choices={[
                  { value: 'price' as const, label: copy.dish.sorts.cheapest },
                  { value: 'near' as const, label: copy.dish.sorts.nearest },
                  { value: 'area' as const, label: copy.dish.sorts.area },
                ]}
                value={order}
                onChange={(value) => (value === 'near' && !near ? locate() : setState((previous) => ({ ...previous, order: value })))}
              />
              <span className="grow" />
              <Segmented
                label={copy.home.layout}
                choices={[
                  { value: 'list' as const, label: <Icon name="list" size={15} /> },
                  { value: 'map' as const, label: <Icon name="map" size={15} /> },
                ]}
                value={layout}
                onChange={(value) => setState((previous) => ({ ...previous, layout: value }))}
              />
            </div>
            {locating ? <p className="muted">{copy.home.loading}</p> : null}
            {layout === 'map' ? (
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
              <>
                <table className="price-table">
                  <thead>
                    <tr>
                      <th>{copy.dish.columns.price}</th>
                      <th>{copy.dish.columns.place}</th>
                      <th>{copy.dish.columns.area}</th>
                      <th className="wide-only">{copy.dish.columns.kind}</th>
                      <th className="wide-only">{copy.dish.columns.from}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.slice(0, shown).map((row) => {
                      const names = placeNames({ en: row.place.n, zh: row.place.z }, locale);
                      return (
                        <tr key={row.place.id}>
                          <td className={`price-cell${row.pence !== null && row.pence === stats?.min ? ' low' : ''}`}>{row.pence !== null ? price(row.pence) : '·'}</td>
                          <td>
                            <Link href={paths.place(locale, row.place.id, row.place.s)}>
                              <b>{names.main}</b>
                              {names.other ? <span className="other-inline">{names.other}</span> : null}
                            </Link>
                          </td>
                          <td className="muted">{[row.km !== null ? distance(row.km, locale) : null, boroughLabel(row.place.b, locale), row.place.o].filter(Boolean).join(' · ')}</td>
                          <td className="wide-only">
                            <span className="tag">{categoryLabel(row.place.c, locale)}</span>
                          </td>
                          <td className="wide-only muted">{row.via === 'menu' ? copy.dish.onMenu : copy.dish.inReviews}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {sorted.length > shown ? (
                  <div className="more">
                    <Button icon="down" onClick={() => setState((previous) => ({ ...previous, shown: previous.shown + PAGE }))}>
                      {copy.dish.more(Math.min(PAGE, sorted.length - shown))}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <aside className="browse-side">
            <CityMap entries={index.data?.places ?? []} tone="faint" bounds={LONDON} highlight={highlight} highlightColor="var(--line-dimsum)" markers={markers} label={copy.dish.mapCaption(rows.length)} className="side-map" />
            <p className="map-caption">{copy.dish.mapCaption(rows.length)}</p>
            {quotedAt ? <Wrote placeId={quotedAt} dishKey={dishKey} /> : null}
            {related.length ? (
              <section>
                <h2 className="side-title">{copy.dish.related}</h2>
                <div className="related">
                  {related.map((d) => (
                    <Link key={d.zh} className="dish-tile" href={paths.dish(locale, d.zh)}>
                      <DishImage photo={null} dish={d.zh} name={d[locale]} illustrations={illustrations.data} />
                      <b>{d[locale]}</b>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
            {photos === 0 ? (
              <Link className="photo-call" href={paths.lightUp(locale)} style={{ '--c': 'var(--amber)' } as CSSProperties}>
                <span>
                  <b>{copy.dish.noPhotos(rows.length)}</b>
                  <small>{copy.dish.noPhotosText}</small>
                </span>
                <span className="photo-call-button">
                  <Icon name="camera" size={16} /> {copy.dish.snap}
                </span>
              </Link>
            ) : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

/** A writer on this dish: the first quote that names it, in the reader's language when it can be. */
function Wrote({ placeId, dishKey }: { placeId: string; dishKey: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const { data: doc } = usePlace(placeId);
  const review = doc?.reviews.find((r) => r.dishes.some((d) => d.dish === dishKey));
  if (!doc || !review) return null;
  const translated = review.language !== locale && review.translation;
  const names = placeNames({ en: typeof doc.place.name_en === 'string' ? doc.place.name_en : null, zh: typeof doc.place.name_zh === 'string' ? doc.place.name_zh : null }, locale);
  return (
    <section>
      <h2 className="side-title">{copy.dish.wrote}</h2>
      <Link className="quote-bubble yellow" href={paths.place(locale, doc.id, doc.slug)}>
        <blockquote>{translated ? review.translation : review.excerpt}</blockquote>
        <cite>
          {translated ? <span className="tr">{copy.quotes.translated}</span> : null}
          {review.publication} · {names.main}
        </cite>
      </Link>
    </section>
  );
}
