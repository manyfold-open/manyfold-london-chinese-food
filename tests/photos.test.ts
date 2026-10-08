import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlaceDoc } from '../src/shared/place-doc';
import { fakeImage, join, lease, maintainer, menu, place, submit, verdicts, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

async function publicPlace(w: World) {
  const token = await join(w);
  const { results } = await submit(w, token, [place(), menu('#0', [{ name_zh: '油泼面', price_pence: 1280, canonical: '油泼面' }])]);
  for (const result of results) await w.call(`/api/admin/records/${result.id}/decide`, { method: 'POST', admin: true, json: { status: 'verified' } });
  return results[0]!.id!;
}

const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const good = (extra: Record<string, string | Blob> = {}) =>
  form({ file: fakeImage('image/jpeg', 4000, 3000), subject: 'dish', dish_name: '油泼面', license: 'CC-BY-4.0', 'cf-turnstile-response': 'human', ...extra });

const upload = (w: World, placeId: string, body: FormData, headers: Record<string, string> = {}) =>
  w.json<{ id?: string; error?: { code: string; message: string } }>(`/api/places/${placeId}/photos`, { method: 'POST', body, headers });

describe('a visitor uploads a photo', () => {
  it('stores only re-encoded WebP, never what was sent, pending with a task', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const { status, body } = await upload(w, placeId, good({ file: fakeImage('image/jpeg', 4000, 3000, 2000), caption: 'Lunch' }));
    expect(status).toBe(201);
    const id = body.id!;
    expect([...w.media.keys()].sort()).toEqual([`photos/${id}/full.webp`, `photos/${id}/thumb.webp`]);
    expect(new TextDecoder().decode(w.media.get(`photos/${id}/full.webp`))).toBe('WEBP 1600 1200');
    expect(new TextDecoder().decode(w.media.get(`photos/${id}/thumb.webp`))).toBe('WEBP 480 360');
    for (const bytes of w.media.values()) expect(new TextDecoder().decode(bytes)).not.toContain('IMG');
    const record = await w.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).first<{ status: string; submitted_by: string; parent_id: string; data_json: string }>();
    expect(record).toMatchObject({ status: 'pending', submitted_by: 'visitor', parent_id: placeId });
    expect(JSON.parse(record!.data_json)).toMatchObject({ subject: 'dish', dish_name: '油泼面', caption: 'Lunch', width: 1600, height: 1200, license: 'CC-BY-4.0' });
  });

  it('turns away other origins, a missing licence, a place that is not public, and a failed check', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    expect((await upload(w, placeId, good(), { origin: 'https://elsewhere.example' })).status).toBe(403);
    expect((await upload(w, placeId, good({ license: '' }))).body.error!.code).toBe('license_required');
    expect((await upload(w, 'rec_00000000000000000000000000', good())).status).toBe(404);
    expect((await upload(w, placeId, good({ 'cf-turnstile-response': 'robot' }))).body.error!.code).toBe('turnstile_failed');
    expect(w.media.size).toBe(0);
  });

  it('refuses what is not a usable image', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    expect((await upload(w, placeId, good({ file: new Blob(['hello']) }))).body.error!.code).toBe('not_an_image');
    expect((await upload(w, placeId, good({ file: fakeImage('image/jpeg', 300, 200) }))).body.error!.message).toContain('at least 400 pixels');
    expect((await upload(w, placeId, good({ file: fakeImage('image/svg+xml', 900, 900) }))).body.error!.code).toBe('invalid_image');
    expect((await upload(w, placeId, good({ subject: 'dish', dish_name: '' }))).body.error!.message).toContain('dish_name is required');
  });

  it('takes six photos an hour from one address', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    for (let i = 0; i < 6; i += 1) expect((await upload(w, placeId, good())).status).toBe(201);
    expect((await upload(w, placeId, good())).status).toBe(429);
    expect((await upload(w, placeId, good(), { 'cf-connecting-ip': '198.51.100.99' })).status).toBe(201);
  });
});

describe('a photo on its way to the page', () => {
  it('is seen only by the maintainer holding its task until verified, then by everyone', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const id = (await upload(w, placeId, good())).body.id!;
    expect((await w.call(`/media/p/${id}/full.webp`)).status).toBe(404);

    const keeper = await maintainer(w);
    const task = (await lease(w, keeper)).tasks.find((leased) => leased.record.id === id)!;
    expect(task.media_url).toBe(`https://lcf.test/api/tasks/${task.id}/media`);
    const seen = await w.call(`/api/tasks/${task.id}/media`, { token: keeper });
    expect(seen.headers.get('content-type')).toBe('image/webp');
    expect(await (await w.call(`/api/tasks/${task.id}/media?format=jpeg`, { token: keeper })).text()).toBe('JPEG 1600 1200');
    const other = await maintainer(w, 'other');
    expect((await w.call(`/api/tasks/${task.id}/media`, { token: other })).status).toBe(404);

    const outcome = await verdicts(w, keeper, [{ task_id: task.id, verdict: 'verified', source_url: 'https://example.com/x', evidence: 'x' }]);
    expect(outcome.results[0]!.errors![0]!.message).toContain('send no source_url or evidence');
    await verdicts(w, keeper, [{ task_id: task.id, verdict: 'verified' }]);
    const shown = await w.call(`/media/p/${id}/full.webp`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get('x-content-type-options')).toBe('nosniff');

    await w.json('/api/admin/maintenance', { method: 'POST', admin: true });
    const doc = (await w.json<PlaceDoc>(`/api/places/${placeId}`)).body;
    expect(doc.photos).toEqual([expect.objectContaining({ id, subject: 'dish', dish_name: '油泼面', width: 1600 })]);
    expect(doc.menus[0]!.sections[0]!.items[0]!.photo).toMatchObject({ id });
  });

  it('turns a photo of a menu into work: a menu to transcribe', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const id = (await upload(w, placeId, good({ subject: 'menu', dish_name: '' }))).body.id!;
    await w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status: 'verified' } });
    const token = await join(w, 'menu scout', '198.51.100.5');
    const { body } = await w.json<{ items: { subject: string; payload: { image_url: string; place: string } }[] }>('/api/work?type=transcribe', { token });
    expect(body.items[0]).toMatchObject({ subject: id, payload: { place: placeId, image_url: `https://lcf.test/media/p/${id}/full.webp` } });
  });

  it('is deleted at once when taken down, and a month after it was rejected', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const first = (await upload(w, placeId, good())).body.id!;
    const second = (await upload(w, placeId, good())).body.id!;
    await w.call(`/api/admin/records/${first}/takedown`, { method: 'POST', admin: true, json: { reason: 'The photographer asked.' } });
    expect([...w.media.keys()].some((key) => key.includes(first))).toBe(false);

    await w.call(`/api/admin/records/${second}/decide`, { method: 'POST', admin: true, json: { status: 'rejected', reason: 'A screenshot.' } });
    expect([...w.media.keys()].some((key) => key.includes(second))).toBe(true);
    const monthAgo = new Date(Date.now() - 30.5 * 24 * 60 * 60 * 1000).toISOString();
    await w.env.DB.prepare('UPDATE records SET updated_at = ? WHERE id = ?').bind(monthAgo, second).run();
    await w.json('/api/admin/maintenance', { method: 'POST', admin: true });
    expect([...w.media.keys()].some((key) => key.includes(second))).toBe(false);
  });

  it('lets the admin reject a burst of uploads at once', async () => {
    const w = world();
    const placeId = await publicPlace(w);
    const since = new Date(Date.now() - 1000).toISOString();
    for (let i = 0; i < 3; i += 1) await upload(w, placeId, good());
    const { body } = await w.json<{ rejected: number }>('/api/admin/photos/reject', { method: 'POST', admin: true, json: { since, reason: 'Spam burst.' } });
    expect(body.rejected).toBe(3);
  });
});
