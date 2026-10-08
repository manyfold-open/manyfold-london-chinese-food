import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeImage, join, lease, maintainer, menu, place, submit, verdicts, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const cron = (w: World) => w.json('/api/admin/maintenance', { method: 'POST', admin: true });

/** Two public places serving 油泼面, one serving 肉夹馍: the dishes to illustrate. */
async function servedDishes(w: World) {
  const token = await join(w, 'scout', '198.51.100.40');
  const { results } = await submit(w, token, [
    place(),
    menu('#0', [{ name_zh: '油泼面', price_pence: 1280, canonical: '油泼面' }, { name_zh: '肉夹馍', price_pence: 650 }]),
    place({ name_en: 'Second Noodle House', postcode: 'N7 8AB' }),
    menu('#2', [{ name_en: 'Biang biang noodles', price_pence: 1300 }]),
  ]);
  for (const result of results) await w.call(`/api/admin/records/${result.id}/decide`, { method: 'POST', admin: true, json: { status: 'verified' } });
  await cron(w);
}

const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

async function holdItem(w: World, token: string) {
  const { body } = await w.json<{ items: { id: string; subject: string; priority: number; payload: { prompt: string; description: string | null } }[] }>('/api/work?type=illustrate&limit=1', { token });
  return body.items[0]!;
}

const uploadFor = (w: World, token: string, item: { id: string; subject: string }, file: Blob = fakeImage('image/png', 1024, 1024)) =>
  w.json<{ id?: string; error?: { code: string; message: string } }>('/api/illustrations', {
    method: 'POST',
    token,
    body: form({ work_item: item.id, dish: item.subject, model: 'gpt-image-1', prompt: 'Realistic food photograph', file }),
  });

describe('illustration work', () => {
  it('asks for the most served dishes first, with a prompt from the template', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.41');
    const item = await holdItem(w, artist);
    expect(item).toMatchObject({ subject: '油泼面', priority: 2 });
    expect(item.payload.prompt).toContain('Realistic food photograph of Biang biang noodles (油泼面)');
    expect(item.payload.prompt).toContain('No text, letters, logos, watermarks, people or hands.');
  });

  it('fills the prompt in from the template as it is when an item is handed out', async () => {
    const w = world();
    await servedDishes(w);
    const template = 'Studio photograph of {en} ({zh}) on a white plate.';
    expect((await w.json('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { template } })).status).toBe(200);
    const artist = await join(w, 'artist', '198.51.100.46');
    expect((await holdItem(w, artist)).payload.prompt).toBe('Studio photograph of Biang biang noodles (油泼面) on a white plate.');
  });

  it('hands each dish to one agent, within the daily number, and none when paused', async () => {
    const w = world();
    await servedDishes(w);
    await w.call('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { daily: 1 } });
    const one = await join(w, 'one', '198.51.100.42');
    const two = await join(w, 'two', '198.51.100.43');
    expect((await holdItem(w, one)).subject).toBe('油泼面');
    expect((await w.json<{ items: unknown[] }>('/api/work?type=illustrate', { token: two })).body.items).toEqual([]);
    await w.call('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { daily: 10, requested: false } });
    expect((await w.json<{ items: unknown[] }>('/api/work?type=illustrate', { token: two })).body.items).toEqual([]);
  });

  it('takes an upload only for the item held, the right dish, square enough and big enough', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.44');
    const item = await holdItem(w, artist);
    const stranger = await join(w, 'stranger', '198.51.100.45');
    expect((await uploadFor(w, stranger, item)).status).toBe(422);
    expect((await uploadFor(w, artist, { ...item, subject: '肉夹馍' })).body.error!.message).toContain("the work item's dish");
    expect((await uploadFor(w, artist, item, fakeImage('image/png', 1600, 900))).body.error!.message).toContain('close to square');
    expect((await uploadFor(w, artist, item, fakeImage('image/png', 600, 600))).body.error!.message).toContain('at least 768');
    const { status, body } = await uploadFor(w, artist, item);
    expect(status).toBe(201);
    expect([...w.media.keys()].sort()).toEqual([`illustrations/${body.id}/full.webp`, `illustrations/${body.id}/thumb.webp`]);
    const workItem = await w.env.DB.prepare('SELECT status, record_id FROM work_items WHERE id = ?').bind(item.id).first();
    expect(workItem).toMatchObject({ status: 'submitted', record_id: body.id });
  });

  it('becomes the dish’s illustration once verified, and stops being one when replaced', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.46');
    const item = await holdItem(w, artist);
    const id = (await uploadFor(w, artist, item)).body.id!;
    expect((await w.call(`/media/i/${id}/full.webp`)).status).toBe(404);

    const keeper = await maintainer(w);
    const task = (await lease(w, keeper, '?kind=illustration')).tasks[0]!;
    expect(task.media_url).toContain(`/api/tasks/${task.id}/media`);
    await verdicts(w, keeper, [{ task_id: task.id, verdict: 'verified' }]);
    await cron(w);
    expect((await w.json<{ shown: boolean; dishes: Record<string, string> }>('/api/illustrations')).body).toEqual({ shown: true, dishes: { 油泼面: id } });
    expect((await w.call(`/media/i/${id}/full.webp`)).status).toBe(200);

    await w.call(`/api/admin/illustrations/${id}/replace`, { method: 'POST', admin: true, json: { note: 'The noodles should be wide and flat.' } });
    await cron(w);
    expect((await w.json<{ dishes: Record<string, string> }>('/api/illustrations')).body.dishes).toEqual({});
    const again = await holdItem(w, artist);
    expect(again.subject).toBe('油泼面');
    expect(again.payload.prompt).toContain('Note from the last review: The noodles should be wide and flat.');
  });

  it('opens the dish again for someone else when an illustration is rejected', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.47');
    const item = await holdItem(w, artist);
    await uploadFor(w, artist, item);
    const keeper = await maintainer(w);
    const task = (await lease(w, keeper, '?kind=illustration')).tasks[0]!;
    await verdicts(w, keeper, [{ task_id: task.id, verdict: 'rejected', reason: 'There are chopsticks held by a hand.' }]);
    const row = await w.env.DB.prepare('SELECT status, note FROM work_items WHERE id = ?').bind(item.id).first<{ status: string; note: string }>();
    expect(row).toMatchObject({ status: 'open', note: expect.stringContaining('chopsticks held by a hand') });
  });

  it('hides every illustration when the admin turns them off', async () => {
    const w = world();
    await w.call('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { shown: false } });
    expect((await w.json<{ shown: boolean }>('/api/illustrations')).body.shown).toBe(false);
  });
});
