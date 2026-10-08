/** Labels for the closed lists, in the reader's language. */

import { BOROUGHS, CATEGORY_LABELS, CUISINE_LABELS, DIETARY_LABELS, LANGUAGE_LABELS, MENU_LABELS, PHOTO_SUBJECT_LABELS, SOURCE_TYPE_LABELS } from '../../kinds/vocab';
import type { Bilingual } from '../shared/kinds';
import type { Locale } from '../shared/i18n';

const pick = (labels: Readonly<Record<string, Bilingual>>, value: string, locale: Locale): string => labels[value]?.[locale] ?? value;

export const categoryLabel = (value: string, locale: Locale) => pick(CATEGORY_LABELS, value, locale);
export const cuisineLabel = (value: string, locale: Locale) => pick(CUISINE_LABELS, value, locale);
export const boroughLabel = (code: string | null, locale: Locale) => (code ? (BOROUGHS[code]?.[locale] ?? code) : '');
export const menuLabel = (value: string, locale: Locale) => pick(MENU_LABELS, value, locale);
export const sourceTypeLabel = (value: string, locale: Locale) => pick(SOURCE_TYPE_LABELS, value, locale);
export const languageLabel = (value: string, locale: Locale) => pick(LANGUAGE_LABELS, value, locale);
export const dietaryLabel = (value: string, locale: Locale) => pick(DIETARY_LABELS, value, locale);
export const subjectLabel = (value: string, locale: Locale) => pick(PHOTO_SUBJECT_LABELS, value, locale);

export const CATEGORIES = Object.keys(CATEGORY_LABELS);
export const CUISINES = Object.keys(CUISINE_LABELS);
export const BOROUGH_CODES = Object.keys(BOROUGHS).sort((a, b) => BOROUGHS[a]!.en.localeCompare(BOROUGHS[b]!.en));

/** A place's name in the reader's language first, the other after. */
export function placeNames(names: { en: string | null; zh: string | null }, locale: Locale): { main: string; other: string | null } {
  const first = locale === 'zh' ? (names.zh ?? names.en) : (names.en ?? names.zh);
  const second = locale === 'zh' ? names.en : names.zh;
  return { main: first ?? '', other: second && second !== first ? second : null };
}
