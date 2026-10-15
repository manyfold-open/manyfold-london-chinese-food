/**
 * One place: a picture of what it serves (its own photos first, else labeled illustrations of its
 * dishes, and an empty frame for the first photo), who it is and where, how far it is from a
 * station and a campus, who has written about it and since when, the dishes those quotes name, its
 * menus with every price, the quotes themselves, visitors' photos, and the record of who added and
 * checked it. Never a score: a place is judged by reading its history (AGENTS.md, invariant 17).
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { campusesNear, nearestStation, walkMinutes } from '../../shared/campuses';
import { standardDish } from '../../shared/dish';
import { linesOf } from '../../shared/lines';
import type { DocItem, DocMenu, DocReview, IndexEntry, PlaceDoc } from '../../shared/place-doc';
import { distanceKm } from '../../shared/places-query';
import { notFoundTitle, placeTitle } from '../../shared/titles';
import { useAiPreference } from '../ai';
import { appUrl } from '../base';
import { DishImage } from '../components/DishImage';
import { CityMap, type Bounds, type Marker } from '../components/CityMap';
import { LineBadge, LineDot, lineColor } from '../components/Lines';
import { MenuSheet, ReportSheet, UploadSheet } from '../components/Sheets';
import { useIllustrations, useIndex, usePlace } from '../data';
import { day, displayUrl, partialDate, price, safeHref } from '../format';
import { useTitle } from '../hooks';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, categoryLabel, cuisineLabel, dietaryLabel, languageLabel, menuLabel, placeNames, sourceTypeLabel, subjectLabel } from '../labels';
import { mapLinks } from '../model/maps';
import { Link, useEntryState } from '../router';
import { paths } from '../routes';
import { Button, CheckRow, Icon, Menu, Segmented, Skeleton, useToast } from '../ui';
import { NotFoundPage } from './TextPages';

type Tab = 'menu' | 'reviews' | 'photos';
const TABS: readonly Tab[] = ['menu', 'reviews', 'photos'];

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** What a menu link opens, from its address: a PDF, an image, or a page. */
const linkKind = (url: string): 'pdf' | 'image' | 'page' => {
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  return path.endsWith('.pdf') ? 'pdf' : /\.(jpe?g|png|webp|gif|heic)$/.test(path) ? 'image' : 'page';
};

/** Every item on the place's menus. */
const itemsOf = (doc: PlaceDoc): DocItem[] => doc.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items));

/** The dishes the quotes name, most named first, with how many quotes name each. */
function mentionCounts(reviews: readonly DocReview[]): { key: string; dish: string | null; name: string; count: number }[] {
  const counts = new Map<string, { key: string; dish: string | null; name: string; count: number }>();
  for (const review of reviews) {
    const seen = new Set<string>();
    for (const named of review.dishes) {
      const key = named.dish ?? named.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const known = counts.get(key);
      if (known) known.count += 1;
      else counts.set(key, { key, dish: named.dish, name: named.dish ?? named.name, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

export function PlacePage({ id }: { id: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const toast = useToast();
  const { data: doc, error } = usePlace(id);
  const illustrations = useIllustrations();
  const index = useIndex();
  // Kept in the history entry: Back to this page opens the tab the reader was reading.
  const [tab, setTab] = useEntryState<Tab>('tab', (stored) => (TABS.includes(stored as Tab) ? (stored as Tab) : 'menu'));
  const [uploading, setUploading] = useState(false);
  const [addingMenu, setAddingMenu] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  useTitle(doc ? placeTitle(doc.place, locale) : error?.status === 404 ? notFoundTitle(locale) : null);

  if (error?.status === 404) return <NotFoundPage />;
  if (!doc) {
    return (
      <div className="screen">
        <Skeleton height={36} width="50%" />
        <Skeleton height={18} width="70%" style={{ marginTop: 12 }} />
        <Skeleton height={240} style={{ marginTop: 24 }} />
      </div>
    );
  }

  const names = placeNames({ en: text(doc.place.name_en), zh: text(doc.place.name_zh) }, locale);
  const trading = (text(doc.place.trading) ?? 'open') as 'open' | 'temporarily-closed' | 'closed';
  const cuisines = Array.isArray(doc.place.cuisines) ? (doc.place.cuisines as string[]) : [];
  const category = String(doc.place.category);
  const lines = linesOf({ c: category, k: cuisines });
  const website = safeHref(text(doc.place.website));
  const menuUrl = safeHref(text(doc.place.menu_url));
  const phone = text(doc.place.phone);
  const lat = typeof doc.place.lat === 'number' ? doc.place.lat : null;
  const lng = typeof doc.place.lng === 'number' ? doc.place.lng : null;
  const maps = mapLinks({ name: text(doc.place.name_en) ?? text(doc.place.name_zh), address: text(doc.place.address), postcode: text(doc.place.postcode), lat, lng });
  const items = itemsOf(doc);
  const dishNames = items.flatMap((item) => [item.name_zh ?? '', item.name_en ?? '']).filter(Boolean);
  const priced = items.flatMap((item) => (item.price_pence !== undefined && item.price_pence > 0 ? [item.price_pence] : []));
  const seen = doc.menus.map((menu) => menu.observed_at).sort().at(-1);
  const point = lat !== null && lng !== null ? { lat, lng } : null;
  const station = point ? nearestStation(point) : null;
  const walks = [
    ...(station && station.km <= 1.2 ? [copy.place.walk(locale === 'zh' ? `${station.name} 站` : station.name, walkMinutes(station.km))] : []),
    ...(point ? campusesNear(point).slice(0, 2).map(({ campus, km }) => copy.place.walk(campus.short, walkMinutes(km))) : []),
  ];

  const share = async () => {
    const url = new URL(appUrl(paths.place(locale, doc.id, doc.slug)), location.href).href;
    if (navigator.share) {
      await navigator.share({ title: names.main, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url).then(() => toast(copy.share.copied)).catch(() => undefined);
  };

  return (
    <article className="place screen">
      <nav className="crumbs">
        <Link href={paths.home(locale)}>{copy.nav.home}</Link>
        <Icon name="right" size={14} />
        {lines[0] ? (
          <>
            <Link href={paths.line(locale, lines[0])}>
              <LineBadge id={lines[0]} />
            </Link>
            <Icon name="right" size={14} />
          </>
        ) : null}
        <span>{names.main}</span>
      </nav>

      <div className="place-top">
        <Collage doc={doc} illustrations={illustrations.data} onUpload={() => setUploading(true)} />
        <div className="place-side">
          <header className="place-sign">
            <h1>
              {names.main}
              {names.other ? <span className="sign-other">{names.other}</span> : null}
            </h1>
            <p className="place-lines">
              {lines.map((line) => (
                <Link key={line} href={paths.line(locale, line)}>
                  <LineBadge id={line} />
                </Link>
              ))}
              <span className={`trading-badge ${trading}`}>{copy.place.trading[trading]}</span>
            </p>
            <p className="place-kind">
              <span>{categoryLabel(category, locale)}</span>
              {cuisines.map((value) => (
                <span key={value} className="tag">
                  {cuisineLabel(value, locale)}
                </span>
              ))}
            </p>
          </header>
          {doc.status === 'stale' ? <p className="notice warn">{copy.place.staleNotice}</p> : null}
          <ul className="place-facts-list">
            <li>
              <Icon name="pin" size={18} />
              <div>
                <b>
                  {text(doc.place.address)}, {text(doc.place.postcode)}
                </b>
                {doc.place.borough_code ? <span className="muted"> · {boroughLabel(String(doc.place.borough_code), locale)}</span> : null}
                {walks.length ? (
                  <span className="walks">
                    {walks.map((walk) => (
                      <span key={walk}>
                        <Icon name="walk" size={13} /> {walk}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            </li>
            {priced.length ? (
              <li>
                <Icon name="bowl" size={18} />
                <div>
                  <b>{copy.place.prices(price(Math.min(...priced)), price(Math.max(...priced)))}</b>
                  {seen ? <span className="muted small-block">{copy.place.pricesSeen(day(seen, locale))}</span> : null}
                </div>
              </li>
            ) : null}
            {phone || website || menuUrl ? (
              <li>
                <Icon name="globe" size={18} />
                <div className="fact-links">
                  {phone ? <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a> : null}
                  {website ? (
                    <a href={website} target="_blank" rel="nofollow noopener noreferrer">
                      {displayUrl(website)}
                    </a>
                  ) : null}
                  {menuUrl ? (
                    <a href={menuUrl} target="_blank" rel="nofollow noopener noreferrer">
                      {copy.place.ownMenu(linkKind(menuUrl))} <Icon name="external" size={12} />
                    </a>
                  ) : null}
                </div>
              </li>
            ) : null}
            {doc.brand ? (
              <li>
                <Icon name="grid" size={18} />
                <div>{placeNames({ en: doc.brand.name_en, zh: doc.brand.name_zh }, locale).main}</div>
              </li>
            ) : null}
          </ul>
          <div className="place-acts">
            <Button variant="primary" icon="camera" onClick={() => setUploading(true)}>
              {copy.place.firstPhoto}
            </Button>
            {maps.length ? <Menu label={copy.place.directions} icon="map" items={maps.map(({ app, href }) => ({ key: app, label: copy.place.mapApps[app], href }))} /> : null}
            <Button icon="share" onClick={() => void share()}>
              {copy.place.share}
            </Button>
          </div>
          {point ? <MiniMap point={point} name={names.main} entries={index.data?.places ?? []} self={doc.id} /> : null}
        </div>
      </div>

      <div className="place-body">
        <div className="place-main">
          <Press reviews={doc.reviews} />
          <Mentions reviews={doc.reviews} illustrations={illustrations.data} />

          <div className="place-tabs">
            <Segmented
              label={names.main}
              choices={[
                { value: 'menu' as const, label: copy.place.menu },
                { value: 'reviews' as const, label: `${copy.place.quotesTitle} ${doc.reviews.length || ''}`.trim() },
                { value: 'photos' as const, label: `${copy.place.photos} ${doc.photos.length || ''}`.trim() },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>

          {tab === 'menu' ? <MenuTab doc={doc} illustrations={illustrations.data} onReviews={() => setTab('reviews')} onAddMenu={() => setAddingMenu(true)} /> : null}
          {tab === 'reviews' ? <ReviewsTab reviews={doc.reviews} onReport={setReporting} pending={doc.pending.review ?? 0} /> : null}
          {tab === 'photos' ? <PhotosTab doc={doc} /> : null}

          <footer className="place-source">
            <h2>{copy.place.sourceOf}</h2>
            <blockquote>{doc.source.quote}</blockquote>
            <p className="meta">
              <a href={doc.source.url} target="_blank" rel="nofollow ugc noopener noreferrer">
                {displayUrl(doc.source.url)} <Icon name="external" size={12} />
              </a>
              {doc.source.verified_at ? <span>{locale === 'zh' ? `核对于 ${day(doc.source.verified_at, locale)}` : `checked ${day(doc.source.verified_at, locale)}`}</span> : null}
              <button type="button" className="link-button" onClick={() => setReporting(doc.id)}>
                <Icon name="flag" size={14} /> {copy.place.report}
              </button>
            </p>
          </footer>
        </div>
        <aside className="place-aside">
          <Record doc={doc} />
          {point ? <SameStop point={point} self={doc.id} entries={index.data?.places ?? []} /> : null}
        </aside>
      </div>

      <UploadSheet open={uploading} onClose={() => setUploading(false)} placeId={doc.id} dishes={[...new Set(dishNames)]} />
      <MenuSheet open={addingMenu} onClose={() => setAddingMenu(false)} placeId={doc.id} />
      <ReportSheet open={reporting !== null} onClose={() => setReporting(null)} recordId={reporting} />
    </article>
  );
}

/**
 * The picture at the top: the place's own photos first; where it has none, illustrations of the
 * dishes its quotes name most (each labeled, never in place of a real photo of that dish here),
 * and a frame waiting for the first real photo.
 */
function Collage({ doc, illustrations, onUpload }: { doc: PlaceDoc; illustrations: { shown: boolean; dishes: Record<string, string> } | null; onUpload: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const [wanted] = useAiPreference();
  const photos = doc.photos.filter((photo) => photo.subject !== 'menu').slice(0, 3);
  const photographed = new Set(itemsOf(doc).flatMap((item) => (item.photo && item.dish ? [item.dish] : [])));
  const candidates = [...mentionCounts(doc.reviews).map((m) => m.dish), ...itemsOf(doc).map((item) => item.dish), ...doc.mentioned.map((m) => m.dish)];
  const drawn = [...new Set(candidates.filter((dish): dish is string => dish !== null && !photographed.has(dish) && Boolean(illustrations?.shown && wanted && illustrations.dishes[dish])))].slice(0, Math.max(0, 3 - photos.length));
  const tiles = photos.length + drawn.length;
  return (
    <div className={`collage tiles-${Math.min(3, tiles + (photos.length === 0 ? 1 : 0))}`}>
      {photos.map((photo) => (
        <a key={photo.id} className="collage-tile" href={appUrl(`/media/p/${photo.id}/full.webp`)} target="_blank" rel="noopener">
          <img src={appUrl(`/media/p/${photo.id}/${tiles === 1 ? 'full' : 'thumb'}.webp`)} alt={photo.dish_name ?? subjectLabel(photo.subject, locale)} />
        </a>
      ))}
      {drawn.map((dish, i) => (
        <span key={dish} className="collage-tile">
          <DishImage photo={null} dish={dish} name={dish} illustrations={illustrations} size={i === 0 && photos.length === 0 ? 'full' : 'thumb'} />
        </span>
      ))}
      {photos.length === 0 ? (
        <button type="button" className="collage-slot" onClick={onUpload}>
          <Icon name="camera" size={24} />
          <b>{copy.place.slot}</b>
          <span>{copy.place.slotSub}</span>
        </button>
      ) : null}
    </div>
  );
}

/** Who has written about the place, and over which years. A count to read, never to sort by. */
function Press({ reviews }: { reviews: readonly DocReview[] }) {
  const copy = useCopy();
  const locale = useLocale();
  if (reviews.length === 0) return null;
  const sources = [...new Map(reviews.map((review) => [review.source_key, review])).values()];
  const years = reviews.map((review) => Number(review.published_on.slice(0, 4))).filter((year) => year > 1990);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const span = Math.max(1, Math.min(10, last - first + 1));
  const from = last - span + 1;
  const byYear = Array.from({ length: span }, (_, i) => years.filter((year) => year === from + i).length);
  const most = Math.max(...byYear, 1);
  return (
    <section className="press">
      <div className="press-count">
        <p className="press-big">{copy.place.sources(sources.length)}</p>
        <p className="muted">{copy.place.sourcesSpan(reviews.length, String(first), String(last))}</p>
        {span > 1 ? (
          <div className="years" aria-hidden="true">
            {byYear.map((count, i) => (
              <span key={i}>
                <i style={{ height: `${Math.max(6, (count / most) * 100)}%` } as CSSProperties} />
                <small>{String(from + i).slice(2)}</small>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <p className="srcs">
        {sources.map((review) => (
          <Link key={review.source_key} className="src" href={paths.source(locale, review.source_key)}>
            {review.publication}
            <small>{sourceTypeLabel(review.source_type, locale)}</small>
          </Link>
        ))}
      </p>
    </section>
  );
}

/** The dishes the quotes name, and how many quotes name each: a count, not a verdict. */
function Mentions({ reviews, illustrations }: { reviews: readonly DocReview[]; illustrations: { shown: boolean; dishes: Record<string, string> } | null }) {
  const copy = useCopy();
  const locale = useLocale();
  const mentions = mentionCounts(reviews)
    .slice(0, 8)
    .map((mention) => ({ ...mention, name: mention.dish ? (standardDish(mention.dish)?.[locale] ?? mention.name) : mention.name }));
  if (mentions.length === 0) return null;
  return (
    <section className="mentions-block">
      <h2>{copy.place.inQuotes}</h2>
      <p className="mentions">
        {mentions.map((mention) => {
          const body = (
            <>
              {mention.dish ? <DishImage photo={null} dish={mention.dish} name={mention.name} illustrations={illustrations} /> : null}
              {mention.name}
              <em>{copy.place.times(mention.count)}</em>
            </>
          );
          return mention.dish ? (
            <Link key={mention.key} className="mention" href={paths.dish(locale, mention.dish)}>
              {body}
            </Link>
          ) : (
            <span key={mention.key} className="mention">
              {body}
            </span>
          );
        })}
      </p>
      <p className="muted small">{copy.place.inQuotesNote}</p>
    </section>
  );
}

/** Where the place is among its neighbours: the nearest station and the places around it. */
function MiniMap({ point, name, entries, self }: { point: { lat: number; lng: number }; name: string; entries: readonly IndexEntry[]; self: string }) {
  const nearest = nearestStation(point);
  const station = nearest && nearest.km < 0.6 ? nearest : null;
  // The place and its station both in view, with room above the place for its label.
  const around = station ? [point, station] : [point];
  const lats = around.map((p) => p.lat);
  const lngs = around.map((p) => p.lng);
  const bounds: Bounds = [Math.min(...lats) - 0.0025, Math.max(...lats) + 0.0035, Math.min(...lngs) - 0.004, Math.max(...lngs) + 0.004];
  const markers = useMemo<Marker[]>(
    () => [
      ...(station ? [{ lat: station.lat, lng: station.lng, kind: 'station' as const, label: station.name }] : []),
      { lat: point.lat, lng: point.lng, kind: 'here', label: name },
    ],
    [point.lat, point.lng, name, station?.name],
  );
  const highlight = useMemo(() => new Set([self]), [self]);
  return <CityMap entries={entries} tone="line" bounds={bounds} markers={markers} highlight={highlight} highlightColor="var(--accent)" label={name} className="mini-map" />;
}

/** The record: who sent the place and its menus, and who checked them, newest first. */
function Record({ doc }: { doc: PlaceDoc }) {
  const copy = useCopy();
  const locale = useLocale();
  const ACTIONS: Record<string, [string, string]> = {
    submit: ['提交', 'sent'],
    verify: ['核对通过', 'checked'],
    update: ['更新', 'updated'],
    stale: ['标为过时', 'marked out of date'],
    admin_edit: ['修改', 'edited'],
    revert: ['撤销', 'undone'],
  };
  const KINDS: Record<string, [string, string]> = { place: ['店铺', 'Place'], menu: ['菜单', 'Menu'] };
  if (doc.history.length === 0) return null;
  return (
    <section className="record">
      <div className="aside-head">
        <h2>{copy.place.record}</h2>
        <span className="section-tag">{copy.place.recordTag}</span>
      </div>
      <ol className="timeline">
        {doc.history.slice(0, 8).map((entry, index) => (
          <li key={`${entry.at}-${index}`} className={entry.action === 'verify' ? 'ok' : undefined}>
            <span className="node" aria-hidden="true">
              <Icon name={entry.action === 'verify' ? 'check' : entry.kind === 'menu' ? 'list' : 'pin'} size={14} />
            </span>
            <span className="what">
              {(KINDS[entry.kind] ?? [entry.kind, entry.kind])[locale === 'zh' ? 0 : 1]} · {ACTIONS[entry.action]?.[locale === 'zh' ? 0 : 1] ?? entry.action}
              <code>{entry.by}</code>
              <small>{day(entry.at, locale)}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The places a short walk away: the same stop, by distance, whatever line they are on. */
function SameStop({ point, self, entries }: { point: { lat: number; lng: number }; self: string; entries: readonly IndexEntry[] }) {
  const copy = useCopy();
  const locale = useLocale();
  const near = useMemo(
    () =>
      entries
        .filter((entry) => entry.id !== self && entry.t === 'open' && entry.la !== null && entry.lo !== null)
        .map((entry) => ({ entry, km: distanceKm(point, { lat: entry.la!, lng: entry.lo! }) }))
        .filter(({ km }) => km <= 0.5)
        .sort((a, b) => a.km - b.km)
        .slice(0, 6),
    [entries, point, self],
  );
  if (near.length === 0) return null;
  return (
    <section className="same-stop">
      <div className="aside-head">
        <h2>{copy.place.sameStop}</h2>
      </div>
      <ul>
        {near.map(({ entry, km }) => {
          const names = placeNames({ en: entry.n, zh: entry.z }, locale);
          const line = linesOf(entry)[0];
          return (
            <li key={entry.id}>
              <Link href={paths.place(locale, entry.id, entry.s)} style={{ '--c': line ? lineColor(line) : 'var(--line2)' } as CSSProperties}>
                {line ? <LineDot id={line} /> : <i className="line-dot" />}
                <b>
                  {names.main}
                  {names.other ? <small>{names.other}</small> : null}
                </b>
                <span>{Math.round(km * 1000)} m</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MenuTab({
  doc,
  illustrations,
  onReviews,
  onAddMenu,
}: {
  doc: PlaceDoc;
  illustrations: { shown: boolean; dishes: Record<string, string> } | null;
  onReviews: () => void;
  onAddMenu: () => void;
}) {
  const copy = useCopy();
  const locale = useLocale();
  const [aiWanted, setAiWanted] = useAiPreference();
  // The switch only where it changes something: a dish here without a photo has an illustration.
  const illustrated = useMemo(() => {
    if (!illustrations?.shown) return false;
    const unphotographed = [
      ...doc.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items.filter((item) => !item.photo).map((item) => item.dish))),
      ...doc.mentioned.map((entry) => entry.dish),
    ];
    return unphotographed.some((dish) => dish !== null && Object.hasOwn(illustrations.dishes, dish));
  }, [doc, illustrations]);
  const empty = (
    <div className="menu-empty">
      <p className="empty">{copy.place.noMenu}</p>
      <p className="muted">{copy.place.noMenuHelp}</p>
      <Button icon="plus" onClick={onAddMenu}>
        {copy.place.addMenu}
      </Button>
    </div>
  );
  if (doc.menus.length === 0 && doc.mentioned.length === 0) return empty;
  return (
    <section className="menus">
      {illustrated ? (
        <div className="ai-note">
          <CheckRow checked={aiWanted} label={copy.ai.toggle} sub={copy.ai.explain} onToggle={() => setAiWanted(!aiWanted)} />
        </div>
      ) : null}
      {doc.menus.length === 0 ? empty : null}
      {doc.menus.map((menu) => (
        <MenuBlock key={menu.id} menu={menu} doc={doc} illustrations={illustrations} onReviews={onReviews} />
      ))}
      {doc.mentioned.length > 0 ? (
        <div className="menu-block">
          <h2>{copy.place.mentionedNotOnMenu}</h2>
          <div className="dish-grid">
            {doc.mentioned.map((entry) => (
              <div key={entry.dish} className="dish">
                <DishImage photo={null} dish={entry.dish} name={entry.name} illustrations={illustrations} />
                <div className="dish-text">
                  <Link className="dish-name" href={paths.dish(locale, entry.dish)}>
                    {entry.name}
                  </Link>
                  <button type="button" className="link-button small" onClick={onReviews}>
                    {copy.place.mentions(entry.reviews.length)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {doc.menus.length > 0 ? (
        <p className="menu-more">
          <button type="button" className="link-button" onClick={onAddMenu}>
            {copy.place.menuChanged}
          </button>
        </p>
      ) : null}
    </section>
  );
}

function MenuBlock({ menu, doc, illustrations, onReviews }: { menu: DocMenu; doc: PlaceDoc; illustrations: { shown: boolean; dishes: Record<string, string> } | null; onReviews: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const brand = doc.brand ? placeNames({ en: doc.brand.name_en, zh: doc.brand.name_zh }, locale).main : '';
  return (
    <div className="menu-block">
      <div className="menu-head">
        <h2>{menu.title ?? menuLabel(menu.menu, locale)}</h2>
        <p className="meta">
          {menu.owner === 'brand' ? <span>{copy.place.brandMenu(brand)}</span> : null}
          <span>{copy.place.priceSeen(day(menu.observed_at, locale))}</span>
          <a href={menu.source_url} target="_blank" rel="nofollow ugc noopener noreferrer">
            {copy.place.source} <Icon name="external" size={12} />
          </a>
        </p>
        {menu.source_kind === 'delivery-app' ? <p className="notice">{copy.place.deliveryPrices}</p> : null}
        {menu.stale ? <p className="notice warn">{copy.place.staleNotice}</p> : null}
      </div>
      {menu.sections.map((section, index) => (
        <div key={`${section.name}-${index}`} className="menu-section">
          {section.name ? <h3>{section.name}</h3> : null}
          <div className="dish-grid">
            {section.items.map((item, position) => (
              <DishRow key={`${item.key}-${position}`} item={item} illustrations={illustrations} onReviews={onReviews} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DishRow({ item, illustrations, onReviews }: { item: DocItem; illustrations: { shown: boolean; dishes: Record<string, string> } | null; onReviews: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const main = locale === 'zh' ? (item.name_zh ?? item.name_en) : (item.name_en ?? item.name_zh);
  const other = locale === 'zh' ? item.name_en : item.name_zh;
  return (
    <div className="dish">
      <DishImage photo={item.photo?.id ?? null} dish={item.dish} name={main ?? ''} illustrations={illustrations} />
      <div className="dish-text">
        <span className="dish-line">
          {item.dish ? (
            <Link className="dish-name" href={paths.dish(locale, item.dish)}>
              {main}
            </Link>
          ) : (
            <span className="dish-name">{main}</span>
          )}
          {item.spicy ? <span className="spicy" aria-label={`spicy ${item.spicy}`}>{'🌶'.repeat(item.spicy)}</span> : null}
          {item.price_pence !== undefined ? <b className="price">{price(item.price_pence)}</b> : null}
        </span>
        {other && other !== main ? <span className="other-name">{other}</span> : null}
        {item.description ? <span className="dish-desc">{item.description}</span> : null}
        <span className="dish-notes">
          {item.price_note ? <span>{item.price_note}</span> : null}
          {(item.dietary ?? []).map((value) => (
            <span key={value} className="tag">
              {dietaryLabel(value, locale)}
            </span>
          ))}
          {item.mentions.length > 0 ? (
            <button type="button" className="link-button small" onClick={onReviews}>
              {copy.place.mentions(item.mentions.length)}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function ReviewsTab({ reviews, onReport, pending }: { reviews: DocReview[]; onReport: (id: string) => void; pending: number }) {
  const copy = useCopy();
  const byYear = useMemo(() => {
    const groups = new Map<string, DocReview[]>();
    for (const review of reviews) {
      const year = review.published_on.slice(0, 4) || '—';
      groups.set(year, [...(groups.get(year) ?? []), review]);
    }
    return [...groups];
  }, [reviews]);
  return (
    <section className="reviews">
      <p className="notice">{copy.place.reviewsNotice}</p>
      {reviews.length === 0 ? <p className="empty">{copy.place.noReviews}</p> : null}
      {byYear.map(([year, list]) => (
        <div key={year} className="review-year">
          <h2>{copy.place.byYear(year)}</h2>
          {list.map((review) => (
            <ReviewCard key={review.id} review={review} onReport={() => onReport(review.id)} />
          ))}
        </div>
      ))}
      {pending > 0 ? <p className="muted">{copy.place.waiting(pending)}</p> : null}
    </section>
  );
}

function ReviewCard({ review, onReport }: { review: DocReview; onReport: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const [translated, setTranslated] = useState(false);
  const canTranslate = Boolean(review.translation) && review.language !== locale;
  return (
    <figure className="review" lang={review.language === 'zh' ? 'zh-Hans' : review.language === 'en' ? 'en' : undefined}>
      <blockquote>{translated && review.translation ? review.translation : review.excerpt}</blockquote>
      {translated ? <p className="machine">{copy.place.machineTranslation}</p> : null}
      <figcaption>
        <span className="tag">{sourceTypeLabel(review.source_type, locale)}</span>
        <Link href={paths.source(locale, review.source_key)}>{review.publication}</Link>
        {review.author && review.author_key ? <Link href={paths.critic(locale, review.author_key)}>{review.author}</Link> : null}
        <span>{partialDate(review.published_on, locale)}</span>
        <span className="muted">{languageLabel(review.language, locale)}</span>
      </figcaption>
      <p className="review-links">
        <a href={review.source_url} target="_blank" rel="nofollow ugc noopener noreferrer">
          {copy.place.readOriginal} <Icon name="external" size={12} />
        </a>
        {review.archive_url ? (
          <a href={review.archive_url} target="_blank" rel="nofollow noopener noreferrer">
            {copy.place.archived}
          </a>
        ) : null}
        {canTranslate || translated ? (
          <button type="button" className="link-button" onClick={() => setTranslated(!translated)}>
            {translated ? languageLabel(review.language, locale) : copy.place.translation}
          </button>
        ) : null}
        {review.dishes.map((dish) =>
          dish.dish ? (
            <Link key={dish.name} className="tag" href={paths.dish(locale, dish.dish)}>
              {dish.name}
            </Link>
          ) : (
            <span key={dish.name} className="tag">
              {dish.name}
            </span>
          ),
        )}
        <button type="button" className="link-button muted" onClick={onReport}>
          <Icon name="flag" size={13} /> {copy.place.report}
        </button>
      </p>
    </figure>
  );
}

function PhotosTab({ doc }: { doc: PlaceDoc }) {
  const copy = useCopy();
  const locale = useLocale();
  if (doc.photos.length === 0) return <p className="empty">{copy.place.noPhotos}</p>;
  return (
    <section className="photos">
      {doc.photos.map((photo) => (
        <figure key={photo.id}>
          <a href={appUrl(`/media/p/${photo.id}/full.webp`)} target="_blank" rel="noopener">
            <img src={appUrl(`/media/p/${photo.id}/thumb.webp`)} alt={photo.dish_name ?? subjectLabel(photo.subject, locale)} loading="lazy" decoding="async" />
          </a>
          <figcaption>
            {photo.dish_name ?? subjectLabel(photo.subject, locale)}
            {photo.caption ? ` · ${photo.caption}` : ''}
            {photo.attribution ? <span className="muted"> · © {photo.attribution}, CC BY 4.0</span> : <span className="muted"> · CC BY 4.0</span>}
          </figcaption>
        </figure>
      ))}
    </section>
  );
}
