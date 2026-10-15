/**
 * Where people come from: London's universities with the most Chinese students, each by its main
 * campus, and walking from them. "Near" is a straight line of a kilometre, about fifteen minutes on
 * foot. Places near a campus come in walking order, never in any order of how good they are.
 */

import type { Bilingual } from './kinds.ts';
import type { IndexEntry } from './place-doc.ts';
import { distanceKm } from './places-query.ts';
import { STATIONS } from './stations-data.ts';

export interface Campus {
  id: string;
  /** The name students use, the same in both languages: UCL, LSE. */
  short: string;
  name: Bilingual;
  /** The neighbourhood, as a station sign would say it. */
  area: string;
  lat: number;
  lng: number;
  /** The line colour its sign wears (kinds/vocab.ts, LINES). */
  line: string;
}

export const CAMPUSES: readonly Campus[] = [
  { id: 'ucl', short: 'UCL', name: { en: 'University College London', zh: '伦敦大学学院' }, area: 'Bloomsbury', lat: 51.5246, lng: -0.134, line: 'grocery' },
  { id: 'lse', short: 'LSE', name: { en: 'London School of Economics', zh: '伦敦政治经济学院' }, area: 'Holborn', lat: 51.5144, lng: -0.1165, line: 'spicy' },
  { id: 'kcl', short: 'KCL', name: { en: "King's College London", zh: '伦敦国王学院' }, area: 'Strand', lat: 51.5115, lng: -0.116, line: 'dimsum' },
  { id: 'soas', short: 'SOAS', name: { en: 'SOAS University of London', zh: '亚非学院' }, area: 'Russell Square', lat: 51.5222, lng: -0.129, line: 'modern' },
  { id: 'imperial', short: 'Imperial', name: { en: 'Imperial College London', zh: '帝国理工学院' }, area: 'South Kensington', lat: 51.4988, lng: -0.1749, line: 'noodle' },
  { id: 'qmul', short: 'QMUL', name: { en: 'Queen Mary University of London', zh: '伦敦玛丽女王大学' }, area: 'Mile End', lat: 51.5241, lng: -0.0404, line: 'takeaway' },
  { id: 'ual', short: 'UAL', name: { en: 'Central Saint Martins, UAL', zh: '中央圣马丁 UAL' }, area: "King's Cross", lat: 51.5354, lng: -0.1249, line: 'north' },
  { id: 'city', short: 'City', name: { en: "City St George's, University of London", zh: '伦敦城市大学' }, area: 'Angel', lat: 51.5279, lng: -0.1025, line: 'boba' },
  { id: 'westminster', short: 'Westminster', name: { en: 'University of Westminster', zh: '威斯敏斯特大学' }, area: 'Regent Street', lat: 51.5171, lng: -0.1426, line: 'spicy' },
  { id: 'goldsmiths', short: 'Goldsmiths', name: { en: 'Goldsmiths, University of London', zh: '金史密斯学院' }, area: 'New Cross', lat: 51.4743, lng: -0.0354, line: 'dimsum' },
];

/** A straight-line kilometre: about fifteen minutes' walk on London's streets. */
export const NEAR_KM = 1;
/** Minutes on foot per straight-line kilometre, streets being longer than the crow's line. */
export const WALK_MIN_PER_KM = 15;

export const campusById = (id: string): Campus | undefined => CAMPUSES.find((campus) => campus.id === id);

/** About how many minutes on foot a straight-line distance is. */
export const walkMinutes = (km: number): number => Math.max(1, Math.round(km * WALK_MIN_PER_KM));

export interface Nearby {
  entry: IndexEntry;
  km: number;
}

/** The open places within `km` of a point, nearest first. */
export function placesNear(entries: readonly IndexEntry[], point: { lat: number; lng: number }, km = NEAR_KM): Nearby[] {
  const out: Nearby[] = [];
  for (const entry of entries) {
    if (entry.t !== 'open' || entry.la === null || entry.lo === null) continue;
    const d = distanceKm(point, { lat: entry.la, lng: entry.lo });
    if (d <= km) out.push({ entry, km: d });
  }
  return out.sort((a, b) => a.km - b.km);
}

/** The station nearest a point, where it is and how far. */
export function nearestStation(point: { lat: number; lng: number }): { name: string; lat: number; lng: number; km: number } | null {
  let best: { name: string; lat: number; lng: number; km: number } | null = null;
  for (const [name, lat, lng] of STATIONS) {
    const km = distanceKm(point, { lat, lng });
    if (!best || km < best.km) best = { name, lat, lng, km };
  }
  return best;
}

/** The campuses within walking distance of a point, nearest first. */
export function campusesNear(point: { lat: number; lng: number }, km = 1.5): { campus: Campus; km: number }[] {
  return CAMPUSES.map((campus) => ({ campus, km: distanceKm(point, campus) }))
    .filter((near) => near.km <= km)
    .sort((a, b) => a.km - b.km);
}
