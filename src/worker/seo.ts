/**
 * What search engines and link previews read of a page, written into the single-page app's HTML
 * as it is served: the language, a title and description for the page, its canonical address and
 * its other-language twin, and for a place, structured data (schema.org) with its address and
 * cuisines — never a rating (AGENTS.md, invariant 17). A place that is not public is a 404.
 * Pages on any host but the public one are kept out of search results.
 *
 * Also here: "/" sent to a language, the sitemap, and the pages' content security policy.
 */

import { CATEGORY_LABELS, CUISINE_LABELS, BOROUGHS } from '../../kinds/vocab';
import { COPY, localeFrom, localeFromAcceptLanguage, type Locale } from '../shared/i18n';
import type { IndexEntry, PlaceDoc } from '../shared/place-doc';
import { standardDish } from '../shared/dish';

/** The content security policy of every page: our own code, Turnstile's form, OpenFreeMap's map. */
export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "connect-src 'self' https://tiles.openfreemap.org",
  "font-src 'self' https://tiles.openfreemap.org",
  'frame-src https://challenges.cloudflare.com',
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** The language "/" should open in: the reader's earlier choice, else their browser's. */
export function preferredLocale(cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  const chosen = /(?:^|;\s*)lcf_locale=(zh|en)(?:;|$)/.exec(cookie ?? '')?.[1];
  return localeFrom(chosen) ?? localeFromAcceptLanguage(acceptLanguage);
}

export interface PageMeta {
  status: number;
  locale: Locale;
  title: string;
  description: string;
  /** The page's path without its language, e.g. /place/rec_x/slug. */
  rest: string;
  jsonLd: Record<string, unknown> | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

const SCHEMA_TYPE: Record<string, string> = {
  restaurant: 'Restaurant',
  takeaway: 'Restaurant',
  'bakery-dessert': 'Bakery',
  'tea-drinks': 'CafeOrCoffeeShop',
  grocery: 'GroceryStore',
};

/** The meta of a place page, from its document; null for a place that is not public. */
export function placeMeta(doc: PlaceDoc | null, locale: Locale, rest: string, canonical: string): PageMeta {
  const copy = COPY[locale];
  if (!doc) return { status: 404, locale, title: `${copy.notFound.title} · ${copy.siteShort}`, description: copy.notFound.text, rest, jsonLd: null };
  const place = doc.place;
  const en = text(place.name_en);
  const zh = text(place.name_zh);
  const name = locale === 'zh' ? (zh ?? en ?? '') : (en ?? zh ?? '');
  const other = locale === 'zh' ? en : zh;
  const category = CATEGORY_LABELS[String(place.category)]?.[locale] ?? '';
  const borough = BOROUGHS[String(place.borough_code)]?.[locale] ?? '';
  const cuisines = (Array.isArray(place.cuisines) ? (place.cuisines as string[]) : []).map((value) => CUISINE_LABELS[value]?.[locale] ?? value);
  const items = doc.menus.flatMap((menu) => menu.sections.flatMap((section) => section.items)).slice(0, 4);
  const dishes = items.map((item) => (locale === 'zh' ? (item.name_zh ?? item.name_en) : (item.name_en ?? item.name_zh))).filter(Boolean);
  const title =
    locale === 'zh'
      ? `${name}${other ? ` ${other}` : ''} · ${[category, borough].filter(Boolean).join(' · ')} · ${copy.siteShort}`
      : `${name}${other ? ` (${other})` : ''} — ${category}${borough ? ` in ${borough}` : ''} · ${copy.siteShort}`;
  const counts =
    locale === 'zh'
      ? `${doc.reviews.length} 条评价摘录${doc.menus.length ? '、菜单' : ''}${doc.photos.length ? '和照片' : ''}，没有评分。`
      : `${doc.reviews.length} review excerpts${doc.menus.length ? ', the menu' : ''}${doc.photos.length ? ' and photos' : ''}. No ratings.`;
  const description = [
    `${text(place.address) ?? ''}, ${text(place.postcode) ?? ''}.`,
    cuisines.length ? `${cuisines.join(locale === 'zh' ? '、' : ', ')}.` : '',
    dishes.length ? (locale === 'zh' ? `菜单有${dishes.join('、')}等。` : `On the menu: ${dishes.join(', ')}.`) : '',
    counts,
  ]
    .filter(Boolean)
    .join(' ');
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE[String(place.category)] ?? 'FoodEstablishment',
    name: en ?? zh,
    ...(en && zh ? { alternateName: zh } : {}),
    url: canonical,
    address: {
      '@type': 'PostalAddress',
      streetAddress: text(place.address),
      postalCode: text(place.postcode),
      addressLocality: 'London',
      addressCountry: 'GB',
    },
    ...(typeof place.lat === 'number' && typeof place.lng === 'number' ? { geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lng } } : {}),
    ...(cuisines.length ? { servesCuisine: (place.cuisines as string[]).map((value) => CUISINE_LABELS[value]?.en ?? value) } : {}),
    ...(text(place.phone) ? { telephone: text(place.phone) } : {}),
    ...(text(place.website) ? { sameAs: [text(place.website)] } : {}),
    ...(doc.menus.length ? { hasMenu: canonical } : {}),
  };
  return { status: 200, locale, title, description, rest, jsonLd };
}

/** The meta of every other page, from its path. */
export function pathMeta(locale: Locale, rest: string): PageMeta {
  const copy = COPY[locale];
  const [, page, value] = rest.split('/');
  const decoded = value ? decodeURIComponent(value) : '';
  const site = copy.siteShort;
  if (!page) return { status: 200, locale, title: `${copy.siteName} — ${copy.tagline}`, description: copy.description, rest, jsonLd: null };
  if (page === 'dish' && decoded) {
    const entry = standardDish(decoded);
    const name = (locale === 'zh' ? entry?.zh : entry?.en) ?? decoded;
    return { status: 200, locale, title: `${copy.dish.title(name)} · ${site}`, description: entry?.description ?? copy.description, rest, jsonLd: null };
  }
  if ((page === 'source' || page === 'critic') && decoded) {
    return { status: 200, locale, title: `${page === 'source' ? copy.source.title(decoded) : copy.source.criticTitle(decoded)} · ${site}`, description: copy.description, rest, jsonLd: null };
  }
  if (page === 'contribute' || page === 'about' || page === 'privacy') {
    const title = page === 'contribute' ? copy.contribute.title : copy[page].title;
    return { status: 200, locale, title: `${title} · ${site}`, description: page === 'contribute' ? copy.contribute.lead : copy.description, rest, jsonLd: null };
  }
  return { status: 404, locale, title: `${copy.notFound.title} · ${site}`, description: copy.notFound.text, rest, jsonLd: null };
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * The page's HTML with its meta written in. `site` is the public address, mount included. `csp`
 * is off only for the local dev server, whose React refresh preamble is an inline script.
 */
export function withMeta(response: Response, meta: PageMeta, site: string, indexable: boolean, csp = true): Response {
  const canonical = `${site}/${meta.locale}${meta.rest}`;
  const head = [
    `<meta name="description" content="${escapeAttribute(meta.description)}">`,
    `<link rel="canonical" href="${escapeAttribute(canonical)}">`,
    `<link rel="alternate" hreflang="zh-Hans" href="${escapeAttribute(`${site}/zh${meta.rest}`)}">`,
    `<link rel="alternate" hreflang="en" href="${escapeAttribute(`${site}/en${meta.rest}`)}">`,
    `<link rel="alternate" hreflang="x-default" href="${escapeAttribute(`${site}/zh${meta.rest}`)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttribute(COPY[meta.locale].siteName)}">`,
    `<meta property="og:title" content="${escapeAttribute(meta.title)}">`,
    `<meta property="og:description" content="${escapeAttribute(meta.description)}">`,
    `<meta property="og:url" content="${escapeAttribute(canonical)}">`,
    ...(indexable && meta.status === 200 ? [] : ['<meta name="robots" content="noindex">']),
    ...(meta.jsonLd ? [`<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('');
  // HTMLRewriter exists only in workerd; under Node (tests) the page keeps its HTML, and the
  // decisions above are tested as plain functions.
  if (typeof HTMLRewriter === 'undefined') return finish(response, meta.status, csp);
  const rewritten = new HTMLRewriter()
    .on('html', { element: (element) => void element.setAttribute('lang', COPY[meta.locale].htmlLang) })
    .on('title', { element: (element) => void element.setInnerContent(escapeText(meta.title), { html: true }) })
    .on('meta[name="description"]', { element: (element) => void element.remove() })
    .on('head', { element: (element) => void element.append(head, { html: true }) })
    .transform(response);
  return finish(rewritten, meta.status, csp);
}

/** A page's status and headers: its security policy, and no caching of HTML that names bundles. */
function finish(response: Response, status: number, csp: boolean): Response {
  const headers = new Headers(response.headers);
  if (csp) headers.set('content-security-policy', PAGE_CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('cache-control', 'no-cache');
  return new Response(response.body, { status, headers });
}

/** The sitemap: both languages of the front page, every public place, and the dishes served. */
export function sitemap(site: string, places: readonly IndexEntry[], dishes: readonly [string, string | null, string | null, number][]): string {
  const urls: { loc: string; lastmod?: string }[] = [];
  for (const locale of ['zh', 'en'] as const) {
    urls.push({ loc: `${site}/${locale}/` });
    for (const entry of places) urls.push({ loc: `${site}/${locale}/place/${entry.id}${entry.s ? `/${entry.s}` : ''}`, lastmod: entry.u.slice(0, 10) });
    for (const [key] of dishes.slice(0, 2000)) urls.push({ loc: `${site}/${locale}/dish/${encodeURIComponent(key)}` });
  }
  const body = urls
    .slice(0, 50_000)
    .map((url) => `<url><loc>${escapeText(url.loc)}</loc>${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}</url>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}
