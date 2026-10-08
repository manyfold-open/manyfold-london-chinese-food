/** Where a dish can be eaten: every place whose menu lists it or whose reviews mention it. */

import { useMemo, useState } from 'react';
import { standardDish } from '../../shared/dish';
import type { IndexEntry } from '../../shared/place-doc';
import { distanceKm } from '../../shared/places-query';
import { DishImage } from '../components/DishImage';
import { useDish, useIllustrations, useIndex } from '../data';
import { distance, price } from '../format';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, placeNames } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';
import { Icon, Pill, Skeleton } from '../ui';

export function DishPage({ dishKey }: { dishKey: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const dish = useDish(dishKey);
  const index = useIndex();
  const illustrations = useIllustrations();
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
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
          <Pill
            icon="locate"
            active={near !== null}
            onClick={() => navigator.geolocation?.getCurrentPosition((position) => setNear({ lat: position.coords.latitude, lng: position.coords.longitude }))}
          >
            {copy.home.near}
          </Pill>
        </div>
      </header>
      {!dish.data || !index.data ? (
        <Skeleton height={200} />
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
