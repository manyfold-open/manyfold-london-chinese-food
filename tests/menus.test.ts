import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeImage, join, lease, maintainer, menu, NOW_ISO, place, submit, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const decide = (w: World, id: string, status: string) =>
  w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status, ...(status === 'rejected' ? { reason: 'A blurred page.' } : {}) } });

async function publicPlace(w: World, overrides: Record<string, unknown> = {}) {
  const token = await join(w, 'place-scout', '198.51.100.30');
  const { results } = await submit(w, token, [place(overrides)]);
  await decide(w, results[0]!.id!, 'verified');
  return results[0]!.id!;
}

const sendLink = (w: World, placeId: string, url: string, extra: Record<string, unknown> = {}) =>
  w.json<{ status?: string; links?: number; error?: { code: string; message: string } }>(`/api/places/${placeId}/menu-links`, {
    method: 'POST',
    json: { url, 'cf-turnstile-response': 'human', ...extra },
  });

const pages = (count: number, extra: Record<string, string> = {}) => {
  const body = new FormData();
  for (let page = 0; page < count; page += 1) body.append('file', fakeImage('image/jpeg', 3000, 4000));
  for (const [name, value] of Object.entries({ subject: 'menu', license: 'CC-BY-4.0', 'cf-turnstile-response': 'human', ...extra })) body.set(name, value);
  return body;
};

const uploadPages = (w: World, placeId: string, body: FormData) =>
  w.json<{ id?: string; ids?: string[]; error?: { code: string; message: string } }>(`/api/places/${placeId}/photos`, { method: 'POST', body });

type Item = { id: string; subject: string; payload: Record<string, unknown> };
const work = async (w: World, token: string, type: string) => (await w.json<{ items: Item[] }>(`/api/work?type=${type}&limit=5`, { token })).body.items;

describe('a visitor sends a link to the menu', () => {
  it('turns away a failed check, an address that is not a link, a blocked site and a place that is not public', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    expect((await sendLink(w, placeId, 'https://example.com/menu.pdf', { 'cf-turnstile-response': 'robot' })).body.error!.code).toBe('turnstile_failed');
    expect((await sendLink(w, placeId, 'menu please')).body.error!.code).toBe('invalid_url');
    expect((await sendLink(w, placeId, 'javascript:alert(1)')).body.error!.code).toBe('invalid_url');
    await w.call('/api/admin/blocked-hosts', { method: 'PUT', admin: true, json: { hosts: ['blocked.example'] } });
    expect((await sendLink(w, placeId, 'https://www.blocked.example/menu')).body.error!.code).toBe('blocked_host');
    expect((await sendLink(w, 'rec_00000000000000000000000000', 'https://example.com/menu.pdf')).status).toBe(404);
  });

  it('gathers the links into one item for collectors, each once', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    expect((await sendLink(w, placeId, 'https://example.com/menu.pdf')).body).toEqual({ status: 'received', links: 1 });
    expect((await sendLink(w, placeId, 'https://example.com/dim-sum.jpg')).body.links).toBe(2);
    expect((await sendLink(w, placeId, 'https://example.com/menu.pdf')).body.links).toBe(2);
    const scout = await join(w, 'menu-scout', '198.51.100.31');
    const [item] = await work(w, scout, 'menu-link');
    expect(item).toMatchObject({ subject: placeId, payload: { place: placeId, links: ['https://example.com/dim-sum.jpg', 'https://example.com/menu.pdf'], menus: [] } });
  });

  it('is answered by a menu of that place, and dismissed for good when it holds nothing new', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const otherId = await publicPlace(w, { name_en: 'Other Noodle House', postcode: 'N7 8AB' });
    await sendLink(w, placeId, 'https://example.com/menu.pdf');
    await sendLink(w, otherId, 'https://example.com/other-menu.pdf');
    const scout = await join(w, 'menu-scout', '198.51.100.32');
    const items = await work(w, scout, 'menu-link');
    const mine = items.find((item) => item.subject === placeId)!;
    const theirs = items.find((item) => item.subject === otherId)!;
    expect((await submit(w, scout, [{ ...menu(otherId), work_item: mine.id }])).results[0]).toMatchObject({ status: 'invalid', errors: [{ field: 'work_item' }] });
    const sent = (await submit(w, scout, [{ ...menu(placeId), work_item: mine.id }])).results[0]!;
    expect(sent.status).toBe('accepted');
    await decide(w, sent.id!, 'verified');
    expect((await w.env.DB.prepare('SELECT status FROM work_items WHERE id = ?').bind(mine.id).first<{ status: string }>())!.status).toBe('done');
    const dismissed = await w.json<{ status: string }>(`/api/work/${theirs.id}/dismiss`, { method: 'POST', token: scout, json: { reason: 'The link is a delivery app, not its own menu.' } });
    expect(dismissed.body.status).toBe('dismissed');
    // A new link opens a finished item again, and says which menu we have.
    await sendLink(w, placeId, 'https://example.com/menu-2027.pdf');
    const again = (await work(w, scout, 'menu-link')).find((item) => item.subject === placeId)!;
    expect(again.payload.menus).toEqual([sent.id]);
  });
});

describe('a visitor sends the pages of a menu', () => {
  it('stores each page as a photo of one set, after one check', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const { status, body } = await uploadPages(w, placeId, pages(3));
    expect(status).toBe(201);
    expect(body.ids).toHaveLength(3);
    const rows = await w.env.DB.prepare(`SELECT id, data_json FROM records WHERE kind = 'photo' ORDER BY id`).all<{ id: string; data_json: string }>();
    const data = rows.results.map((row) => JSON.parse(row.data_json) as { set: string; page_no: number; subject: string });
    expect(data.map((page) => page.set)).toEqual([body.ids![0], body.ids![0], body.ids![0]]);
    expect(data.map((page) => page.page_no).sort()).toEqual([1, 2, 3]);
    expect(w.media.size).toBe(6);
    expect((await uploadPages(w, placeId, pages(11))).body.error!.message).toContain('at most 10 pages');
    expect((await uploadPages(w, placeId, pages(2, { subject: 'dish', dish_name: '油泼面' }))).body.error!.message).toContain('one photo at a time');
  });

  it('becomes one menu to type up once no page waits for review, with every page in order', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const ids = (await uploadPages(w, placeId, pages(3))).body.ids!;
    const scout = await join(w, 'menu-scout', '198.51.100.33');
    await decide(w, ids[0]!, 'verified');
    expect(await work(w, scout, 'transcribe')).toEqual([]);
    await decide(w, ids[1]!, 'verified');
    await decide(w, ids[2]!, 'rejected');
    const [item] = await work(w, scout, 'transcribe');
    expect(item!.subject).toBe(ids[0]);
    expect(item!.payload).toMatchObject({ photo: ids[0], pages: [ids[0], ids[1]] });
    expect(item!.payload.image_urls).toEqual([`https://lcf.test/media/p/${ids[0]}/full.webp`, `https://lcf.test/media/p/${ids[1]}/full.webp`]);

    const typed = {
      ...menu(placeId, [{ name_zh: '油泼面', price_pence: 1280 }, { name_zh: '肉夹馍', price_pence: 650 }], { source_kind: 'visitor-photo', photo: ids[0] }),
      source_url: item!.payload.image_url as string,
      evidence: '油泼面 £12.80',
      observed_at: NOW_ISO(),
      work_item: item!.id,
    };
    expect((await submit(w, scout, [typed])).results[0]!.status).toBe('accepted');
    const keeper = await maintainer(w);
    const leased = await lease(w, keeper);
    const task = leased.tasks.find((entry) => entry.kind === 'menu') as unknown as { pages: string[] };
    expect(task.pages).toEqual([`https://lcf.test/media/p/${ids[0]}/full.webp`, `https://lcf.test/media/p/${ids[1]}/full.webp`]);
  });
});

describe('a place’s own menu link', () => {
  it('goes to collectors with the place’s menu item', async () => {
    const w = world();
    const placeId = await publicPlace(w, { menu_url: 'https://example.com/menu.pdf' });
    await w.json('/api/admin/maintenance', { method: 'POST', admin: true });
    const scout = await join(w, 'menu-scout', '198.51.100.34');
    const [item] = await work(w, scout, 'menu');
    expect(item).toMatchObject({ subject: placeId, payload: { menu_url: 'https://example.com/menu.pdf' } });
    const doc = (await w.json<{ place: Record<string, unknown> }>(`/api/places/${placeId}`)).body;
    expect(doc.place.menu_url).toBe('https://example.com/menu.pdf');
  });
});
