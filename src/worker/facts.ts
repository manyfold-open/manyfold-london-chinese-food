/**
 * What the server looks up about a place a maintainer has to check, so the maintainer does not
 * start from nothing: the Food Standards Agency's business at its postcode most like it by name,
 * with its last inspection, and the delivery listings at that postcode (Just Eat), with their
 * cuisines and whether they take orders now. Run by the cron for places whose tasks wait, a few
 * a run; maintainers get them with the task (`facts`), the site team in its review queue.
 *
 * Facts are hints to check, never proof: a maintainer still verifies with a page of its own
 * (AGENTS.md, invariant 9). No hygiene score is ever read into them, and no listing's rating.
 */

import { canonicalPostcode, type RecordData } from '../shared/kinds';
import type { PlaceFacts } from '../shared/types';
import { coreName, namesAlike } from '../shared/names';
import { putSetting } from './settings';
import { HttpError } from './types';

/** Places looked up per cron run: each costs two outside calls. */
export const FACTS_PER_RUN = 8;
/** Facts older than this are looked up again for a place still waiting. */
const FACTS_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
const LISTINGS_MAX = 5;
const FSA_API = 'https://api.ratings.food.gov.uk';
const JUST_EAT_API = 'https://uk.api.just-eat.io/discovery/uk/restaurants/enriched/bypostcode';
const UA = 'Mozilla/5.0 (compatible; LondonChineseFood/0.1; +https://app.manyfold.ai/london-chinese-food/)';

interface FsaEstablishment {
  FHRSID: number;
  BusinessName: string;
  BusinessType: string;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  AddressLine4?: string;
  PostCode?: string;
  RatingDate?: string;
}

interface JustEatRestaurant {
  name?: string;
  uniqueName?: string;
  address?: { firstLine?: string; postalCode?: string };
  cuisines?: { name?: string }[];
  isOpenNowForDelivery?: boolean;
  isOpenNowForCollection?: boolean;
  isTemporarilyOffline?: boolean;
}

/** Whether the site may look places up on Just Eat (the admin can turn it off). */
export async function factsSettings(db: D1Database): Promise<{ just_eat: boolean }> {
  const row = await db.prepare(`SELECT value FROM settings WHERE scope = '*' AND key = 'facts-just-eat'`).first<{ value: string }>();
  return { just_eat: row?.value !== 'off' };
}

export async function updateFactsSettings(db: D1Database, body: { just_eat?: unknown }, now: Date): Promise<{ just_eat: boolean }> {
  if (typeof body.just_eat !== 'boolean') throw new HttpError(422, 'invalid_body', 'just_eat must be true or false.');
  await putSetting(db, 'facts-just-eat', body.just_eat ? 'on' : 'off', now).run();
  return factsSettings(db);
}

async function getJson<T>(fetcher: typeof fetch, url: string, headers: Record<string, string>): Promise<T | 'gone' | null> {
  try {
    const response = await fetcher(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return 'gone';
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const fsaAddress = (row: FsaEstablishment): string =>
  [row.AddressLine1, row.AddressLine2, row.AddressLine3, row.AddressLine4].map((line) => line?.trim()).filter(Boolean).join(', ');

/** The inspection date as a day, or null for the FSA's 1901 "awaiting inspection" placeholder. */
const inspected = (value: string | undefined): string | null => (value && !value.startsWith('1901') ? value.slice(0, 10) : null);

function fsaFact(row: FsaEstablishment, place: RecordData): NonNullable<PlaceFacts['fsa']> {
  return {
    id: String(row.FHRSID),
    name: row.BusinessName,
    address: fsaAddress(row),
    business_type: row.BusinessType,
    last_inspection: inspected(row.RatingDate),
    match: coreName({ name_en: row.BusinessName }) === coreName(place) ? 'exact' : 'similar',
  };
}

/** The FSA's business for a place: by its FSA id when it has one, else the one at its postcode most like it by name. */
async function lookUpFsa(place: RecordData, fetcher: typeof fetch): Promise<{ fsa: PlaceFacts['fsa']; missing?: string }> {
  const headers = { 'x-api-version': '2' };
  if (typeof place.fsa_id === 'string' && place.fsa_id) {
    const row = await getJson<FsaEstablishment>(fetcher, `${FSA_API}/Establishments/${encodeURIComponent(place.fsa_id)}`, headers);
    if (row === 'gone') return { fsa: null, missing: `The FSA no longer lists business ${place.fsa_id}: it may have closed or been registered again.` };
    if (row) return { fsa: fsaFact(row, place) };
    return { fsa: null, missing: 'The FSA did not answer.' };
  }
  const postcode = String(place.postcode ?? '');
  const found = await getJson<{ establishments?: FsaEstablishment[] }>(fetcher, `${FSA_API}/Establishments?address=${encodeURIComponent(postcode)}&pageSize=50`, headers);
  if (found === null || found === 'gone') return { fsa: null, missing: 'The FSA did not answer.' };
  const alike = (found.establishments ?? [])
    .filter((row) => canonicalPostcode(row.PostCode ?? '') === canonicalPostcode(postcode))
    .filter((row) => namesAlike({ name_en: row.BusinessName }, place));
  if (alike.length === 0) return { fsa: null, missing: `No FSA business at ${postcode} has a name like it.` };
  const exact = alike.find((row) => coreName({ name_en: row.BusinessName }) === coreName(place));
  return { fsa: fsaFact(exact ?? alike[0]!, place) };
}

/** Just Eat's listings at a place's postcode, the ones named like it first. */
async function lookUpJustEat(place: RecordData, fetcher: typeof fetch): Promise<{ listings: PlaceFacts['listings']; missing?: string }> {
  const postcode = canonicalPostcode(String(place.postcode ?? ''));
  if (!postcode) return { listings: [] };
  const found = await getJson<{ restaurants?: JustEatRestaurant[] }>(fetcher, `${JUST_EAT_API}/${postcode.replace(' ', '')}`, {});
  if (found === null || found === 'gone') return { listings: [], missing: 'Just Eat did not answer.' };
  const here = (found.restaurants ?? []).filter((row) => canonicalPostcode(row.address?.postalCode ?? '') === postcode && row.name && row.uniqueName);
  const listings = here
    .map((row) => ({ row, alike: namesAlike({ name_en: row.name! }, place) }))
    .sort((a, b) => Number(b.alike) - Number(a.alike))
    .slice(0, LISTINGS_MAX)
    .map(({ row }) => ({
      site: 'just-eat' as const,
      name: row.name!,
      address: row.address?.firstLine?.trim() ?? '',
      cuisines: (row.cuisines ?? []).map((cuisine) => cuisine.name ?? '').filter(Boolean),
      open_now: Boolean(row.isOpenNowForDelivery || row.isOpenNowForCollection),
      offline: Boolean(row.isTemporarilyOffline),
      url: `https://www.just-eat.co.uk/restaurants-${row.uniqueName}/menu`,
    }));
  return { listings, ...(here.length === 0 ? { missing: `Just Eat lists nothing at ${postcode}.` } : {}) };
}

/** Everything the server can find out about one place now. */
export async function lookUpPlace(place: RecordData, now: Date, options: { justEat: boolean; fetcher?: typeof fetch }): Promise<PlaceFacts> {
  const fetcher = options.fetcher ?? fetch;
  const [fsa, justEat] = await Promise.all([lookUpFsa(place, fetcher), options.justEat ? lookUpJustEat(place, fetcher) : Promise.resolve(null)]);
  return {
    checked_at: now.toISOString(),
    fsa: fsa.fsa,
    listings: justEat?.listings ?? [],
    missing: [fsa.missing, justEat?.missing].filter((line): line is string => Boolean(line)),
  };
}

/**
 * The cron's share: places whose tasks wait (for a maintainer or the site team) and have no fresh
 * facts, oldest task first, FACTS_PER_RUN at a time. Returns how many were looked up.
 */
export async function gatherFacts(db: D1Database, now: Date, fetcher: typeof fetch = fetch): Promise<number> {
  const fresh = new Date(now.getTime() - FACTS_FRESH_MS).toISOString();
  const lacking = `NOT EXISTS (SELECT 1 FROM facts f WHERE f.record_id = r.id AND f.checked_at > ?1)`;
  // Through the indexes of waiting tasks: the site team's first, then maintainers' oldest.
  const [review, open] = await db.batch([
    db
      .prepare(
        `SELECT r.id, r.data_json FROM tasks t INDEXED BY tasks_review JOIN records r ON r.id = t.record_id
         WHERE t.record_kind = 'place' AND t.status = 'review' AND ${lacking} LIMIT ?2`,
      )
      .bind(fresh, FACTS_PER_RUN),
    db
      .prepare(
        `SELECT r.id, r.data_json FROM tasks t INDEXED BY tasks_open_kind JOIN records r ON r.id = t.record_id
         WHERE t.record_kind = 'place' AND t.status IN ('open', 'leased') AND ${lacking} ORDER BY t.created_at, t.id LIMIT ?2`,
      )
      .bind(fresh, FACTS_PER_RUN),
  ]);
  const seen = new Set<string>();
  const results = [...((review?.results ?? []) as { id: string; data_json: string }[]), ...((open?.results ?? []) as { id: string; data_json: string }[])]
    .filter((row) => !seen.has(row.id) && seen.add(row.id))
    .slice(0, FACTS_PER_RUN);
  if (results.length === 0) return 0;
  const { just_eat } = await factsSettings(db);
  const looked = await Promise.all(
    results.map(async (row) => ({ id: row.id, facts: await lookUpPlace(JSON.parse(row.data_json) as RecordData, now, { justEat: just_eat, fetcher }) })),
  );
  await db.batch(
    looked.map(({ id, facts }) =>
      db
        .prepare(
          `INSERT INTO facts (record_id, facts_json, checked_at) VALUES (?, ?, ?)
           ON CONFLICT (record_id) DO UPDATE SET facts_json = excluded.facts_json, checked_at = excluded.checked_at`,
        )
        .bind(id, JSON.stringify(facts), facts.checked_at),
    ),
  );
  return looked.length;
}
