/** How values read on the page, in either language. */

import type { Locale } from '../shared/i18n';

/** Pence as pounds: 1280 → "£12.80", 1200 → "£12". */
export function price(pence: number): string {
  const pounds = pence / 100;
  return `£${Number.isInteger(pounds) ? pounds : pounds.toFixed(2)}`;
}

/** A date as precise as it was given: 2026 / 2026-05 / 2026-05-31. */
export function partialDate(value: string, locale: Locale): string {
  const [year, month, day] = value.split('-');
  if (!year) return value;
  if (locale === 'zh') return `${year}年${month ? `${Number(month)}月` : ''}${day ? `${Number(day)}日` : ''}`;
  if (!month) return year;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day ?? 1)));
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'short', ...(day ? { day: 'numeric' } : {}) }).format(date);
}

/** A time as a date, e.g. for "prices as seen". */
export const day = (iso: string, locale: Locale): string => partialDate(iso.slice(0, 10), locale);

/** Kilometres as people say them. */
export const distance = (km: number, locale: Locale): string =>
  km < 1 ? `${Math.round(km * 1000 / 10) * 10}${locale === 'zh' ? ' 米' : ' m'}` : `${km.toFixed(km < 10 ? 1 : 0)}${locale === 'zh' ? ' 公里' : ' km'}`;

/** The first character or two of a name, for an avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '?';
  if (/\p{Script=Han}/u.test(words[0]![0]!)) return [...words[0]!][0]!;
  return words.slice(0, 2).map((word) => [...word][0]!.toUpperCase()).join('');
}

/** A stable hue for a name, so the same name has the same color everywhere. */
export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}

/** An https link a page may show, or null. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A URL as people read it: host and path, no scheme. */
export const displayUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
