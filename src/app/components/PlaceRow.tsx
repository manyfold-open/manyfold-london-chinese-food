/**
 * One place in a list, as a row or as a card in a grid: its names, what kind of place, where,
 * and what there is to read.
 */

import type { IndexEntry } from '../../shared/place-doc';
import type { Copy, Locale } from '../../shared/i18n';
import { distance } from '../format';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, categoryLabel, cuisineLabel, placeNames } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';

/** What a row and a card both say about a place. */
function describe(entry: IndexEntry, locale: Locale, copy: Copy) {
  return {
    names: placeNames({ en: entry.n, zh: entry.z }, locale),
    category: categoryLabel(entry.c, locale),
    cuisines: entry.k.slice(0, 3).map((value) => cuisineLabel(value, locale)),
    where: [boroughLabel(entry.b, locale), entry.o].filter(Boolean).join(' · '),
    have: [
      entry.r > 0 ? (locale === 'zh' ? `${entry.r} 条评价` : `${entry.r} ${entry.r === 1 ? 'review' : 'reviews'}`) : null,
      entry.m > 0 ? copy.place.menu : null,
      entry.p > 0 ? (locale === 'zh' ? `${entry.p} 张照片` : `${entry.p} ${entry.p === 1 ? 'photo' : 'photos'}`) : null,
    ]
      .filter(Boolean)
      .join(' · '),
    trading: entry.t !== 'open' ? <span className={`trading ${entry.t}`}>{copy.place.trading[entry.t as 'closed']}</span> : null,
  };
}

export function PlaceRow({ entry, km }: { entry: IndexEntry; km?: number | null }) {
  const locale = useLocale();
  const place = describe(entry, locale, useCopy());
  return (
    <Link className={`place-row${entry.t === 'closed' ? ' closed' : ''}`} href={paths.place(locale, entry.id, entry.s)}>
      <span className="place-row-main">
        <b>{place.names.main}</b>
        {place.names.other ? <span className="other-name">{place.names.other}</span> : null}
        <span className="place-row-meta">{[place.category, ...place.cuisines].join(' · ')}</span>
      </span>
      <span className="place-row-end">
        {km !== undefined && km !== null ? <b>{distance(km, locale)}</b> : null}
        <span>{place.where}</span>
        {place.trading ?? (place.have ? <span>{place.have}</span> : null)}
      </span>
    </Link>
  );
}

export function PlaceCard({ entry, km }: { entry: IndexEntry; km?: number | null }) {
  const locale = useLocale();
  const place = describe(entry, locale, useCopy());
  return (
    <Link className={`place-card${entry.t === 'closed' ? ' closed' : ''}`} href={paths.place(locale, entry.id, entry.s)}>
      <span className="place-card-top">
        <span>{place.category}</span>
        {km !== undefined && km !== null ? <b>{distance(km, locale)}</b> : null}
      </span>
      <b className="place-card-name">{place.names.main}</b>
      {place.names.other ? <span className="other-name">{place.names.other}</span> : null}
      {place.cuisines.length ? (
        <span className="tags">
          {place.cuisines.map((cuisine) => (
            <span key={cuisine} className="tag">
              {cuisine}
            </span>
          ))}
        </span>
      ) : null}
      <span className="place-card-foot">
        <span>{place.where}</span>
        {place.trading ?? (place.have ? <span>{place.have}</span> : null)}
      </span>
    </Link>
  );
}
