// D1 counts every row a statement steps through, index entries included. These tests run the
// Worker's busiest statements on workerd's own D1 (workerd.mjs), which counts rows read as
// production bills them, at production's sizes, and hold each to a budget (AGENTS.md, invariant
// 15): a reader costs a row or two, and agents' calls and the cron read what they need through an
// index, never a table's history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dishPlaces, placeDoc, rebuildPlace, refreshDocs, sourcePage, datasetJson, buildIndex } from '../src/worker/docs';
import { leaseTasks } from '../src/worker/maintainer';
import { maintain } from '../src/worker/maintenance';
import { SCHEMA, schemaStatements } from '../src/worker/schema';
import { standing, type Token } from '../src/worker/tokens';
import { handOut } from '../src/worker/work';
import { openWorkerdD1 } from './workerd.mjs';

let raw: D1Database;
let db: D1Database;
let close: () => Promise<void>;
let rowsRead = 0;

const add = <T extends D1Result>(result: T): T => {
  rowsRead += result.meta.rows_read ?? 0;
  return result;
};

/** The binding, adding up D1's own count of rows read for every statement run through it. */
function counting(binding: D1Database): D1Database {
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
        if (property === 'all') return async () => add(await target.all());
        if (property === 'run') return async () => add(await target.run());
        if (property === 'first') {
          return async (column?: string) => {
            const row = add(await target.all<Record<string, unknown>>()).results[0];
            return row === undefined ? null : column === undefined ? row : row[column];
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    real.set(proxy, statement);
    return proxy;
  };
  return new Proxy(binding, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => (await target.batch(statements.map((statement) => real.get(statement) ?? statement))).map(add);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function reads<T>(work: () => Promise<T>): Promise<{ value: T; rows: number }> {
  rowsRead = 0;
  const value = await work();
  return { value, rows: rowsRead };
}

const NOW = new Date('2026-10-08T12:00:00Z');
const AT = '2026-09-01T00:00:00Z';
const PLACES = 3000;
const REVIEWS = 30000;
const BIG = 'rec_place_00001';

const collector: Token = { id: 'tok_busy', role: 'collector', label: 'busy', kinds: ['*'], status: 'active', pendingCap: null, dailyTaskLimit: null, expiresAt: null, createdAt: AT };
const keeper: Token = { id: 'tok_keeper', role: 'maintainer', label: 'keeper', kinds: ['*'], status: 'active', pendingCap: null, dailyTaskLimit: 10000, expiresAt: null, createdAt: AT };

const seq = (count: number) => `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${count})`;

beforeAll(async () => {
  ({ db: raw, close } = await openWorkerdD1());
  await raw.batch(schemaStatements(SCHEMA).map((statement) => raw.prepare(statement)));
  const run = (sql: string) => raw.prepare(sql).run();
  await run(`${seq(PLACES)} INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
    SELECT printf('rec_place_%05d', i), 'place', printf('rec_place_%05d', i), 'W1D 6JW|place ' || i, 'verified',
      json_object('name_en', 'Place ' || i, 'category', 'restaurant', 'address', i || ' Street', 'postcode', 'W1D 6JW', 'trading', 'open', 'cuisines', json_array('cantonese')),
      'https://example.com/' || i, 'quote', '${AT}', 'tok_other', '${AT}', '${AT}', '${AT}' FROM n`);
  // Reviews by the busy collector, spread over the places; the big place gets 50.
  await run(`${seq(REVIEWS)} INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
    SELECT printf('rec_review_%06d', i), 'review', printf('rec_place_%05d', CASE WHEN i <= 50 THEN 1 ELSE 2 + i % ${PLACES - 1} END),
      printf('rec_place_%05d', CASE WHEN i <= 50 THEN 1 ELSE 2 + i % ${PLACES - 1} END), 'review|' || i, 'verified',
      json_object('place', 'p', 'published_on', '2026-0' || (1 + i % 9), 'publication', CASE WHEN i % 10 = 0 THEN 'The Guardian' ELSE 'Blog ' || (i % 500) END,
        'source_type', 'blog', 'language', CASE WHEN i % 2 = 0 THEN 'en' ELSE 'zh' END, 'dishes', json_array(json_object('name', 'har gow', 'canonical', '虾饺'))),
      'https://example.com/r/' || i, 'An excerpt about the food, number ' || i || '.', '${AT}', 'tok_busy', '${AT}', '${AT}', '${AT}' FROM n`);
  // The big place's menu: 400 items.
  await run(`INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
    SELECT 'rec_menu_big', 'menu', '${BIG}', '${BIG}', '${BIG}|main|', 'verified',
      json_object('owner', '${BIG}', 'menu', 'main', 'source_kind', 'website', 'items',
        (${seq(400)} SELECT json_group_array(json_object('section', 'S' || (i / 40), 'name_zh', '菜' || i, 'price_pence', 500 + i)) FROM n)),
      'https://example.com/menu', 'quote', '${AT}', 'tok_other', '${AT}', '${AT}', '${AT}'`);
  await run(`${seq(30)} INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
    SELECT printf('rec_photo_%03d', i), 'photo', '${BIG}', '${BIG}', printf('rec_photo_%03d', i), 'verified',
      json_object('place', '${BIG}', 'subject', 'dish', 'dish_name', '菜' || i, 'width', 1600, 'height', 1200, 'license', 'CC-BY-4.0'), '', '', '${AT}', 'visitor', '${AT}', '${AT}', '${AT}' FROM n`);
  // A queue as it will look: years of done tasks, a backlog blocked on pending places, a few open.
  await run(`${seq(40000)} INSERT INTO tasks (id, record_id, record_kind, type, status, created_at, done_at)
    SELECT printf('tsk_done_%06d', i), printf('rec_review_%06d', 1 + i % ${REVIEWS}), 'review', 'verify', 'done', '${AT}', '${AT}' FROM n`);
  await run(`${seq(2000)} INSERT INTO tasks (id, record_id, record_kind, type, status, created_at)
    SELECT printf('tsk_blocked_%05d', i), printf('rec_review_%06d', i), 'review', 'verify', 'blocked', '2026-01-01T00:00:00Z' FROM n`);
  await run(`${seq(3)} INSERT INTO tasks (id, record_id, record_kind, type, status, created_at)
    SELECT printf('tsk_open_%d', i), printf('rec_place_%05d', 100 + i), 'place', 'verify', 'open', '2026-10-01T00:00:00Z' FROM n`);
  await run(`${seq(2500)} INSERT INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
    SELECT printf('wrk_lead_%05d', i), 'lead', 'osm:node/' || i, i % 3, '{}', 'open', '${AT}', '${AT}' FROM n`);
  await run(`INSERT INTO tokens (id, secret_hash, role, label, kinds_json, status, created_at) VALUES
    ('tok_busy', 'h1', 'collector', 'busy', '["*"]', 'active', '${AT}'), ('tok_keeper', 'h2', 'maintainer', 'keeper', '["*"]', 'active', '${AT}')`);
  await run(`${seq(200)} INSERT INTO revisions (record_id, kind, actor, action, after_json, created_at) SELECT 'rec_review_' || i, 'review', 'tok_keeper', 'verify', '{}', '${AT}' FROM n`);
  // Pages built once, as the cron would have.
  db = counting(raw);
  for (const id of [BIG, 'rec_place_00002', 'rec_place_00003']) await rebuildPlace(raw, id, NOW);
  await run(`${seq(PLACES)} INSERT OR IGNORE INTO place_docs (place_id, doc_json, entry_json, etag, built_at)
    SELECT printf('rec_place_%05d', i), '{}', json_object('id', printf('rec_place_%05d', i), 's', 'place-' || i, 'n', 'Place ' || i, 'z', NULL, 'c', 'restaurant', 'k', json_array('cantonese'),
      'b', 'E09000033', 'pc', 'W1D 6JW', 'o', 'W1D', 'la', 51.5, 'lo', -0.13, 't', 'open', 'br', NULL, 'r', 10, 'm', 0, 'p', 0, 'l', '2026-05', 'u', '${AT}'), 'e', '${AT}' FROM n`);
  await buildIndex(raw, NOW);
  await refreshDocs(raw, NOW, { max: 0 });
  await standing(raw, collector, 'review', NOW);
}, 120_000);

afterAll(async () => {
  await close?.();
});

describe('what a reader costs', () => {
  it('reads a place page in one row', async () => {
    const { value, rows } = await reads(() => placeDoc(db, BIG));
    expect(value).not.toBeNull();
    expect(rows).toBeLessThanOrEqual(1);
  });

  it('reads the index of every place in its parts', async () => {
    const { rows: parts } = await reads(() => raw.prepare(`SELECT COUNT(*) AS n FROM dataset_parts WHERE name = 'index'`).all());
    const { rows } = await reads(() => datasetJson(db, 'index'));
    expect(rows).toBeLessThanOrEqual(parts + 3);
  });

  it('answers where to eat a dish from its rows alone', async () => {
    const { value, rows } = await reads(() => dishPlaces(db, '虾饺'));
    expect(rows).toBeLessThanOrEqual(value.places.length + 4);
  });

  it("reads a source's page through its index", async () => {
    const { value, rows } = await reads(() => sourcePage(db, 'source', 'the-guardian', 1));
    expect(rows).toBeLessThanOrEqual(value.total + Math.min(value.total, 100) + 4);
  });
});

describe('what agents cost', () => {
  it("counts a busy collector's standing from its waiting records and one row", async () => {
    const { rows } = await reads(() => standing(db, collector, 'review', NOW));
    expect(rows).toBeLessThanOrEqual(12);
  });

  it('leases past 40,000 done and 2,000 blocked tasks without walking them', async () => {
    const { value, rows } = await reads(() => leaseTasks(db, keeper, { limit: 10, mediaUrl: (id) => id }, NOW));
    expect(value.tasks).toHaveLength(3);
    expect(rows).toBeLessThanOrEqual(40);
  });

  it('hands out work from 2,500 leads through the open-items index', async () => {
    // Each item handed costs its index entries and its row, never the queue behind it.
    const { value, rows } = await reads(() => handOut(db, collector, 'lead', 10, NOW));
    expect(value).toHaveLength(10);
    expect(rows).toBeLessThanOrEqual(8 * value.length + 10);
    const { rows: more } = await reads(() => handOut(db, keeper, 'lead', 2, NOW));
    expect(more).toBeLessThanOrEqual(8 * 2 + 10);
  });
});

describe('what the cron costs', () => {
  it('reads a handful of rows when nothing changed', async () => {
    const { value, rows } = await reads(() => refreshDocs(db, NOW));
    expect(value.rebuilt).toBe(0);
    expect(rows).toBeLessThanOrEqual(8);
  });

  it('keeps the housekeeping indexed', async () => {
    const { rows } = await reads(() => maintain(db, NOW));
    expect(rows).toBeLessThanOrEqual(12);
  });

  it('rebuilds the biggest page from that place’s rows, not the table', async () => {
    const { rows } = await reads(() => rebuildPlace(db, BIG, NOW));
    // 1 place, 81 children, a 400-item menu's dish rows, up to 60 history rows, and lookups.
    expect(rows).toBeLessThanOrEqual(81 + 400 + 60 + 60);
  });

  it('marks only what changed since the last revision seen', async () => {
    await raw.prepare(`INSERT INTO revisions (record_id, kind, actor, action, after_json, created_at) VALUES ('rec_review_000051', 'review', 'tok_keeper', 'verify', '{}', '${NOW.toISOString()}')`).run();
    const { value, rows } = await reads(() => refreshDocs(db, NOW, { max: 0 }));
    expect(value.rebuilt).toBe(0);
    expect(rows).toBeLessThanOrEqual(12);
  });
});
