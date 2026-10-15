/** The app's pages by path. Plain TypeScript, so tests read it in Node. */

import { localeFrom, type Locale } from '../shared/i18n.ts';

export type Route =
  | { page: 'home'; locale: Locale }
  | { page: 'map'; locale: Locale }
  | { page: 'dishes'; locale: Locale }
  | { page: 'place'; locale: Locale; id: string }
  | { page: 'dish'; locale: Locale; key: string }
  | { page: 'line'; locale: Locale; id: string }
  | { page: 'near'; locale: Locale; campus: string }
  | { page: 'guides'; locale: Locale }
  | { page: 'guide'; locale: Locale; slug: string; campus: string | null }
  | { page: 'light-up'; locale: Locale }
  | { page: 'source'; locale: Locale; key: string; by: 'source' | 'author' }
  | { page: 'contribute' | 'about' | 'privacy'; locale: Locale }
  | { page: 'settings'; section: string | null }
  | { page: 'not-found'; locale: Locale };

/** Pages that are a single word after the language. */
const PLAIN = ['map', 'dishes', 'guides', 'light-up', 'contribute', 'about', 'privacy'] as const;
type Plain = (typeof PLAIN)[number];

export function matchRoute(pathname: string, fallback: Locale): Route {
  const parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] === 'settings') return { page: 'settings', section: parts[1] ?? null };
  const locale = localeFrom(parts[0]);
  if (!locale || parts[0] !== locale) return parts.length === 0 ? { page: 'home', locale: fallback } : { page: 'not-found', locale: fallback };
  const [, page, value, extra] = parts;
  if (!page) return { page: 'home', locale };
  if (page === 'place' && value) return { page: 'place', locale, id: value };
  if (page === 'dish' && value) return { page: 'dish', locale, key: value };
  if (page === 'line' && value && !extra) return { page: 'line', locale, id: value };
  if (page === 'near' && value && !extra) return { page: 'near', locale, campus: value };
  if (page === 'guide' && value) return { page: 'guide', locale, slug: value, campus: extra ?? null };
  if (page === 'source' && value) return { page: 'source', locale, key: value, by: 'source' };
  if (page === 'critic' && value) return { page: 'source', locale, key: value, by: 'author' };
  if ((PLAIN as readonly string[]).includes(page) && !value) return { page: page as Plain, locale };
  return { page: 'not-found', locale };
}

/** App paths, by page. */
export const paths = {
  home: (locale: Locale) => `/${locale}/`,
  map: (locale: Locale) => `/${locale}/map`,
  dishes: (locale: Locale) => `/${locale}/dishes`,
  place: (locale: Locale, id: string, slug?: string) => `/${locale}/place/${id}${slug ? `/${slug}` : ''}`,
  dish: (locale: Locale, key: string) => `/${locale}/dish/${encodeURIComponent(key)}`,
  line: (locale: Locale, id: string) => `/${locale}/line/${id}`,
  near: (locale: Locale, campus: string) => `/${locale}/near/${campus}`,
  guides: (locale: Locale) => `/${locale}/guides`,
  guide: (locale: Locale, slug: string, campus?: string | null) => `/${locale}/guide/${slug}${campus ? `/${campus}` : ''}`,
  lightUp: (locale: Locale) => `/${locale}/light-up`,
  source: (locale: Locale, key: string) => `/${locale}/source/${encodeURIComponent(key)}`,
  critic: (locale: Locale, key: string) => `/${locale}/critic/${encodeURIComponent(key)}`,
  page: (locale: Locale, page: 'contribute' | 'about' | 'privacy') => `/${locale}/${page}`,
};
