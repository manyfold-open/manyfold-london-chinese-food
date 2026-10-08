import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndexEntry, PlaceDoc } from '../src/shared/place-doc';
import { join, menu, place, review, submit, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const decide = (w: World, id: string, status: string, extra: Record<string, unknown> = {}) =>
  w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status, ...extra } });

const cron = (w: World) => w.json('/api/admin/maintenance', { method: 'POST', admin: true });

/** A verified place with two reviews (one in Chinese) and a menu, all verified, pages built. */
async function publicPlace(w: World) {
  const token = await join(w);
  const { results } = await submit(w, token, [
    place(),
    review('#0', { dishes: [{ name: 'biang biang noodles', canonical: '油泼面' }, { name: 'roujiamo', canonical: '肉夹馍' }] }),
    review('#0', { language: 'zh', publication: '小红书', source_type: 'social', published_on: '2025-11' }, { source_url: 'https://example.com/xhs', evidence: '油泼面很香，辣子味道正宗，排了二十分钟队。' }),
    menu('#0', [
      { section: '面 Noodles', name_zh: '油泼面', name_en: 'Biang biang noodles', price_pence: 1280, canonical: '油泼面' },
      { section: '面 Noodles', name_zh: '臊子面', price_pence: 1150 },
      { section: '小吃 Snacks', name_en: 'Cucumber salad', price_pence: 500 },
    ]),
  ]);
  for (const result of results) await decide(w, result.id!, 'verified');
  await cron(w);
  return { token, placeId: results[0]!.id!, reviewIds: [results[1]!.id!, results[2]!.id!], menuId: results[3]!.id! };
}

describe('a place page', () => {
  it('holds the place, its menu by section, its reviews newest first, and what reviews mention', async () => {
    const w = world();
    const { placeId, reviewIds } = await publicPlace(w);
    const { status, body } = await w.json<PlaceDoc>(`/api/places/${placeId}`);
    expect(status).toBe(200);
    expect(body.slug).toBe('example-noodle-house');
    expect(body.place).toMatchObject({ name_en: 'Example Noodle House', borough: 'Westminster' });
    expect(body.menus[0]!.sections.map((section) => [section.name, section.items.length])).toEqual([['面 Noodles', 2], ['小吃 Snacks', 1]]);
    expect(body.menus[0]!.sections[0]!.items[0]).toMatchObject({ dish: '油泼面', price_pence: 1280, mentions: [reviewIds[0]] });
    expect(body.reviews.map((entry) => entry.id)).toEqual([reviewIds[0], reviewIds[1]]);
    expect(body.reviews[1]).toMatchObject({ language: 'zh', publication: '小红书', source_key: '小红书' });
    expect(body.mentioned).toEqual([{ dish: '肉夹馍', name: 'roujiamo', reviews: [reviewIds[0]] }]);
  });

  it('carries no score, no rating and nothing to rank by', async () => {
    const w = world();
    const { placeId } = await publicPlace(w);
    const text = await (await w.call(`/api/places/${placeId}`)).text();
    expect(text).not.toMatch(/"(rating|score|stars|aggregate|sentiment|rank)[a-z_]*"/i);
    const doc = JSON.parse(text) as PlaceDoc;
    expect(Object.keys(doc).sort()).toEqual(['brand', 'history', 'id', 'mentioned', 'menus', 'pending', 'photos', 'place', 'reviews', 'slug', 'source', 'status', 'updated_at']);
  });

  it('is not served for a place that is not public', async () => {
    const w = world();
    const token = await join(w);
    const { results } = await submit(w, token, [place()]);
    await cron(w);
    expect((await w.call(`/api/places/${results[0]!.id}`)).status).toBe(404);
  });
});

describe('the index, dishes and sources', () => {
  it('lists the place with what there is to read about it', async () => {
    const w = world();
    const { placeId } = await publicPlace(w);
    const { body } = await w.json<{ places: IndexEntry[] }>('/api/index');
    expect(body.places).toEqual([
      expect.objectContaining({ id: placeId, s: 'example-noodle-house', n: 'Example Noodle House', z: '示例面馆', c: 'restaurant', b: 'E09000033', pc: 'W1D 6JW', r: 2, m: 3, p: 0, l: '2026-05', t: 'open' }),
    ]);
  });

  it('answers where a dish can be eaten, by its standard name in any spelling', async () => {
    const w = world();
    const { placeId } = await publicPlace(w);
    const catalog = await w.json<{ dishes: [string, string | null, string | null, number][] }>('/api/dishes');
    expect(catalog.body.dishes.map((dish) => dish[0])).toContain('油泼面');
    const dish = await w.json<{ places: { place_id: string; via: string }[] }>(`/api/dishes/${encodeURIComponent('油泼面')}`);
    expect(dish.body.places).toEqual([expect.objectContaining({ place_id: placeId, via: 'menu' })]);
    const mentioned = await w.json<{ places: { via: string }[] }>(`/api/dishes/${encodeURIComponent('肉夹馍')}`);
    expect(mentioned.body.places.map((entry) => entry.via)).toEqual(['review']);
  });

  it("lists a source's excerpts across places", async () => {
    const w = world();
    await publicPlace(w);
    const { body } = await w.json<{ total: number; entries: { publication: string; place_en: string }[] }>('/api/sources/example-food-blog');
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({ publication: 'Example Food Blog', place_en: 'Example Noodle House' });
  });

  it('takes a rejected place out of the index, the dishes and the sources', async () => {
    const w = world();
    const { placeId } = await publicPlace(w);
    await decide(w, placeId, 'rejected', { reason: 'A ghost kitchen with no address.' });
    expect((await w.json<{ places: IndexEntry[] }>('/api/index')).body.places).toEqual([]);
    expect((await w.json<{ places: unknown[] }>(`/api/dishes/${encodeURIComponent('油泼面')}`)).body.places).toEqual([]);
    expect((await w.json<{ total: number }>('/api/sources/example-food-blog')).body.total).toBe(0);
    expect((await w.call(`/api/places/${placeId}`)).status).toBe(404);
  });

  it("shows a brand's menu on every branch", async () => {
    const w = world();
    const token = await join(w);
    const { results } = await submit(w, token, [
      { kind: 'brand', data: { name_en: 'Example Tea', website: 'https://example.com/', category: 'tea-drinks' }, source_url: 'https://example.com/about', evidence: 'Example Tea has shops all over London.', observed_at: new Date(Date.now() - 60_000).toISOString() },
      place({ name_en: 'Example Tea Soho', category: 'tea-drinks', brand: '#0' }),
      place({ name_en: 'Example Tea Islington', category: 'tea-drinks', brand: '#0', postcode: 'N7 8AB' }),
      menu('#0', [{ name_en: 'Brown sugar boba milk', price_pence: 550 }], { menu: 'drinks' }),
    ]);
    for (const result of results) await decide(w, result.id!, 'verified');
    await cron(w);
    for (const branch of [results[1]!.id!, results[2]!.id!]) {
      const doc = (await w.json<PlaceDoc>(`/api/places/${branch}`)).body;
      expect(doc.brand).toMatchObject({ id: results[0]!.id, name_en: 'Example Tea' });
      expect(doc.menus).toEqual([expect.objectContaining({ owner: 'brand', menu: 'drinks' })]);
    }
  });
});

describe('the work feed from pages', () => {
  it('asks for a menu and reviews for a place without them, and stops once it has them', async () => {
    const w = world();
    const token = await join(w);
    const { results } = await submit(w, token, [place()]);
    await decide(w, results[0]!.id!, 'verified');
    await cron(w);
    const items = await w.env.DB.prepare(`SELECT type, status FROM work_items WHERE subject = ? ORDER BY type`).bind(results[0]!.id).all<{ type: string; status: string }>();
    expect(items.results).toEqual([{ type: 'menu', status: 'open' }, { type: 'reviews', status: 'open' }]);
    const added = await submit(w, token, [menu(results[0]!.id!)]);
    await decide(w, added.results[0]!.id!, 'verified');
    await cron(w);
    const menuItem = await w.env.DB.prepare(`SELECT status FROM work_items WHERE subject = ? AND type = 'menu'`).bind(results[0]!.id).first<{ status: string }>();
    expect(menuItem!.status).toBe('done');
  });
});
