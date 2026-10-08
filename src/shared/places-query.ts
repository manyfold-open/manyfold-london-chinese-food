/**
 * Finding places in the index: the reader's list and map filter it in the browser, and agents'
 * GET /api/search runs the same code in the Worker. Never a sort by anything that ranks places
 * by how good they are: by distance, by the newest review, or by name.
 */

import { normName } from './kinds.ts';
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

export function queryPlaces(entries: readonly IndexEntry[], query: PlaceQuery): IndexEntry[] {
  const postcode = query.postcode ? compact(query.postcode) : null;
  const found = entries.filter((entry) => {
    if (query.q && !matchesText(entry, query.q)) return false;
    if (postcode && !(entry.pc && compact(entry.pc) === postcode) && compact(entry.o ?? '') !== postcode) return false;
    if (query.categories?.length && !query.categories.includes(entry.c)) return false;
    if (query.cuisines?.length && !query.cuisines.some((cuisine) => entry.k.includes(cuisine))) return false;
    if (query.boroughs?.length && !(entry.b && query.boroughs.includes(entry.b))) return false;
    if (query.openOnly && entry.t === 'closed') return false;
    if (query.withMenu && entry.m === 0) return false;
    if (query.withPhotos && entry.p === 0) return false;
    return true;
  });
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
