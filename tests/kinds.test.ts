import { describe, expect, it } from 'vitest';
import { ALL_KINDS, KIND_CONFIGS } from '../kinds/index';
import {
  canonicalPostcode,
  checkAccept,
  identityKey,
  isMostlyCjk,
  isPartialDate,
  normalizeUrl,
  normName,
  patchList,
  textsOf,
  validateConfig,
  validateProvenance,
  validateRecordData,
  type KindConfig,
  type ListItem,
  type RecordData,
} from '../src/shared/kinds';
import { SAME_PASSAGE, similarity } from '../src/shared/similar';

const { place, menu, review, photo, brand } = KIND_CONFIGS;
const PLACE_ID = 'rec_01k70q4mgw8b1r7f3s5t9v2x4y';
const errorsOf = (config: KindConfig, data: unknown) => {
  const result = validateRecordData(config, data);
  return result.ok ? [] : result.errors;
};

describe('every kind config', () => {
  it.each(ALL_KINDS.map((config) => [config.kind, config] as const))('%s is valid, and so is its example', (_kind, config) => {
    expect(validateConfig(config, ALL_KINDS)).toEqual([]);
  });

  it('catches a broken config', () => {
    const broken = { ...brand, identity: ['nope'], display: ['missing'] } as KindConfig;
    expect(validateConfig(broken, ALL_KINDS).join('\n')).toMatch(/identity names unknown field "nope"[\s\S]*display names unknown field "missing"/);
  });
});

describe('field values', () => {
  const good = { name_en: 'Example Noodle House', category: 'restaurant', address: '12 Example Street', postcode: 'w1d6jw', trading: 'open' };

  it('cleans what it accepts: postcodes written properly, text trimmed', () => {
    const result = validateRecordData(place, { ...good, name_en: '  Example   Noodle House ' });
    expect(result.ok && result.value).toMatchObject({ name_en: 'Example Noodle House', postcode: 'W1D 6JW' });
  });

  it('refuses unknown fields, naming the real ones', () => {
    expect(errorsOf(place, { ...good, rating: 5 })[0]).toMatchObject({ field: 'rating', message: expect.stringContaining('fields are name_en') });
  });

  it('refuses server fields from agents but keeps them for the server', () => {
    expect(errorsOf(place, { ...good, lat: 51.5 })[0]).toMatchObject({ field: 'lat', message: 'is set by the server; leave it out' });
    const stored = validateRecordData(place, { ...good, lat: 51.5, borough: 'Westminster' }, { allowServer: true });
    expect(stored.ok && stored.value.lat).toBe(51.5);
  });

  it('needs one of the names', () => {
    const { name_en: _drop, ...nameless } = good;
    expect(errorsOf(place, nameless).map((error) => error.field)).toContain('name_en');
    expect(errorsOf(place, { ...nameless, name_zh: '示例面馆' })).toEqual([]);
  });

  it('allows a closing date only on a closed place', () => {
    expect(errorsOf(place, { ...good, closed_on: '2025-03' })[0]?.field).toBe('closed_on');
    expect(errorsOf(place, { ...good, trading: 'closed', closed_on: '2025-03' })).toEqual([]);
  });

  it('checks postcodes, phones and refs by shape', () => {
    const errors = errorsOf(place, { ...good, postcode: 'LONDON', phone: 'call us', brand: 'Example Tea' });
    expect(errors.map((error) => error.field).sort()).toEqual(['brand', 'phone', 'postcode']);
    expect(errorsOf(place, { ...good, phone: '+44 20 7123 4567', brand: '#0' })).toEqual([]);
  });

  it('reads partial dates', () => {
    expect(['2026', '2026-05', '2026-05-31'].every(isPartialDate)).toBe(true);
    expect(['2026-13', '26-05', '2026-02-30', '1850'].some(isPartialDate)).toBe(false);
    expect(checkAccept(review, { published_on: '2026-11' }, '2026-10-08')[0]?.field).toBe('published_on');
    expect(checkAccept(review, { published_on: '2026-10' }, '2026-10-08')).toEqual([]);
  });
});

describe('list fields: a menu', () => {
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ name_en: `Dish ${index}`, price_pence: 100 + index }));
  const base = { owner: PLACE_ID, menu: 'main', source_kind: 'website' };

  it('validates every item and names each error by its path', () => {
    const errors = errorsOf(menu, { ...base, items: [{ name_en: 'Fine', price_pence: 1280 }, { price_pence: 12.8 }, { name_zh: '饺子', cost: 3 }] });
    expect(errors.map((error) => error.field)).toEqual(['items[1].price_pence', 'items[1]', 'items[2].cost']);
    expect(errors[0]!.message).toContain('£12.80 is 1280');
  });

  it('reports at most twenty item errors, then a count', () => {
    const errors = errorsOf(menu, { ...base, items: Array.from({ length: 30 }, () => ({ price_pence: -1 })) });
    expect(errors).toHaveLength(21);
    expect(errors.at(-1)!.message).toMatch(/and \d+ more item errors/);
  });

  it('caps the list', () => {
    expect(errorsOf(menu, { ...base, items: items(601) })[0]?.message).toContain('at most 600 items');
    expect(errorsOf(menu, { ...base, items: items(600) })).toEqual([]);
  });

  it('needs a title for an "other" menu and the photo for a visitor-photo menu', () => {
    const fields = errorsOf(menu, { ...base, menu: 'other', source_kind: 'visitor-photo', items: items(1) }).map((error) => error.field);
    expect(fields).toEqual(['title', 'photo']);
  });

  it('keeps ratings out of printed descriptions too', () => {
    const errors = errorsOf(menu, { ...base, items: [{ name_en: 'Duck', description: "Chef's pick ⭐⭐⭐" }] });
    expect(errors[0]).toMatchObject({ field: 'items[0].description', message: expect.stringContaining('never their scores') });
  });

  it('patches a list by index: set, remove and add, in that order', () => {
    const list: ListItem[] = [{ name_en: 'A', price_pence: 100 }, { name_en: 'B', price_pence: 200 }, { name_en: 'C', price_pence: 300 }];
    const patched = patchList(list, [{ index: 0, set: { price_pence: 150 } }, { index: 1, remove: true }, { add: { name_en: 'D' }, after: 2 }, { add: { name_en: 'Z' } }], 'items');
    expect(patched.ok && patched.value.map((item) => `${item.name_en}${item.price_pence ?? ''}`)).toEqual(['Z', 'A150', 'C300', 'D']);
    const bad = patchList(list, [{ index: 9, set: {} }], 'items');
    expect(!bad.ok && bad.errors[0]!.field).toBe('patches.items[0]');
  });
});

describe('review excerpts', () => {
  const data = { place: PLACE_ID, published_on: '2026-05', publication: 'Example Food Blog', source_type: 'blog', language: 'en' };
  const provenance = (evidence: string) => validateProvenance(review, { source_url: 'https://example.com/post', evidence, observed_at: '2026-10-08T10:00:00Z' }, new Date('2026-10-08T12:00:00Z'));

  it('holds an English excerpt to 300 characters and a Chinese one to 150', () => {
    expect(provenance('a'.repeat(300)).ok).toBe(true);
    expect(provenance('a'.repeat(301)).ok).toBe(false);
    expect(provenance('好'.repeat(150)).ok).toBe(true);
    const long = provenance('好'.repeat(151));
    expect(!long.ok && long.errors[0]!.message).toContain('150 for Chinese text');
  });

  it('refuses an excerpt with a score in it, and one with "..."', () => {
    expect(!provenance('Great dumplings, 9/10.').ok).toBe(true);
    expect(!provenance('Great dumplings... and noodles.').ok).toBe(true);
  });

  it('names authors only for public writers', () => {
    expect(errorsOf(review, { ...data, author: 'A. Writer' })).toEqual([]);
    expect(errorsOf(review, { ...data, source_type: 'platform', author: 'Jane D.' })[0]?.field).toBe('author');
  });

  it('wants the translation in the other language', () => {
    expect(errorsOf(review, { ...data, translation: 'The same, in English.' })[0]?.field).toBe('translation');
    expect(errorsOf(review, { ...data, translation: '虾饺皮很薄。' })).toEqual([]);
    expect(errorsOf(review, { ...data, language: 'zh', translation: '虾饺皮很薄。' })[0]?.field).toBe('translation');
  });

  it('only accepts archive hosts for the archived copy', () => {
    expect(errorsOf(review, { ...data, archive_url: 'https://example.com/copy' })[0]?.field).toBe('archive_url');
    expect(errorsOf(review, { ...data, archive_url: 'https://web.archive.org/web/2026/https://example.com/post' })).toEqual([]);
  });
});

describe('photos', () => {
  it('needs the dish name when the photo is of a dish', () => {
    expect(errorsOf(photo, { place: PLACE_ID, subject: 'dish' })[0]?.field).toBe('dish_name');
    expect(errorsOf(photo, { place: PLACE_ID, subject: 'storefront' })).toEqual([]);
  });
});

describe('identity', () => {
  const placeData: RecordData = { name_en: 'The Example Noodle House & Bar', postcode: 'W1D 6JW', category: 'restaurant', address: 'x', trading: 'open' };

  it('compares names without case, punctuation, "&" or a leading "the"', () => {
    expect(normName('The Example Noodle-House & Bar!')).toBe('example noodle house and bar');
    expect(normName('「示例」面馆')).toBe('示例 面馆');
    expect(identityKey(place, placeData)).toBe(identityKey(place, { ...placeData, name_en: 'example noodle house and bar' }));
  });

  it('falls back to the Chinese name when there is no English one', () => {
    expect(identityKey(place, { postcode: 'W1D 6JW', name_zh: '示例面馆' })).toBe('W1D 6JW|示例面馆');
  });

  it('keys a review by its place, page and passage', () => {
    const a = identityKey(review, { place: PLACE_ID }, { source_url: 'https://www.example.com/post/?utm_source=x', evidence: 'Thin skins!' });
    const b = identityKey(review, { place: PLACE_ID }, { source_url: 'https://example.com/post', evidence: 'thin skins' });
    expect(a).toBe(b);
  });

  it('gives every photo its own identity', () => {
    expect(identityKey(photo, { place: PLACE_ID, subject: 'dish' })).toBe('');
  });

  it('normalizes URLs, YouTube short links included', () => {
    expect(normalizeUrl('https://youtu.be/abc123?si=x')).toBe('https://youtube.com/watch?v=abc123');
    expect(normalizeUrl('https://m.youtube.com/watch?v=abc123&t=42')).toBe('https://youtube.com/watch?v=abc123');
    expect(normalizeUrl('https://old.reddit.com/r/london/comments/x/')).toBe('https://reddit.com/r/london/comments/x');
  });

  it('writes postcodes one way', () => {
    expect(canonicalPostcode('sw1a1aa')).toBe('SW1A 1AA');
    expect(canonicalPostcode('EC1V 9BD')).toBe('EC1V 9BD');
    expect(canonicalPostcode('NOT A CODE')).toBeNull();
  });
});

describe('text helpers', () => {
  it('finds every text in a record, list items included', () => {
    expect(textsOf({ name: 'A', items: [{ name_en: 'B', price_pence: 1, dietary: ['vegan'] }] })).toEqual(['A', 'B', 'vegan']);
  });

  it('tells mostly-Chinese text apart', () => {
    expect(isMostlyCjk('虾饺皮很薄 har gow')).toBe(true);
    expect(isMostlyCjk('The har gow (虾饺) was good')).toBe(false);
  });

  it('says whether a quote is the same passage', () => {
    const passage = 'The har gow had thin, almost translucent skins with a whole prawn inside.';
    expect(similarity(passage, 'the har gow had thin almost translucent skins with a whole prawn inside')).toBe(1);
    expect(similarity(passage, 'The har gow had thin, almost translucent skins.')).toBeGreaterThan(0.6);
    expect(similarity(passage, 'Service was slow and the room was cold.')).toBeLessThan(SAME_PASSAGE);
    expect(similarity('虾饺皮很薄，里面是一整只虾', '虾饺皮很薄里面是一整只虾')).toBe(1);
  });
});
