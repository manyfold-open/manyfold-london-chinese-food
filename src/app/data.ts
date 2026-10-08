/** What pages read from the API, typed. Answers are kept for the session (src/app/api.ts). */

import type { IndexEntry, PlaceDoc } from '../shared/place-doc';
import { useApi } from './api';

export const useIndex = () => useApi<{ places: IndexEntry[] }>('/api/index');

export const usePlace = (id: string) => useApi<PlaceDoc>(`/api/places/${encodeURIComponent(id)}`);

/** The dish catalog: [key, name in Chinese, name in English, places], loaded when a search needs it. */
export type DishEntry = [string, string | null, string | null, number];
export const useDishCatalog = (wanted: boolean) => useApi<{ dishes: DishEntry[] }>(wanted ? '/api/dishes' : null);

export interface DishPlace {
  place_id: string;
  via: 'menu' | 'review';
  entry: { name_zh: string | null; name_en: string | null; price_pence: number | null; item_key: string | null; photo: string | null };
}
export const useDish = (key: string) => useApi<{ dish: string; places: DishPlace[] }>(`/api/dishes/${encodeURIComponent(key)}`);

export interface SourceEntry {
  id: string;
  place_id: string;
  slug: string;
  place_en: string | null;
  place_zh: string | null;
  publication: string;
  author: string | null;
  source_type: string;
  language: string;
  excerpt: string;
  source_url: string;
  published_on: string;
}
export const useSource = (by: 'source' | 'author', key: string, page: number) =>
  useApi<{ key: string; total: number; page: number; entries: SourceEntry[] }>(`/api/${by === 'source' ? 'sources' : 'critics'}/${encodeURIComponent(key)}?page=${page}`);

/** Which dishes have an approved illustration, and whether the site shows them at all. */
export const useIllustrations = () => useApi<{ shown: boolean; dishes: Record<string, string> }>('/api/illustrations');
