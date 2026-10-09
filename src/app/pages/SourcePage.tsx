/** Everything one source (or one critic) wrote, across places: read it to judge how far to trust it. */

import { useSource } from '../data';
import { partialDate } from '../format';
import { useCopy, useLocale } from '../i18n';
import { placeNames, sourceTypeLabel } from '../labels';
import { Link, useEntryState } from '../router';
import { paths } from '../routes';
import { Button, Icon, Skeleton } from '../ui';

export function SourcePage({ by, sourceKey }: { by: 'source' | 'author'; sourceKey: string }) {
  const copy = useCopy();
  const locale = useLocale();
  // Kept in the history entry: Back from a place returns to the page of excerpts it was on.
  const [page, setPage] = useEntryState('page', (stored) => (typeof stored === 'number' && Number.isInteger(stored) && stored > 1 ? stored : 1));
  const { data } = useSource(by, sourceKey, page);
  const first = data?.entries[0];
  const name = by === 'source' ? (first?.publication ?? sourceKey) : (first?.author ?? sourceKey);
  return (
    <div className="source-page screen">
      <nav className="crumbs">
        <Link href={paths.home(locale)}>{copy.nav.home}</Link>
        <Icon name="right" size={14} />
        <span>{name}</span>
      </nav>
      <header className="page-head">
        <h1>{by === 'source' ? copy.source.title(name) : copy.source.criticTitle(name)}</h1>
        {data ? <p className="desc">{copy.source.lead(data.total)}</p> : null}
      </header>
      {!data ? (
        <Skeleton height={200} />
      ) : (
        <div className="reviews">
          {data.entries.map((entry) => {
            const names = placeNames({ en: entry.place_en, zh: entry.place_zh }, locale);
            return (
              <figure key={entry.id} className="review">
                <blockquote>{entry.excerpt}</blockquote>
                <figcaption>
                  <Link href={paths.place(locale, entry.place_id, entry.slug)}>
                    <b>{names.main}</b>
                  </Link>
                  <span className="tag">{sourceTypeLabel(entry.source_type, locale)}</span>
                  <span>{partialDate(entry.published_on, locale)}</span>
                  <a href={entry.source_url} target="_blank" rel="nofollow ugc noopener noreferrer">
                    {copy.place.readOriginal} <Icon name="external" size={12} />
                  </a>
                </figcaption>
              </figure>
            );
          })}
          {data.total > page * 100 ? (
            <div className="more">
              <Button onClick={() => setPage(page + 1)}>{locale === 'zh' ? '下一页' : 'Next page'}</Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
