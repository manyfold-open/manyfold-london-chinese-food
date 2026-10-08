/**
 * Where a postcode is: looked up once at postcodes.io (Office for National Statistics data, Open
 * Government Licence) and kept in D1. A place's coordinates and borough come only from here,
 * never from what an agent sends, and a place counts as London only when its postcode's local
 * authority is one of London's 33 (ONS codes E09...).
 */

import { BOROUGHS } from '../../kinds/vocab';

export interface PostcodeInfo {
  postcode: string;
  outcode: string;
  lat: number | null;
  lng: number | null;
  district: string | null;
  district_code: string | null;
  london: boolean;
}

/** What a lookup found: the postcode, that it does not exist, or that the service did not answer. */
export type PostcodeAnswer = PostcodeInfo | 'unknown' | 'unavailable';

/** A postcode not found is asked again after this long: new postcodes reach the data late. */
const UNKNOWN_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const BULK_MAX = 100;

interface Row {
  postcode: string;
  outcode: string;
  lat: number | null;
  lng: number | null;
  district: string | null;
  district_code: string | null;
  london: number;
  checked_at: string;
}

interface ApiResult {
  query: string;
  result: {
    postcode: string;
    outcode: string;
    latitude: number | null;
    longitude: number | null;
    admin_district: string | null;
    codes?: { admin_district?: string | null };
  } | null;
}

const isLondon = (code: string | null | undefined): boolean => Boolean(code && code in BOROUGHS);

/**
 * Looks up postcodes (written "W1D 6PQ"), the stored answers first, then one request to
 * postcodes.io for the rest. A failed request leaves those postcodes 'unavailable', so the caller
 * can say "try again later" rather than "no such postcode".
 */
export async function lookupPostcodes(
  db: D1Database,
  postcodes: readonly string[],
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, PostcodeAnswer>> {
  const answers = new Map<string, PostcodeAnswer>();
  const wanted = [...new Set(postcodes)];
  if (wanted.length === 0) return answers;

  const { results } = await db
    .prepare('SELECT * FROM postcodes WHERE postcode IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(wanted))
    .all<Row>();
  for (const row of results) {
    if (row.lat === null && row.district_code === null) {
      if (now.getTime() - Date.parse(row.checked_at) < UNKNOWN_RETRY_MS) answers.set(row.postcode, 'unknown');
      continue;
    }
    answers.set(row.postcode, { ...row, london: row.london === 1 });
  }

  const missing = wanted.filter((postcode) => !answers.has(postcode));
  for (let start = 0; start < missing.length; start += BULK_MAX) {
    const chunk = missing.slice(start, start + BULK_MAX);
    let found: ApiResult[];
    try {
      const response = await fetcher('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ postcodes: chunk }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`postcodes.io answered ${response.status}`);
      found = ((await response.json()) as { result: ApiResult[] }).result;
    } catch {
      for (const postcode of chunk) answers.set(postcode, 'unavailable');
      continue;
    }
    const at = now.toISOString();
    const writes: D1PreparedStatement[] = [];
    for (const postcode of chunk) {
      const hit = found.find((entry) => entry.query.replace(/\s+/g, '').toUpperCase() === postcode.replace(/\s+/g, ''))?.result;
      const info: PostcodeInfo | null = hit
        ? {
            postcode,
            outcode: hit.outcode,
            lat: hit.latitude,
            lng: hit.longitude,
            district: hit.admin_district,
            district_code: hit.codes?.admin_district ?? null,
            london: isLondon(hit.codes?.admin_district),
          }
        : null;
      answers.set(postcode, info ?? 'unknown');
      writes.push(
        db
          .prepare(
            `INSERT INTO postcodes (postcode, outcode, lat, lng, district, district_code, london, checked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (postcode) DO UPDATE SET outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng,
               district = excluded.district, district_code = excluded.district_code, london = excluded.london,
               checked_at = excluded.checked_at`,
          )
          .bind(postcode, info?.outcode ?? postcode.split(' ')[0]!, info?.lat ?? null, info?.lng ?? null, info?.district ?? null,
            info?.district_code ?? null, info?.london ? 1 : 0, at),
      );
    }
    if (writes.length > 0) await db.batch(writes);
  }
  return answers;
}

/** The fields a place gets from its postcode. */
export const placeFieldsFrom = (info: PostcodeInfo): Record<string, string | number> => {
  const fields: Record<string, string | number> = { outcode: info.outcode };
  if (info.lat !== null && info.lng !== null) {
    fields.lat = Math.round(info.lat * 1e6) / 1e6;
    fields.lng = Math.round(info.lng * 1e6) / 1e6;
  }
  if (info.district_code) {
    fields.borough_code = info.district_code;
    fields.borough = BOROUGHS[info.district_code]?.en ?? info.district ?? '';
  }
  return fields;
};
