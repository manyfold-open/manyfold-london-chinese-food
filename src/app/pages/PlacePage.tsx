/**
 * One place: who it is and where, its menus with each dish's picture, what reviewers wrote over
 * the years (never a score), the photos visitors took, and the history of the record itself.
 */

import { useMemo, useState } from 'react';
import type { DocItem, DocMenu, DocReview, PlaceDoc } from '../../shared/place-doc';
import { useAiPreference } from '../ai';
import { appUrl } from '../base';
import { DishImage } from '../components/DishImage';
import { ReportSheet, UploadSheet } from '../components/Sheets';
import { useIllustrations, usePlace } from '../data';
import { day, displayUrl, partialDate, price, safeHref } from '../format';
import { useCopy, useLocale } from '../i18n';
import { boroughLabel, categoryLabel, cuisineLabel, dietaryLabel, languageLabel, menuLabel, placeNames, sourceTypeLabel, subjectLabel } from '../labels';
import { Link } from '../router';
import { paths } from '../routes';
import { Button, CheckRow, Icon, Segmented, Skeleton } from '../ui';
import { NotFoundPage } from './TextPages';

type Tab = 'menu' | 'reviews' | 'photos' | 'history';

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

export function PlacePage({ id }: { id: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const { data: doc, error } = usePlace(id);
  const illustrations = useIllustrations();
  const [tab, setTab] = useState<Tab>('menu');
  const [uploading, setUploading] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);

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
  const website = safeHref(text(doc.place.website));
  const phone = text(doc.place.phone);
  const lat = typeof doc.place.lat === 'number' ? doc.place.lat : null;
  const lng = typeof doc.place.lng === 'number' ? doc.place.lng : null;
  const dishNames = doc.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items.map((item) => item.name_zh ?? item.name_en ?? ''))).filter(Boolean);

  return (
    <article className="place screen">
      <nav className="crumbs">
        <Link href={paths.home(locale)}>{copy.nav.home}</Link>
        <Icon name="right" size={14} />
        <span>{names.main}</span>
      </nav>
      <header className="place-head">
        <h1>
          {names.main}
          {names.other ? <span className="other-name">{names.other}</span> : null}
        </h1>
        <p className="place-kind">
          <span>{categoryLabel(String(doc.place.category), locale)}</span>
          {cuisines.map((value) => (
            <span key={value} className="tag">
              {cuisineLabel(value, locale)}
            </span>
          ))}
          {trading !== 'open' ? <span className={`trading ${trading}`}>{copy.place.trading[trading]}</span> : null}
        </p>
        {doc.status === 'stale' ? <p className="notice warn">{copy.place.staleNotice}</p> : null}
        <dl className="place-facts">
          <div>
            <dt>{copy.place.address}</dt>
            <dd>
              {text(doc.place.address)}, {text(doc.place.postcode)}
              {doc.place.borough_code ? <span className="muted"> · {boroughLabel(String(doc.place.borough_code), locale)}</span> : null}
              {lat !== null && lng !== null ? (
                <a className="map-link" href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`} target="_blank" rel="noopener noreferrer">
                  <Icon name="map" size={14} /> {copy.home.map}
                </a>
              ) : null}
            </dd>
          </div>
          {website ? (
            <div>
              <dt>{copy.place.website}</dt>
              <dd>
                <a href={website} target="_blank" rel="nofollow noopener noreferrer">
                  {displayUrl(website)}
                </a>
              </dd>
            </div>
          ) : null}
          {phone ? (
            <div>
              <dt>{copy.place.phone}</dt>
              <dd>
                <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>
              </dd>
            </div>
          ) : null}
          {doc.brand ? (
            <div>
              <dt>{locale === 'zh' ? '品牌' : 'Brand'}</dt>
              <dd>{placeNames({ en: doc.brand.name_en, zh: doc.brand.name_zh }, locale).main}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <div className="place-tabs">
        <Segmented
          label={names.main}
          choices={[
            { value: 'menu' as const, label: copy.place.menu },
            { value: 'reviews' as const, label: `${copy.place.reviews} ${doc.reviews.length || ''}`.trim() },
            { value: 'photos' as const, label: `${copy.place.photos} ${doc.photos.length || ''}`.trim() },
            { value: 'history' as const, label: copy.place.history },
          ]}
          value={tab}
          onChange={setTab}
        />
        <span className="grow" />
        <Button icon="camera" onClick={() => setUploading(true)}>
          {copy.place.addPhoto}
        </Button>
      </div>

      {tab === 'menu' ? <MenuTab doc={doc} illustrations={illustrations.data} onReviews={() => setTab('reviews')} /> : null}
      {tab === 'reviews' ? <ReviewsTab reviews={doc.reviews} onReport={setReporting} pending={doc.pending.review ?? 0} /> : null}
      {tab === 'photos' ? <PhotosTab doc={doc} /> : null}
      {tab === 'history' ? <HistoryTab doc={doc} /> : null}

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

      <UploadSheet open={uploading} onClose={() => setUploading(false)} placeId={doc.id} dishes={[...new Set(dishNames)]} />
      <ReportSheet open={reporting !== null} onClose={() => setReporting(null)} recordId={reporting} />
    </article>
  );
}

function MenuTab({ doc, illustrations, onReviews }: { doc: PlaceDoc; illustrations: { shown: boolean; dishes: Record<string, string> } | null; onReviews: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const [aiWanted, setAiWanted] = useAiPreference();
  if (doc.menus.length === 0 && doc.mentioned.length === 0) return <p className="empty">{copy.place.noMenu}</p>;
  return (
    <section className="menus">
      {illustrations?.shown ? (
        <div className="ai-note">
          <CheckRow checked={aiWanted} label={copy.ai.toggle} sub={copy.ai.explain} onToggle={() => setAiWanted(!aiWanted)} />
        </div>
      ) : null}
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

function HistoryTab({ doc }: { doc: PlaceDoc }) {
  const locale = useLocale();
  const ACTIONS: Record<string, [string, string]> = {
    submit: ['提交', 'sent'],
    verify: ['核对通过', 'checked'],
    update: ['更新', 'updated'],
    stale: ['标为过时', 'marked out of date'],
    admin_edit: ['修改', 'edited'],
    revert: ['撤销', 'undone'],
  };
  return (
    <section className="history">
      <ol>
        {doc.history.map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            <time>{day(entry.at, locale)}</time>
            <span>
              {entry.kind === 'menu' ? (locale === 'zh' ? '菜单' : 'Menu') : locale === 'zh' ? '店铺' : 'Place'} · {ACTIONS[entry.action]?.[locale === 'zh' ? 0 : 1] ?? entry.action}
            </span>
            <span className="muted">{entry.by}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
