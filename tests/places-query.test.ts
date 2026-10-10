import { describe, expect, it } from 'vitest';
import type { IndexEntry } from '../src/shared/place-doc';
import { facetCounts, listedLike, queryPlaces } from '../src/shared/places-query';

const entry = (id: string, fields: Partial<IndexEntry>): IndexEntry => ({
  id,
  s: id,
  n: id,
  z: null,
  c: 'restaurant',
  k: [],
  b: null,
  pc: null,
  o: null,
  la: null,
  lo: null,
  t: 'open',
  br: null,
  r: 0,
  m: 0,
  p: 0,
  l: null,
  u: '2026-10-01T00:00:00Z',
  ...fields,
});

const places = [
  entry('golden dragon', { c: 'restaurant', k: ['cantonese', 'dim-sum'], b: 'E09000033', m: 12, o: 'W1D', pc: 'W1D 6JW' }),
  entry('noodle bar', { c: 'restaurant', k: ['noodles', 'shaanxi'], b: 'E09000033' }),
  entry('tea house', { c: 'tea-drinks', k: ['bubble-tea'], b: 'E09000007', p: 2 }),
  entry('old canteen', { c: 'takeaway', k: ['cantonese'], b: 'E09000007', t: 'closed' }),
];

describe('finding places', () => {
  it('keeps the filters it always had', () => {
    const names = (query: Parameters<typeof queryPlaces>[1]) => queryPlaces(places, { sort: 'name', ...query }).map((place) => place.id);
    expect(names({ categories: ['restaurant'] })).toEqual(['golden dragon', 'noodle bar']);
    expect(names({ cuisines: ['cantonese', 'bubble-tea'], openOnly: true })).toEqual(['golden dragon', 'tea house']);
    expect(names({ boroughs: ['E09000007'], withPhotos: true })).toEqual(['tea house']);
    expect(names({ q: 'dragon', withMenu: true })).toEqual(['golden dragon']);
    expect(names({ postcode: 'w1d' })).toEqual(['golden dragon']);
  });

  it('counts, for each choice, the places the list would show with it, the other filters as they are', () => {
    const counts = facetCounts(places, { categories: ['restaurant'], openOnly: true });
    // Choices of the category the reader set count as if that choice were added.
    expect(counts.categories).toEqual({ restaurant: 2, 'tea-drinks': 1 });
    // Other lists count within the categories chosen.
    expect(counts.cuisines).toEqual({ cantonese: 1, 'dim-sum': 1, noodles: 1, shaanxi: 1 });
    expect(counts.boroughs).toEqual({ E09000033: 2 });
    // A toggle counts the places it would leave: the closed takeaway is not a restaurant either.
    expect(counts.openOnly).toBe(2);
    expect(counts.withMenu).toBe(1);
    expect(counts.withPhotos).toBe(0);
  });

  it('counts a choice already made the same as the list it gives', () => {
    const query = { cuisines: ['cantonese'], openOnly: false };
    const counts = facetCounts(places, query);
    expect(counts.cuisines.cantonese).toBe(queryPlaces(places, query).length);
    expect(counts.openOnly).toBe(1);
    expect(counts.categories).toEqual({ restaurant: 1, takeaway: 1 });
  });

  it('counts only what matches the words typed', () => {
    const counts = facetCounts(places, { q: 'tea' });
    expect(counts.categories).toEqual({ 'tea-drinks': 1 });
    expect(counts.withPhotos).toBe(1);
  });
});

describe('places a suggestion may already be', () => {
  const listed = [
    entry('a', { n: 'Golden Dragon', pc: 'W1D 6JW' }),
    entry('b', { n: 'Golden Dragon Express', pc: 'N7 8AB' }),
    entry('c', { n: 'Lotus Garden', z: '莲花园', pc: 'W1D 6JW' }),
    entry('d', { n: 'Noodle Bar', pc: 'E14 5AB' }),
    entry('e', { n: 'Noodle Express', pc: 'SE1 7PB' }),
  ];
  const ids = (name: string, where: string) => listedLike(listed, name, where).map((place) => place.id);

  it('shows the places named alike, the one at the postcode written first', () => {
    expect(ids('golden dragon', '')).toEqual(['a', 'b']);
    expect(ids('Golden Dragon', 'N7 8AB')).toEqual(['b', 'a']);
    expect(ids('莲花园', '')).toEqual(['c']);
  });

  it('shows the other places at that postcode after them, and nothing for a word or two of nothing', () => {
    expect(ids('Golden Dragon', '28 Gerrard St, w1d 6jw')).toEqual(['a', 'b', 'c']);
    expect(ids('Sichuan House', 'E14 5AB')).toEqual(['d']);
    expect(ids('Sichuan House', 'Canary Wharf')).toEqual([]);
    expect(ids('x', '')).toEqual([]);
  });

  it('takes a name typed in part, but not a short name inside a longer one typed', () => {
    expect(ids('Golden Dr', '')).toEqual(['a', 'b']);
    expect(ids('Noodle', '')).toEqual(['d', 'e']);
    expect(ids('Palace Test Noodles', '')).toEqual([]);
    // At the postcode written, the same test the server makes: a name inside the other is alike.
    expect(ids('Noodle', 'E14 5AB')).toEqual(['d', 'e']);
    expect(ids('Lotus', 'W1D 6JW')).toEqual(['c', 'a']);
  });
});
