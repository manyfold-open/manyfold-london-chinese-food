/**
 * Dishes: find food by dish. The standard dishes (kinds/dish-vocab.ts), shelved by the line their
 * cuisine is on, each with its picture; a search reaches every dish name the menus use, once the
 * catalog is loaded. A dish leads to every place that serves it; no dish is ranked.
 */

import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react';
import { DISH_VOCAB } from '../../../kinds/dish-vocab';
import { normDish } from '../../shared/dish';
import { normName } from '../../shared/kinds';
import { LINES } from '../../shared/lines';
import { DishImage } from '../components/DishImage';
import { lineColor } from '../components/Lines';
import { useDishCatalog, useIllustrations } from '../data';
import { useCopy, useLocale } from '../i18n';
import { Link } from '../router';
import { paths } from '../routes';
import { SearchField } from '../ui';

const lineOfCuisine = new Map(LINES.flatMap((line) => line.cuisines.map((cuisine) => [cuisine, line.id] as const)));

export function DishesPage() {
  const copy = useCopy();
  const locale = useLocale();
  const illustrations = useIllustrations();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const catalog = useDishCatalog(query.length > 0);

  const shelves = useMemo(
    () =>
      LINES.map((line) => ({
        line,
        dishes: DISH_VOCAB.filter((dish) => lineOfCuisine.get(dish.cuisine) === line.id && (!illustrations.data?.shown || Object.hasOwn(illustrations.data.dishes, dish.zh))),
      })).filter((shelf) => shelf.dishes.length > 0),
    [illustrations.data],
  );

  const hits = useMemo(() => {
    if (!query || !catalog.data) return [];
    const wanted = normDish(query);
    const words = normName(query);
    return catalog.data.dishes
      .filter(([key, zh, en]) => key.includes(wanted) || (zh && normDish(zh).includes(wanted)) || (en && normName(en).includes(words)))
      .sort((a, b) => b[3] - a[3])
      .slice(0, 24);
  }, [query, catalog.data]);

  return (
    <div className="dishes-page screen">
      <header className="page-intro">
        <h1>{copy.dishes.title}</h1>
        <p>{copy.dishes.lead}</p>
        <SearchField value={q} label={copy.dishes.search} onChange={setQ} />
      </header>
      {query ? (
        <div className="dish-hits-list">
          {hits.map(([key, zh, en, count]) => (
            <Link key={key} className="dish-hit" href={paths.dish(locale, key)}>
              <b>{locale === 'zh' ? (zh ?? en ?? key) : (en ?? zh ?? key)}</b>
              <span>{copy.dishes.servedAt(count)}</span>
            </Link>
          ))}
          {catalog.data && hits.length === 0 ? <p className="empty">{copy.home.empty}</p> : null}
        </div>
      ) : (
        shelves.map(({ line, dishes }) => (
          <section key={line.id} className="dish-shelf" style={{ '--c': lineColor(line.id) } as CSSProperties}>
            <h2>
              <i aria-hidden="true" />
              <Link href={paths.line(locale, line.id)}>{line.label[locale]}</Link>
            </h2>
            <div className="dish-tiles">
              {dishes.map((dish) => (
                <Link key={dish.zh} className="dish-tile" href={paths.dish(locale, dish.zh)}>
                  <DishImage photo={null} dish={dish.zh} name={dish[locale]} illustrations={illustrations.data} />
                  <b>{dish[locale]}</b>
                  <span>{locale === 'zh' ? dish.en : dish.zh}</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
