/**
 * Finding places in the index: the reader's list and map filter it in the browser, and agents'
 * GET /api/search runs the same code in the Worker. Never a sort by anything that ranks places
 * by how good they are: by distance, by the newest review, or by name.
 */

import { findPostcode, normName } from './kinds.ts';
import { coreName, namesAlike } from './names.ts';
import type { IndexEntry } from './place-doc.ts';

export type PlaceSort = 'distance' | 'recent' | 'name';

export interface PlaceQuery {
  q?: string;
  /** A postcode or a postcode district (W1D, or W1D 6JW). */
  postcode?: string;
  categories?: readonly string[];
  cuisines?: readonly string[];
  boroughs?: readonly string[];
  /** Leave out places that closed for good. */
  openOnly?: boolean;
  withMenu?: boolean;
  withPhotos?: boolean;
  sort?: PlaceSort;
  /** Where the reader is, for distance. */
  near?: { lat: number; lng: number };
}

/** Kilometres between two points, on a sphere: plenty for a city. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const compact = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** Whether an entry matches the words someone typed: every word in its names, or its postcode district. */
export function matchesText(entry: IndexEntry, q: string): boolean {
  const words = normName(q).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${normName(entry.n ?? '')} ${normName(entry.z ?? '')} ${(entry.o ?? '').toLowerCase()} ${normName(entry.z ?? '').replace(/\s+/g, '')}`;
  return words.every((word) => haystack.includes(word));
}

type Facet = 'categories' | 'cuisines' | 'boroughs' | 'openOnly' | 'withMenu' | 'withPhotos';

/** Each filter a reader can set, and whether an entry passes it. */
const FACETS: readonly [Facet, (entry: IndexEntry, query: PlaceQuery) => boolean][] = [
  ['categories', (entry, query) => !query.categories?.length || query.categories.includes(entry.c)],
  ['cuisines', (entry, query) => !query.cuisines?.length || query.cuisines.some((cuisine) => entry.k.includes(cuisine))],
  ['boroughs', (entry, query) => !query.boroughs?.length || (entry.b !== null && query.boroughs.includes(entry.b))],
  ['openOnly', (entry, query) => !query.openOnly || entry.t !== 'closed'],
  ['withMenu', (entry, query) => !query.withMenu || entry.m > 0],
  ['withPhotos', (entry, query) => !query.withPhotos || entry.p > 0],
];

/** The one filter an entry fails: null when it passes them all, 'more' when it fails two or more. */
function missed(entry: IndexEntry, query: PlaceQuery): Facet | 'more' | null {
  let found: Facet | null = null;
  for (const [facet, passes] of FACETS) {
    if (passes(entry, query)) continue;
    if (found) return 'more';
    found = facet;
  }
  return found;
}

/** Whether an entry matches what was typed and the postcode, the parts of a query that are not filters. */
function searched(entry: IndexEntry, query: PlaceQuery, postcode: string | null): boolean {
  if (query.q && !matchesText(entry, query.q)) return false;
  return !postcode || (entry.pc !== null && compact(entry.pc) === postcode) || compact(entry.o ?? '') === postcode;
}

export function queryPlaces(entries: readonly IndexEntry[], query: PlaceQuery): IndexEntry[] {
  const postcode = query.postcode ? compact(query.postcode) : null;
  const found = entries.filter((entry) => searched(entry, query, postcode) && missed(entry, query) === null);
  const name = (entry: IndexEntry) => (entry.n ?? entry.z ?? '').toLowerCase();
  const sort = query.sort ?? (query.near ? 'distance' : 'recent');
  if (sort === 'distance' && query.near) {
    const near = query.near;
    const far = (entry: IndexEntry) => (entry.la === null || entry.lo === null ? Number.POSITIVE_INFINITY : distanceKm(near, { lat: entry.la, lng: entry.lo }));
    return found.sort((a, b) => far(a) - far(b) || name(a).localeCompare(name(b)));
  }
  if (sort === 'name') return found.sort((a, b) => name(a).localeCompare(name(b)));
  return found.sort((a, b) => (b.l ?? '').localeCompare(a.l ?? '') || b.u.localeCompare(a.u) || name(a).localeCompare(name(b)));
}

/**
 * For every choice of every filter, how many places the list would show with that choice made
 * and the other filters as they are: the numbers beside the reader's filters. Counts of places,
 * never of anything said about them.
 */
export interface FacetCounts {
  categories: Record<string, number>;
  cuisines: Record<string, number>;
  boroughs: Record<string, number>;
  openOnly: number;
  withMenu: number;
  withPhotos: number;
}

export function facetCounts(entries: readonly IndexEntry[], query: PlaceQuery): FacetCounts {
  const postcode = query.postcode ? compact(query.postcode) : null;
  const counts: FacetCounts = { categories: {}, cuisines: {}, boroughs: {}, openOnly: 0, withMenu: 0, withPhotos: 0 };
  const add = (into: Record<string, number>, value: string) => {
    into[value] = (into[value] ?? 0) + 1;
  };
  for (const entry of entries) {
    if (!searched(entry, query, postcode)) continue;
    // An entry failing one filter counts toward that filter's choices only; failing two, toward none.
    const miss = missed(entry, query);
    if (miss === 'more') continue;
    const counted = (facet: Facet) => miss === null || miss === facet;
    if (counted('categories')) add(counts.categories, entry.c);
    if (counted('cuisines')) for (const cuisine of entry.k) add(counts.cuisines, cuisine);
    if (counted('boroughs') && entry.b) add(counts.boroughs, entry.b);
    if (counted('openOnly') && entry.t !== 'closed') counts.openOnly += 1;
    if (counted('withMenu') && entry.m > 0) counts.withMenu += 1;
    if (counted('withPhotos') && entry.p > 0) counts.withPhotos += 1;
  }
  return counts;
}

/**
 * Whether a name being typed may be a place listed under `listed`, anywhere in London: the listed
 * name holds what was typed (in full, or its start), or is the same name spelled another way, or
 * most of a longer name typed. A short listed name inside a long typed one ("Noodle Express" in
 * "Palace Test Noodles") is not enough without the postcode.
 */
function typedLike(typed: string, listed: string): boolean {
  const mine = coreName({ name_en: typed });
  const theirs = coreName({ name_en: listed });
  if (!mine || !theirs) return false;
  if (theirs.includes(mine)) return mine === theirs || mine.length >= (/\p{Script=Han}/u.test(mine) ? 2 : 3);
  return namesAlike({ name_en: typed }, { name_en: listed }) && theirs.length * 5 >= mine.length * 3;
}

/**
 * Places already listed that may be the one a visitor is about to suggest: those at the postcode
 * they wrote named alike (as the server tells a duplicate), those elsewhere named like what they
 * typed, then the others at that postcode. The suggestion form shows them before anything is sent.
 */
export function listedLike(entries: readonly IndexEntry[], name: string, where: string, most = 5): IndexEntry[] {
  const wanted = name.trim();
  const postcode = findPostcode(where);
  const names = (entry: IndexEntry) => [entry.n, entry.z].filter((other): other is string => other !== null);
  const here = (entry: IndexEntry) => postcode !== null && entry.pc !== null && compact(entry.pc) === compact(postcode);
  const rank = (entry: IndexEntry) => {
    if (here(entry)) return names(entry).some((other) => namesAlike({ name_en: wanted }, { name_en: other })) ? 0 : 2;
    return names(entry).some((other) => typedLike(wanted, other)) ? 1 : 3;
  };
  return entries
    .map((entry) => ({ entry, rank: rank(entry) }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, most)
    .map(({ entry }) => entry);
}
