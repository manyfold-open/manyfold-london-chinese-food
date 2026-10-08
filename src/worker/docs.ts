/**
 * The read models readers get, built from records that changed (AGENTS.md, invariant 15):
 *
 *   place_docs        one row per public place: its page (src/shared/place-doc.ts) and its index line
 *   dataset 'index'   every public place's index line, in parts: the list, the map, the filters
 *   dish_places       where each dish can be eaten
 *   dishes            each dish once, with how many places serve it and its illustration
 *   dataset 'dishes'  the dish catalog readers search, loaded only when they search
 *   dataset 'illustrations'  which dishes have an approved illustration
 *   source_entries    every public excerpt by source and author, for their pages
 *
 * The cron finds what changed through records.updated_at (one range read), marks the places it
 * touches dirty — a brand's change marks every branch — and rebuilds a bounded number each run.
 * Once a UTC day the index is rebuilt whole and dish counts are counted again, which mends any
 * drift. A reader's request reads one row or a dataset's few parts.
 */

import { buildPlace, type DocHistoryEntry, type DocRecord, type IndexEntry } from '../shared/place-doc';
import type { RecordData } from '../shared/kinds';
import type { RecordStatus } from '../shared/types';
import { actorLabel } from './console';
import { sha256Hex } from './ids';
import { doneWork, wantWork } from './work';

/** The longest stored part of a dataset's JSON: D1 caps a row at 2 MB. */
export const PART_BYTES = 1_500_000;
/** How many dirty places one run rebuilds. */
export const REBUILD_MAX = 40;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** JSON in parts of at most `max` bytes, each cut between characters: joined, they are the JSON again. */
export function splitParts(json: string, max = PART_BYTES): string[] {
  const bytes = encoder.encode(json);
  if (bytes.length <= max) return [json];
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; ) {
    let end = Math.min(start + max, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return parts;
}

/** A stored dataset's JSON, or null when it was never built. */
export async function datasetJson(db: D1Database, name: string): Promise<string | null> {
  const { results } = await db.prepare('SELECT json FROM dataset_parts WHERE name = ? ORDER BY part').bind(name).all<{ json: string }>();
  return results.length ? results.map((row) => row.json).join('') : null;
}

function storeDataset(db: D1Database, name: string, json: string, count: number, at: string, whole: boolean): D1PreparedStatement[] {
  const parts = splitParts(json);
  return [
    ...parts.map((text, part) =>
      db.prepare('INSERT INTO dataset_parts (name, part, json) VALUES (?, ?, ?) ON CONFLICT (name, part) DO UPDATE SET json = excluded.json').bind(name, part, text),
    ),
    db.prepare('DELETE FROM dataset_parts WHERE name = ? AND part >= ?').bind(name, parts.length),
    db
      .prepare(
        `INSERT INTO dataset_heads (name, count, built_at, full_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (name) DO UPDATE SET count = excluded.count, built_at = excluded.built_at, full_at = coalesce(excluded.full_at, dataset_heads.full_at)`,
      )
      .bind(name, count, at, whole ? at : null),
  ];
}

interface RecordRow {
  id: string;
  kind: string;
  status: RecordStatus;
  data_json: string;
  source_url: string;
  evidence: string;
  observed_at: string;
  verified_at: string | null;
  updated_at: string;
  parent_id: string | null;
}

const toDoc = (row: RecordRow): DocRecord => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  data: JSON.parse(row.data_json) as RecordData,
  source_url: row.source_url,
  evidence: row.evidence,
  observed_at: row.observed_at,
  verified_at: row.verified_at,
  updated_at: row.updated_at,
  parent_id: row.parent_id,
});

const COLUMNS = 'id, kind, status, data_json, source_url, evidence, observed_at, verified_at, updated_at, parent_id';

const hashOf = async (value: unknown): Promise<string> => (await sha256Hex(JSON.stringify(value))).slice(0, 16);

/** What one rebuild changed, for the index merge. */
export interface Rebuilt {
  id: string;
  entry: IndexEntry | null;
  dishesChanged: boolean;
}

/**
 * Rebuilds one place's page and everything it contributes. A place that is not public any more
 * (rejected, merged) loses its page, its index line, its dishes and its sources.
 */
export async function rebuildPlace(db: D1Database, placeId: string, now: Date): Promise<Rebuilt> {
  const at = now.toISOString();
  const [placeRows, childRows, stored] = await db.batch([
    db.prepare(`SELECT ${COLUMNS} FROM records WHERE id = ? AND kind = 'place'`).bind(placeId),
    db.prepare(`SELECT ${COLUMNS} FROM records INDEXED BY records_root WHERE root_id = ? AND id != ? AND status IN ('pending', 'verified', 'stale')`).bind(placeId, placeId),
    db.prepare('SELECT dishes_hash, sources_hash FROM place_docs WHERE place_id = ?').bind(placeId),
  ]);
  const placeRow = (placeRows?.results[0] as RecordRow | undefined) ?? null;
  const previous = (stored?.results[0] as { dishes_hash: string | null; sources_hash: string | null } | undefined) ?? null;
  const clearDirty = db.prepare('DELETE FROM dirty_places WHERE place_id = ? AND since <= ?').bind(placeId, at);

  if (!placeRow || (placeRow.status !== 'verified' && placeRow.status !== 'stale')) {
    const { results: oldDishes } = await db.prepare('SELECT DISTINCT dish_key FROM dish_places WHERE place_id = ?').bind(placeId).all<{ dish_key: string }>();
    await db.batch([
      db.prepare('DELETE FROM place_docs WHERE place_id = ?').bind(placeId),
      db.prepare('DELETE FROM dish_places WHERE place_id = ?').bind(placeId),
      db.prepare('DELETE FROM source_entries WHERE place_id = ?').bind(placeId),
      db
        .prepare(`UPDATE dishes SET places = max(0, places - 1), updated_at = ? WHERE dish_key IN (SELECT value FROM json_each(?))`)
        .bind(at, JSON.stringify(oldDishes.map((dish) => dish.dish_key))),
      doneWork(db, 'menu', placeId, now),
      doneWork(db, 'reviews', placeId, now),
      clearDirty,
    ]);
    return { id: placeId, entry: null, dishesChanged: oldDishes.length > 0 };
  }

  const place = toDoc(placeRow);
  const brandId = typeof place.data.brand === 'string' ? place.data.brand : null;
  const children = ((childRows?.results ?? []) as RecordRow[]).map(toDoc);
  const menuIds = children.filter((child) => child.kind === 'menu').map((child) => child.id);
  const [brandRows, brandMenuRows, historyRows] = await db.batch([
    db.prepare(`SELECT ${COLUMNS} FROM records WHERE id = ?`).bind(brandId),
    db.prepare(`SELECT ${COLUMNS} FROM records INDEXED BY records_children WHERE parent_id = ? AND status IN ('verified', 'stale') AND kind = 'menu'`).bind(brandId),
    db
      .prepare(
        `SELECT v.record_id, v.kind, v.action, v.actor, v.created_at, t.label FROM revisions v INDEXED BY revisions_record LEFT JOIN tokens t ON t.id = v.actor
         WHERE v.record_id IN (SELECT value FROM json_each(?)) ORDER BY v.id DESC LIMIT 60`,
      )
      .bind(JSON.stringify([placeId, ...menuIds])),
  ]);
  const brand = ((brandRows?.results[0] as RecordRow | undefined) && toDoc(brandRows!.results[0] as RecordRow)) || null;
  const history: DocHistoryEntry[] = ((historyRows?.results ?? []) as { record_id: string; kind: string; action: string; actor: string; created_at: string; label: string | null }[]).map(
    (entry) => ({ at: entry.created_at, action: entry.action, kind: entry.kind, record_id: entry.record_id, by: actorLabel(entry.actor, entry.label) }),
  );
  const built = buildPlace({ place, brand, children, brandMenus: ((brandMenuRows?.results ?? []) as RecordRow[]).map(toDoc), history });

  const docJson = JSON.stringify(built.doc);
  const dishesHash = await hashOf(built.dishes);
  const sourcesHash = await hashOf(built.sources);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO place_docs (place_id, doc_json, entry_json, etag, dishes_hash, sources_hash, built_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (place_id) DO UPDATE SET doc_json = excluded.doc_json, entry_json = excluded.entry_json, etag = excluded.etag,
           dishes_hash = excluded.dishes_hash, sources_hash = excluded.sources_hash, built_at = excluded.built_at`,
      )
      .bind(placeId, docJson, JSON.stringify(built.entry), await hashOf(docJson), dishesHash, sourcesHash, at),
  ];

  let dishesChanged = false;
  if (previous?.dishes_hash !== dishesHash) {
    dishesChanged = true;
    const { results: oldDishes } = await db.prepare('SELECT DISTINCT dish_key FROM dish_places WHERE place_id = ?').bind(placeId).all<{ dish_key: string }>();
    const before = new Set(oldDishes.map((dish) => dish.dish_key));
    const after = new Set(built.dishes.map((dish) => dish.dish_key));
    const added = built.dishes.filter((dish) => !before.has(dish.dish_key));
    const removed = [...before].filter((key) => !after.has(key));
    statements.push(
      db.prepare('DELETE FROM dish_places WHERE place_id = ?').bind(placeId),
      db
        .prepare(
          `INSERT INTO dish_places (dish_key, place_id, via, entry_json)
           SELECT json_extract(value, '$.dish_key'), ?, json_extract(value, '$.via'), json_extract(value, '$.entry') FROM json_each(?)`,
        )
        .bind(placeId, JSON.stringify(built.dishes)),
      db
        .prepare(
          `INSERT INTO dishes (dish_key, name_zh, name_en, places, updated_at)
           SELECT json_extract(value, '$.dish_key'), json_extract(value, '$.entry.name_zh'), json_extract(value, '$.entry.name_en'), 1, ?1 FROM json_each(?2) WHERE true
           ON CONFLICT (dish_key) DO UPDATE SET places = dishes.places + 1, name_zh = coalesce(dishes.name_zh, excluded.name_zh),
             name_en = coalesce(dishes.name_en, excluded.name_en), updated_at = excluded.updated_at`,
        )
        .bind(at, JSON.stringify(added)),
      db
        .prepare(`UPDATE dishes SET places = max(0, places - 1), updated_at = ? WHERE dish_key IN (SELECT value FROM json_each(?))`)
        .bind(at, JSON.stringify(removed)),
    );
  }
  if (previous?.sources_hash !== sourcesHash) {
    statements.push(
      db.prepare('DELETE FROM source_entries WHERE place_id = ?').bind(placeId),
      db
        .prepare(
          `INSERT INTO source_entries (review_id, place_id, source_key, author_key, published_on, entry_json)
           SELECT json_extract(value, '$.review_id'), ?, json_extract(value, '$.source_key'), json_extract(value, '$.author_key'),
             json_extract(value, '$.published_on'), json_extract(value, '$.entry') FROM json_each(?)`,
        )
        .bind(placeId, JSON.stringify(built.sources)),
    );
  }
  const name = built.entry.n ?? built.entry.z;
  statements.push(
    built.wants.menu ? wantWork(db, 'menu', placeId, 5, { place: placeId, name, postcode: place.data.postcode }, now) : doneWork(db, 'menu', placeId, now),
    built.wants.reviews
      ? wantWork(db, 'reviews', placeId, 6 - Math.min(6, built.wants.reviews.en + built.wants.reviews.zh), { place: placeId, name, postcode: place.data.postcode, ...built.wants.reviews }, now)
      : doneWork(db, 'reviews', placeId, now),
    clearDirty,
  );
  await db.batch(statements);
  return { id: placeId, entry: built.entry, dishesChanged };
}

/**
 * The places whose pages changed since the last look, marked dirty; brands mark their branches.
 * Every change to a record writes a revision (invariant 5), and revision ids only grow, so the
 * newest revision id seen is the watermark: nothing that changed is missed, nothing is read twice.
 */
async function markDirty(db: D1Database, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const [head, latest] = await db.batch([
    db.prepare(`SELECT watermark FROM dataset_heads WHERE name = 'docs'`),
    db.prepare('SELECT MAX(id) AS id FROM revisions'),
  ]);
  const watermark = Number((head?.results[0] as { watermark: string | null } | undefined)?.watermark ?? 0);
  const newest = Number((latest?.results[0] as { id: number | null } | undefined)?.id ?? 0);
  if (newest <= watermark) return false;
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO dirty_places (place_id, since)
         SELECT DISTINCT r.root_id, ?1 FROM revisions v JOIN records r ON r.id = v.record_id
         WHERE v.id > ?2 AND v.id <= ?3 AND r.root_id IS NOT NULL`,
      )
      .bind(at, watermark, newest),
    db
      .prepare(
        `INSERT OR IGNORE INTO dirty_places (place_id, since)
         SELECT p.id, ?1 FROM records p INDEXED BY records_ref
         WHERE p.kind = 'place' AND p.ref_id IN (
           SELECT DISTINCT CASE WHEN r.kind = 'brand' THEN r.id ELSE r.parent_id END
           FROM revisions v JOIN records r ON r.id = v.record_id
           WHERE v.id > ?2 AND v.id <= ?3 AND (r.kind = 'brand' OR (r.kind = 'menu' AND r.root_id IS NULL)))`,
      )
      .bind(at, watermark, newest),
    db
      .prepare(
        `INSERT INTO dataset_heads (name, watermark, count, built_at) VALUES ('docs', ?1, 0, ?2)
         ON CONFLICT (name) DO UPDATE SET watermark = excluded.watermark, built_at = excluded.built_at`,
      )
      .bind(String(newest), at),
  ]);
  return true;
}

/** The index with these places' lines replaced (or taken out when null). */
async function mergeIndex(db: D1Database, rebuilt: readonly Rebuilt[], now: Date): Promise<number> {
  const json = await datasetJson(db, 'index');
  if (json === null) return buildIndex(db, now);
  const entries = new Map((JSON.parse(json) as IndexEntry[]).map((entry) => [entry.id, entry]));
  for (const change of rebuilt) {
    if (change.entry) entries.set(change.id, change.entry);
    else entries.delete(change.id);
  }
  const list = [...entries.values()];
  await db.batch(storeDataset(db, 'index', JSON.stringify(list), list.length, now.toISOString(), false));
  return list.length;
}

/** The index built whole from every page's line. */
export async function buildIndex(db: D1Database, now: Date): Promise<number> {
  const { results } = await db.prepare('SELECT entry_json FROM place_docs WHERE entry_json IS NOT NULL').all<{ entry_json: string }>();
  const list = results.map((row) => JSON.parse(row.entry_json) as IndexEntry);
  await db.batch(storeDataset(db, 'index', JSON.stringify(list), list.length, now.toISOString(), true));
  return list.length;
}

/** The dish catalog and the illustration list, from the dishes table. */
export async function buildDishes(db: D1Database, now: Date): Promise<number> {
  const { results } = await db
    .prepare('SELECT dish_key, name_zh, name_en, places, illustration_id FROM dishes WHERE places > 0 OR illustration_id IS NOT NULL')
    .all<{ dish_key: string; name_zh: string | null; name_en: string | null; places: number; illustration_id: string | null }>();
  const catalog = results.filter((dish) => dish.places > 0).map((dish) => [dish.dish_key, dish.name_zh, dish.name_en, dish.places]);
  const illustrations = Object.fromEntries(results.filter((dish) => dish.illustration_id).map((dish) => [dish.dish_key, dish.illustration_id]));
  const at = now.toISOString();
  await db.batch([
    ...storeDataset(db, 'dishes', JSON.stringify(catalog), catalog.length, at, true),
    ...storeDataset(db, 'illustrations', JSON.stringify(illustrations), Object.keys(illustrations).length, at, true),
  ]);
  return catalog.length;
}

/** The dishes table changed since the catalog was built. */
async function dishesMoved(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare(`SELECT (SELECT MAX(updated_at) FROM dishes) AS changed, (SELECT built_at FROM dataset_heads WHERE name = 'dishes') AS built`)
    .first<{ changed: string | null; built: string | null }>();
  return Boolean(row?.changed && (!row.built || row.changed >= row.built));
}

/** Every place's dish count again from dish_places: mends any drift, once a day. */
async function recountDishes(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE dishes SET places = (SELECT COUNT(DISTINCT place_id) FROM dish_places WHERE dish_places.dish_key = dishes.dish_key), updated_at = ?
       WHERE places != (SELECT COUNT(DISTINCT place_id) FROM dish_places WHERE dish_places.dish_key = dishes.dish_key)`,
    )
    .bind(now.toISOString())
    .run();
}

export interface RefreshReport {
  rebuilt: number;
  indexed: number | null;
  dishes: number | null;
}

/**
 * The cron's step: mark what changed, rebuild up to `max` dirty places, merge their lines into the
 * index, and rebuild the dish catalog when dishes moved (at most every 15 minutes, or whole once a
 * day with the index).
 */
export async function refreshDocs(db: D1Database, now: Date, options: { max?: number; whole?: boolean } = {}): Promise<RefreshReport> {
  await markDirty(db, now);
  const { results: dirty } = await db
    .prepare('SELECT place_id FROM dirty_places INDEXED BY dirty_places_since ORDER BY since LIMIT ?')
    .bind(options.max ?? REBUILD_MAX)
    .all<{ place_id: string }>();
  const rebuilt: Rebuilt[] = [];
  for (const { place_id } of dirty) rebuilt.push(await rebuildPlace(db, place_id, now));

  let indexed: number | null = null;
  if (options.whole) {
    await recountDishes(db, now);
    indexed = await buildIndex(db, now);
  } else if (rebuilt.length > 0) indexed = await mergeIndex(db, rebuilt, now);

  let dishes: number | null = null;
  const head = await db.prepare(`SELECT built_at FROM dataset_heads WHERE name = 'dishes'`).first<{ built_at: string }>();
  const due = !head || options.whole || now.getTime() - Date.parse(head.built_at) >= 15 * 60 * 1000;
  if (due && (options.whole || !head || (await dishesMoved(db)))) dishes = await buildDishes(db, now);
  return { rebuilt: rebuilt.length, indexed, dishes };
}

/** Marks places dirty and rebuilds them at once: an admin change readers should see now. */
export async function rebuildNow(db: D1Database, placeIds: readonly string[], now: Date): Promise<void> {
  const rebuilt: Rebuilt[] = [];
  for (const id of new Set(placeIds)) rebuilt.push(await rebuildPlace(db, id, now));
  if (rebuilt.length > 0) await mergeIndex(db, rebuilt, now);
  if (rebuilt.some((change) => change.dishesChanged)) await buildDishes(db, now);
}

/* ───────── reads ───────── */

/** A place's page document, or null when it has none (not public, or never built). */
export async function placeDoc(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare('SELECT doc_json FROM place_docs WHERE place_id = ?').bind(id).first<{ doc_json: string }>();
  return row?.doc_json ?? null;
}

/** Where a dish can be eaten: every place serving it or mentioned with it, with what each says. */
export async function dishPlaces(db: D1Database, dishKey: string): Promise<{ dish: string; places: { place_id: string; via: string; entry: unknown }[] }> {
  const { results } = await db
    .prepare('SELECT place_id, via, entry_json FROM dish_places WHERE dish_key = ? ORDER BY via, place_id LIMIT 500')
    .bind(dishKey)
    .all<{ place_id: string; via: string; entry_json: string }>();
  return { dish: dishKey, places: results.map((row) => ({ place_id: row.place_id, via: row.via, entry: JSON.parse(row.entry_json) })) };
}

/** One source's (or one author's) excerpts, newest first, a page at a time. */
export async function sourcePage(db: D1Database, by: 'source' | 'author', key: string, page: number): Promise<{ key: string; total: number; page: number; entries: unknown[] }> {
  const size = 100;
  const column = by === 'source' ? 'source_key' : 'author_key';
  const index = by === 'source' ? 'source_entries_source' : 'source_entries_author';
  const [count, rows] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM source_entries INDEXED BY ${index} WHERE ${column} = ?`).bind(key),
    db
      .prepare(`SELECT review_id, entry_json FROM source_entries INDEXED BY ${index} WHERE ${column} = ? ORDER BY published_on DESC LIMIT ? OFFSET ?`)
      .bind(key, size, (page - 1) * size),
  ]);
  return {
    key,
    total: (count?.results[0] as { n: number } | undefined)?.n ?? 0,
    page,
    entries: ((rows?.results ?? []) as { review_id: string; entry_json: string }[]).map((row) => ({ id: row.review_id, ...(JSON.parse(row.entry_json) as object) })),
  };
}
