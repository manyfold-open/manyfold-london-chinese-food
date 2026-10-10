/**
 * Every reader page's title, in its language. The Worker writes it into the page it serves
 * (src/worker/seo.ts), and the app sets it when the reader goes to another page in place
 * (src/app/hooks.ts, useTitle), so a tab says the same however the page was reached.
 */

import { BOROUGHS, CATEGORY_LABELS } from '../../kinds/vocab.ts';
import { standardDish } from './dish.ts';
import { COPY, type Locale } from './i18n.ts';

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** A path segment as written; one that is not valid percent-encoding is left as it came. */
export const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** A place page's title: its names, what kind of place it is, and where. */
export function placeTitle(place: Record<string, unknown>, locale: Locale): string {
  const copy = COPY[locale];
  const en = text(place.name_en);
  const zh = text(place.name_zh);
  const name = locale === 'zh' ? (zh ?? en ?? '') : (en ?? zh ?? '');
  // The other language's name, when there is one: a place with only an English name is not named twice.
  const other = locale === 'zh' ? (zh ? en : null) : en ? zh : null;
  const category = CATEGORY_LABELS[String(place.category)]?.[locale] ?? '';
  const borough = BOROUGHS[String(place.borough_code)]?.[locale] ?? '';
  return locale === 'zh'
    ? `${name}${other ? ` ${other}` : ''} · ${[category, borough].filter(Boolean).join(' · ')} · ${copy.siteShort}`
    : `${name}${other ? ` (${other})` : ''} — ${category}${borough ? ` in ${borough}` : ''} · ${copy.siteShort}`;
}

/** The title of a page that is not here. */
export const notFoundTitle = (locale: Locale): string => `${COPY[locale].notFound.title} · ${COPY[locale].siteShort}`;

/**
 * The title of any page but a place's, from its path without the language (/, /dish/x, /about),
 * and whether the path names a page at all.
 */
export function pathTitle(locale: Locale, rest: string): { found: boolean; title: string } {
  const copy = COPY[locale];
  const [, page, value] = rest.split('/');
  const decoded = value ? decodeSegment(value) : '';
  const site = copy.siteShort;
  if (!page) return { found: true, title: `${copy.siteName} — ${copy.tagline}` };
  if (page === 'dish' && decoded) {
    const entry = standardDish(decoded);
    return { found: true, title: `${copy.dish.title((locale === 'zh' ? entry?.zh : entry?.en) ?? decoded)} · ${site}` };
  }
  if ((page === 'source' || page === 'critic') && decoded) {
    return { found: true, title: `${page === 'source' ? copy.source.title(decoded) : copy.source.criticTitle(decoded)} · ${site}` };
  }
  if (page === 'contribute' || page === 'about' || page === 'privacy') {
    return { found: true, title: `${page === 'contribute' ? copy.contribute.title : copy[page].title} · ${site}` };
  }
  return { found: false, title: notFoundTitle(locale) };
}
