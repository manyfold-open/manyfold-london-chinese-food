/** The app's pages by path. Plain TypeScript, so tests read it in Node. */

import { localeFrom, type Locale } from '../shared/i18n.ts';

export type Route =
  | { page: 'home'; locale: Locale }
  | { page: 'place'; locale: Locale; id: string }
  | { page: 'dish'; locale: Locale; key: string }
  | { page: 'source'; locale: Locale; key: string; by: 'source' | 'author' }
  | { page: 'contribute' | 'about' | 'privacy'; locale: Locale }
  | { page: 'settings'; section: string | null }
  | { page: 'not-found'; locale: Locale };

export function matchRoute(pathname: string, fallback: Locale): Route {
  const parts = pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] === 'settings') return { page: 'settings', section: parts[1] ?? null };
  const locale = localeFrom(parts[0]);
  if (!locale || parts[0] !== locale) return parts.length === 0 ? { page: 'home', locale: fallback } : { page: 'not-found', locale: fallback };
  const [, page, value] = parts;
  if (!page) return { page: 'home', locale };
  if (page === 'place' && value) return { page: 'place', locale, id: value };
  if (page === 'dish' && value) return { page: 'dish', locale, key: value };
  if (page === 'source' && value) return { page: 'source', locale, key: value, by: 'source' };
  if (page === 'critic' && value) return { page: 'source', locale, key: value, by: 'author' };
  if ((page === 'contribute' || page === 'about' || page === 'privacy') && !value) return { page, locale };
  return { page: 'not-found', locale };
}

/** App paths, by page. */
export const paths = {
  home: (locale: Locale) => `/${locale}/`,
  place: (locale: Locale, id: string, slug?: string) => `/${locale}/place/${id}${slug ? `/${slug}` : ''}`,
  dish: (locale: Locale, key: string) => `/${locale}/dish/${encodeURIComponent(key)}`,
  source: (locale: Locale, key: string) => `/${locale}/source/${encodeURIComponent(key)}`,
  critic: (locale: Locale, key: string) => `/${locale}/critic/${encodeURIComponent(key)}`,
  page: (locale: Locale, page: 'contribute' | 'about' | 'privacy') => `/${locale}/${page}`,
};
