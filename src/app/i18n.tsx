/**
 * The reader's language: the first segment of every page's path (/zh/..., /en/...), so a link
 * says which language it is in and search engines see both. The choice is remembered in this
 * browser (localStorage) and in a cookie scoped to the site's own path, which the Worker reads to
 * send "/" to the right language.
 */

import { createContext, useContext } from 'react';
import { COPY, type Copy, type Locale } from '../shared/i18n';
import { BASE } from './base';

export const LOCALE_KEY = 'lcf.locale';
export const LOCALE_COOKIE = 'lcf_locale';

export const LocaleContext = createContext<Locale>('zh');

export const useLocale = (): Locale => useContext(LocaleContext);
export const useCopy = (): Copy => COPY[useLocale()];

/** The language this browser chose before, if any. */
export function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_KEY);
    return value === 'zh' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

export function rememberLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // storage blocked: the path still says the language
  }
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=${BASE || '/'}; max-age=31536000; samesite=lax`;
}

/** The same page in the other language: only the first segment changes. */
export const otherLocalePath = (pathname: string, to: Locale): string => pathname.replace(/^\/(zh|en)(?=\/|$)/, `/${to}`) || `/${to}/`;
