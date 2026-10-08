import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, CUISINE_LABELS, MENU_LABELS, SOURCE_TYPE_LABELS } from '../kinds/vocab';
import { allStrings, COPY, localeFrom, localeFromAcceptLanguage } from '../src/shared/i18n';
import { findRating } from '../src/shared/rating-guard';

const shape = (value: unknown): unknown =>
  typeof value === 'function'
    ? 'function'
    : Array.isArray(value)
      ? 'array'
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
        : typeof value;

describe('the copy', () => {
  it('has the same shape in both languages', () => {
    expect(shape(COPY.zh)).toEqual(shape(COPY.en));
    expect(COPY.zh.about.paragraphs).toHaveLength(COPY.en.about.paragraphs.length);
  });

  it('never praises, ranks or scores anything', () => {
    for (const locale of ['zh', 'en'] as const) {
      for (const text of allStrings(COPY[locale])) expect(findRating(text), text).toBeNull();
    }
  });

  it('labels every closed list in both languages', () => {
    for (const labels of [CATEGORY_LABELS, CUISINE_LABELS, MENU_LABELS, SOURCE_TYPE_LABELS]) {
      for (const label of Object.values(labels)) {
        expect(label.zh.length).toBeGreaterThan(0);
        expect(label.en.length).toBeGreaterThan(0);
      }
    }
  });

  it('reads a language from a path, a cookie or a browser', () => {
    expect(localeFrom('zh-Hant-HK')).toBe('zh');
    expect(localeFrom('EN')).toBe('en');
    expect(localeFrom('fr')).toBeNull();
    expect(localeFromAcceptLanguage('de-DE,en-GB;q=0.8,zh;q=0.5')).toBe('en');
    expect(localeFromAcceptLanguage(undefined)).toBe('zh');
  });
});
