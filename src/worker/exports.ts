/**
 * The open data (AGENTS.md, invariant 14): every public place and every public menu, under
 * CC BY 4.0, written from the stored place documents (invariant 15) a page at a time, so an export
 * reads one row per place and holds a page in memory, not the whole set.
 *
 *   places.csv, places.json   one entry per place: names, kind, address, borough, contacts, brand
 *   menus.jsonl.gz            one line per menu, a brand's menu once for all its branches
 *
 * Review excerpts stay out: they remain their authors', quoted here with a link, and are not ours
 * to license. Photos stay out too: each is its uploader's, credited on its page.
 */

import type { DocMenu, PlaceDoc } from '../shared/place-doc';

export const LICENSE = 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)';
export const ATTRIBUTION =
  '伦敦中餐 · London Chinese Food, app.manyfold.ai/london-chinese-food. Coordinates and boroughs from postcodes.io: contains OS data © Crown copyright and database right, Royal Mail data © Royal Mail copyright and database right, and National Statistics data © Crown copyright and database right, under the Open Government Licence v3.0.';

const PAGE = 100;

/** Every public place's document in id order, PAGE rows a read. */
async function* placeDocs(db: D1Database): AsyncGenerator<PlaceDoc> {
  let after = '';
  for (;;) {
    const { results } = await db
      .prepare('SELECT place_id, doc_json FROM place_docs WHERE place_id > ? ORDER BY place_id LIMIT ?')
      .bind(after, PAGE)
      .all<{ place_id: string; doc_json: string }>();
    for (const row of results) yield JSON.parse(row.doc_json) as PlaceDoc;
    if (results.length < PAGE) return;
    after = results[results.length - 1]!.place_id;
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const number = (value: unknown): number | null => (typeof value === 'number' ? value : null);

export interface ExportPlace {
  id: string;
  name_en: string | null;
  name_zh: string | null;
  category: string;
  cuisines: string[];
  address: string | null;
  postcode: string | null;
  borough: string | null;
  borough_code: string | null;
  outcode: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  phone: string | null;
  trading: string;
  opened_on: string | null;
  closed_on: string | null;
  brand_id: string | null;
  brand_name_en: string | null;
  brand_name_zh: string | null;
  status: 'verified' | 'stale';
  source_url: string;
  observed_at: string;
  verified_at: string | null;
  page_url: string;
}

export function exportPlace(doc: PlaceDoc, site: string): ExportPlace {
  const place = doc.place;
  return {
    id: doc.id,
    name_en: text(place.name_en),
    name_zh: text(place.name_zh),
    category: String(place.category),
    cuisines: Array.isArray(place.cuisines) ? place.cuisines.map(String) : [],
    address: text(place.address),
    postcode: text(place.postcode),
    borough: text(place.borough),
    borough_code: text(place.borough_code),
    outcode: text(place.outcode),
    lat: number(place.lat),
    lng: number(place.lng),
    website: text(place.website),
    phone: text(place.phone),
    trading: text(place.trading) ?? 'open',
    opened_on: text(place.opened_on),
    closed_on: text(place.closed_on),
    brand_id: doc.brand?.id ?? null,
    brand_name_en: doc.brand?.name_en ?? null,
    brand_name_zh: doc.brand?.name_zh ?? null,
    status: doc.status,
    source_url: doc.source.url,
    observed_at: doc.source.observed_at,
    verified_at: doc.source.verified_at,
    page_url: `${site}/en/place/${doc.id}${doc.slug ? `/${doc.slug}` : ''}`,
  };
}

export function exportMenu(doc: PlaceDoc, menu: DocMenu) {
  return {
    id: menu.id,
    owner: menu.owner === 'brand' && doc.brand ? { kind: 'brand', id: doc.brand.id } : { kind: 'place', id: doc.id },
    menu: menu.menu,
    title: menu.title,
    source_kind: menu.source_kind,
    source_url: menu.source_url,
    observed_at: menu.observed_at,
    verified_at: menu.verified_at,
    stale: menu.stale,
    items: menu.sections.flatMap((section) =>
      section.items.map((item) => ({
        section: section.name,
        name_zh: item.name_zh ?? null,
        name_en: item.name_en ?? null,
        price_pence: item.price_pence ?? null,
        price_note: item.price_note ?? null,
        description: item.description ?? null,
        dietary: item.dietary ?? [],
        spicy: item.spicy ?? null,
        dish: item.dish,
      })),
    ),
  };
}

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

const PLACE_COLUMNS: readonly (keyof ExportPlace)[] = [
  'id', 'name_en', 'name_zh', 'category', 'cuisines', 'address', 'postcode', 'borough', 'borough_code', 'outcode', 'lat', 'lng',
  'website', 'phone', 'trading', 'opened_on', 'closed_on', 'brand_id', 'brand_name_en', 'brand_name_zh', 'status', 'source_url',
  'observed_at', 'verified_at', 'page_url',
];

/** A body written as it is read: each chunk the generator yields, encoded. */
function streamOf(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

export function placesCsv(db: D1Database, site: string): ReadableStream<Uint8Array> {
  return streamOf(
    (async function* () {
      // A byte-order mark, so spreadsheets read the Chinese names as UTF-8.
      yield `\uFEFF${PLACE_COLUMNS.join(',')}\r\n`;
      for await (const doc of placeDocs(db)) {
        const place = exportPlace(doc, site);
        yield `${PLACE_COLUMNS.map((column) => csvCell(place[column])).join(',')}\r\n`;
      }
    })(),
  );
}

export function placesJson(db: D1Database, site: string, now: Date): ReadableStream<Uint8Array> {
  return streamOf(
    (async function* () {
      const head = { name: 'London Chinese Food: places', license: LICENSE, attribution: ATTRIBUTION, source: site, exported_at: now.toISOString() };
      yield `${JSON.stringify(head).slice(0, -1)},"places":[`;
      let first = true;
      for await (const doc of placeDocs(db)) {
        yield `${first ? '' : ','}\n${JSON.stringify(exportPlace(doc, site))}`;
        first = false;
      }
      yield '\n]}\n';
    })(),
  );
}

/** Every menu as a JSON line, gzipped. The first line says what the file is and its license. */
export function menusJsonl(db: D1Database, site: string, now: Date): ReadableStream<Uint8Array> {
  return streamOf(
    (async function* () {
      yield `${JSON.stringify({ name: 'London Chinese Food: menus', license: LICENSE, attribution: ATTRIBUTION, source: site, exported_at: now.toISOString() })}\n`;
      const seen = new Set<string>();
      for await (const doc of placeDocs(db)) {
        for (const menu of doc.menus) {
          if (seen.has(menu.id)) continue;
          seen.add(menu.id);
          yield `${JSON.stringify(exportMenu(doc, menu))}\n`;
        }
      }
    })(),
  ).pipeThrough(new CompressionStream('gzip'));
}
