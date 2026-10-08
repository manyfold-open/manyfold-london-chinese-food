/** One place in a list: its names, what kind of place, where, and what there is to read. */

import type { IndexEntry } from '../../shared/place-doc';
import { distance } from '../format';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, categoryLabel, cuisineLabel, placeNames } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';

export function PlaceRow({ entry, km }: { entry: IndexEntry; km?: number | null }) {
  const locale = useLocale();
  const copy = useCopy();
  const names = placeNames({ en: entry.n, zh: entry.z }, locale);
  const where = [boroughLabel(entry.b, locale), entry.o].filter(Boolean).join(' · ');
  const have = [
    entry.r > 0 ? (locale === 'zh' ? `${entry.r} 条评价` : `${entry.r} ${entry.r === 1 ? 'review' : 'reviews'}`) : null,
    entry.m > 0 ? copy.place.menu : null,
    entry.p > 0 ? (locale === 'zh' ? `${entry.p} 张照片` : `${entry.p} ${entry.p === 1 ? 'photo' : 'photos'}`) : null,
  ].filter(Boolean);
  return (
    <Link className={`place-row${entry.t === 'closed' ? ' closed' : ''}`} href={paths.place(locale, entry.id, entry.s)}>
      <span className="place-row-main">
        <b>{names.main}</b>
        {names.other ? <span className="other-name">{names.other}</span> : null}
        <span className="place-row-meta">
          {[categoryLabel(entry.c, locale), ...entry.k.slice(0, 3).map((value) => cuisineLabel(value, locale))].join(' · ')}
        </span>
      </span>
      <span className="place-row-end">
        {km !== undefined && km !== null ? <b>{distance(km, locale)}</b> : null}
        <span>{where}</span>
        {entry.t !== 'open' ? <span className={`trading ${entry.t}`}>{copy.place.trading[entry.t as 'closed']}</span> : have.length ? <span>{have.join(' · ')}</span> : null}
      </span>
    </Link>
  );
}
