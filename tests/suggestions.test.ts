import { afterEach, describe, expect, it, vi } from 'vitest';
import { join, place, submit, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const decide = (w: World, id: string, status: string) =>
  w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status, ...(status === 'rejected' ? { reason: 'Not this place.' } : {}) } });

async function publicPlace(w: World, overrides: Record<string, unknown> = {}) {
  const token = await join(w, 'place-scout', '198.51.100.40');
  const { results } = await submit(w, token, [place(overrides)]);
  await decide(w, results[0]!.id!, 'verified');
  return results[0]!.id!;
}

type Answer = { status?: string; place?: { id: string; name_en: string | null; name_zh: string | null }; error?: { code: string; message: string } };

/** Each suggestion from an address of its own, unless the test says which: one address may send five an hour. */
let visitor = 0;
const suggest = (w: World, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  w.json<Answer>('/api/leads', {
    method: 'POST',
    json: { 'cf-turnstile-response': 'human', ...body },
    headers: { 'cf-connecting-ip': `192.0.2.${(visitor += 1) % 250}`, ...headers },
  });

type Item = { id: string; subject: string; priority: number; payload: Record<string, unknown> };
const leads = async (w: World, token: string) => (await w.json<{ items: Item[] }>('/api/work?type=lead&limit=10', { token })).body.items;
const leadRows = async (w: World) =>
  (
    await w.env.DB.prepare(`SELECT subject, status, priority, payload_json FROM work_items WHERE type = 'lead' ORDER BY created_at`).all<{
      subject: string;
      status: string;
      priority: number;
      payload_json: string;
    }>()
  ).results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) as Record<string, unknown> }));

describe('a visitor suggests a place the site is missing', () => {
  it('becomes a lead for collectors with what the visitor wrote, and nothing public', async () => {
    const w = world();
    const sent = await suggest(w, { name: 'Golden Dragon', where: '28 Gerrard Street, w1d6jw', url: 'https://example.com/golden-dragon', note: 'Dim sum all day.' });
    expect(sent).toEqual({ status: 201, body: { status: 'received' } });
    const scout = await join(w, 'place-scout', '198.51.100.41');
    const [item] = await leads(w, scout);
    expect(item!.subject).toMatch(/^visitor:[0-9a-f]{24}$/);
    expect(item!.priority).toBe(5);
    expect(item!.payload).toEqual({
      name: 'Golden Dragon',
      address: '28 Gerrard Street, w1d6jw',
      postcode: 'W1D 6JW',
      hint: 'A visitor suggested it on the site, writing: "Dim sum all day."',
      sources: ['https://example.com/golden-dragon'],
    });
    const { n } = (await w.env.DB.prepare('SELECT COUNT(*) AS n FROM records').first<{ n: number }>())!;
    expect(n).toBe(0);
  });

  it('is answered by the place a collector finds for it, and then answered with that place', async () => {
    const w = world();
    await suggest(w, { name: 'Golden Dragon', where: 'W1D 5PG' });
    const scout = await join(w, 'place-scout', '198.51.100.42');
    const [item] = await leads(w, scout);
    const sent = (await submit(w, scout, [{ ...place({ name_en: 'Golden Dragon', name_zh: '金龙', postcode: 'W1D 5PG' }), work_item: item!.id }])).results[0]!;
    expect(sent.status).toBe('accepted');
    await decide(w, sent.id!, 'verified');
    expect((await leadRows(w))[0]!.status).toBe('done');
    expect((await suggest(w, { name: 'golden dragon', where: '1 Example Road W1D 5PG' })).body).toEqual({
      status: 'listed',
      place: { id: sent.id, name_en: 'Golden Dragon', name_zh: '金龙' },
    });
  });

  it('answers with a place listed at that postcode under a name alike, in either language', async () => {
    const w = world();
    const id = await publicPlace(w);
    const listed = { status: 'listed', place: { id, name_en: 'Example Noodle House', name_zh: '示例面馆' } };
    expect((await suggest(w, { name: 'Example Noodle House', where: 'W1D 6JW' })).body).toEqual(listed);
    expect((await suggest(w, { name: '示例面馆', where: '12 Example St, W1D 6JW' })).body).toEqual(listed);
    // Another name at the same postcode is another place.
    expect((await suggest(w, { name: 'Lotus Garden', where: 'W1D 6JW' })).status).toBe(201);
    expect((await leadRows(w)).map((row) => row.payload.name)).toEqual(['Lotus Garden']);
  });

  it('needs no lead for a place already waiting for review, and says nothing of it', async () => {
    const w = world();
    const token = await join(w, 'place-scout', '198.51.100.43');
    await submit(w, token, [place()]);
    expect(await suggest(w, { name: 'Example Noodle House', where: 'W1D 6JW' })).toEqual({ status: 201, body: { status: 'received' } });
    expect(await leadRows(w)).toEqual([]);
  });

  it('turns away what could not be found, or not from this site’s form', async () => {
    const w = world();
    const code = async (body: Record<string, unknown>, headers?: Record<string, string>) => (await suggest(w, body, headers)).body.error?.code;
    expect(await code({ name: 'X', where: 'W1D 6JW' })).toBe('invalid_body');
    expect(await code({ name: 'Golden Dragon', where: ' ' })).toBe('invalid_body');
    expect(await code({ name: 'Golden Dragon', where: 'Soho', note: 'x'.repeat(301) })).toBe('invalid_body');
    expect(await code({ name: 'Golden Dragon', where: 'Soho', url: 'the one by the station' })).toBe('invalid_url');
    expect(await code({ name: 'Golden Dragon', where: 'Soho', url: 'javascript:alert(1)' })).toBe('invalid_url');
    await w.call('/api/admin/blocked-hosts', { method: 'PUT', admin: true, json: { hosts: ['blocked.example'] } });
    expect(await code({ name: 'Golden Dragon', where: 'Soho', url: 'https://www.blocked.example/golden-dragon' })).toBe('blocked_host');
    expect(await code({ name: 'Golden Dragon', where: '1 Piccadilly, Manchester M1 1AA' })).toBe('outside_london');
    expect(await code({ name: 'Golden Dragon', where: 'ZZ9 9ZZ' })).toBe('unknown_postcode');
    expect(await code({ name: 'Golden Dragon', where: 'Soho', 'cf-turnstile-response': 'robot' })).toBe('turnstile_failed');
    expect(await code({ name: 'Golden Dragon', where: 'Soho' }, { origin: 'https://elsewhere.example' })).toBe('cross_origin');
    expect(await leadRows(w)).toEqual([]);
  });

  it('keeps the postcode as written when postcodes.io does not answer', async () => {
    const w = world();
    w.postcodesDown = true;
    expect((await suggest(w, { name: 'Golden Dragon', where: 'N7 8AB' })).status).toBe(201);
    expect((await leadRows(w))[0]!.payload.postcode).toBe('N7 8AB');
  });

  it('gathers the same suggestion into one lead, and opens a dismissed one again only for a new link', async () => {
    const w = world();
    await suggest(w, { name: 'Golden Dragon', where: 'W1D 5PG' });
    await suggest(w, { name: 'golden dragon', where: 'w1d 5pg', url: 'https://example.com/a', note: 'Opened in May.' });
    await suggest(w, { name: 'Golden Dragon!', where: 'W1D5PG', url: 'https://example.com/b' });
    const [first] = await leadRows(w);
    expect(await leadRows(w)).toHaveLength(1);
    expect(first!.payload).toMatchObject({
      name: 'Golden Dragon',
      hint: 'A visitor suggested it on the site, writing: "Opened in May."',
      sources: ['https://example.com/a', 'https://example.com/b'],
    });

    const scout = await join(w, 'place-scout', '198.51.100.44');
    const [item] = await leads(w, scout);
    expect((await w.json<{ status: string }>(`/api/work/${item!.id}/dismiss`, { method: 'POST', token: scout, json: { reason: 'A Thai restaurant.' } })).body.status).toBe('dismissed');
    await suggest(w, { name: 'Golden Dragon', where: 'W1D 5PG', url: 'https://example.com/b' });
    expect((await leadRows(w))[0]!.status).toBe('dismissed');
    await suggest(w, { name: 'Golden Dragon', where: 'W1D 5PG', url: 'https://example.com/c' });
    const [again] = await leadRows(w);
    expect(again!.status).toBe('open');
    expect(again!.payload.sources).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
  });

  it('takes five suggestions an hour from one address', async () => {
    const w = world();
    const from = { 'cf-connecting-ip': '198.51.100.99' };
    for (let n = 1; n <= 5; n += 1) expect((await suggest(w, { name: `Noodle Place ${n}`, where: 'Soho' }, from)).status).toBe(201);
    const refused = await suggest(w, { name: 'Noodle Place 6', where: 'Soho' }, from);
    expect(refused.status).toBe(429);
    expect(refused.body.error!.code).toBe('rate_limited');
  });
});
