import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISH_VOCAB } from '../kinds/dish-vocab';
import { ILLUSTRATABLE } from '../src/worker/illustrations';
import { DEFAULT_TEMPLATE } from '../src/worker/settings';
import { fakeImage, join, lease, maintainer, menu, place, submit, verdicts, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const cron = (w: World) => w.json('/api/admin/maintenance', { method: 'POST', admin: true });

/** A public place serving these menu items. */
async function serving(w: World, items: Record<string, unknown>[], postcode = 'E14 5AB') {
  const token = await join(w, 'menu scout', '198.51.100.39');
  const { results } = await submit(w, token, [place({ name_en: `Menu House ${postcode}`, postcode }), menu('#0', items)]);
  for (const result of results) await w.call(`/api/admin/records/${result.id}/decide`, { method: 'POST', admin: true, json: { status: 'verified' } });
}

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

interface Item {
  id: string;
  subject: string;
  priority: number;
  payload: { dish: string; name_en: string; prompt: string; description: string | null };
}

interface Work {
  items: Item[];
  note?: string;
}

const work = async (w: World, token: string, limit = 5) => (await w.json<Work>(`/api/work?type=illustrate&limit=${limit}`, { token })).body;

async function holdItem(w: World, token: string) {
  return (await work(w, token, 1)).items[0]!;
}

const uploadFor = (w: World, token: string, item: Item, file: Blob = fakeImage('image/png', 1024, 1024), dish = item.payload.dish) =>
  w.json<{ id?: string; error?: { code: string; message: string } }>('/api/illustrations', {
    method: 'POST',
    token,
    body: form({ work_item: item.id, dish, model: 'gpt-image-1', prompt: item.payload.prompt, file }),
  });

const tokenId = async (w: World, token: string) => (await w.json<{ token_id: string }>('/api/me', { token })).body.token_id;

/** An illustrate item opened before items were limited to standard dishes, held by the token. */
async function oldItem(w: World, token: string, subject: string) {
  const id = `wrk_${subject.replace(/\W/g, '')}`;
  const at = new Date().toISOString();
  await w.env.DB.prepare(
    `INSERT INTO work_items (id, type, subject, priority, payload_json, status, handed_to, handed_until, created_at, updated_at)
     VALUES (?, 'illustrate', ?, 5, ?, 'open', ?, ?, ?, ?)`,
  )
    .bind(id, subject, JSON.stringify({ dish: subject, prompt: `Realistic food photograph of ${subject}.` }), await tokenId(w, token), new Date(Date.now() + 3_600_000).toISOString(), at, at)
    .run();
  return id;
}

const statusOf = (w: World, id: string) => w.env.DB.prepare('SELECT status, note FROM work_items WHERE id = ?').bind(id).first<{ status: string; note: string | null }>();

describe('illustration work', () => {
  it('asks for the most served dishes first, with a prompt from the template', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.41');
    const item = await holdItem(w, artist);
    expect(item).toMatchObject({ subject: '油泼面', priority: 2, payload: { dish: '油泼面', name_en: 'Biang biang noodles' } });
    expect(item.payload.prompt).toContain('Realistic food photograph of Biang biang noodles (油泼面)');
    expect(item.payload.prompt).toContain('No text, letters, logos, watermarks, people or hands.');
  });

  it('asks only for standard dishes: never a drink, a set meal, an add-on, a heading or a line too long to send', async () => {
    const w = world();
    await servedDishes(w);
    await serving(w, [
      { name_en: 'Coke', price_pence: 250 },
      { name_zh: '加多宝', price_pence: 250 },
      { name_en: 'Set meal for 2', price_pence: 3600 },
      { name_en: 'Choose any 2 meats with rice', price_pence: 1100 },
      { name_en: 'Add a special sauce', price_pence: 100 },
      { name_zh: '川菜' },
      { name_en: 'Sizzling chicken with ginger and spring onion', price_pence: 1250 },
      { name_en: 'Har gow', price_pence: 650 },
    ]);
    await cron(w);
    const { results } = await w.env.DB.prepare(`SELECT subject, payload_json FROM work_items WHERE type = 'illustrate' ORDER BY subject`).all<{ subject: string; payload_json: string }>();
    expect(results.map((row) => row.subject)).toEqual(['肉夹馍', '油泼面', '虾饺'].sort());
    // What the item tells the agent to send as `dish` is what the upload takes.
    for (const row of results) expect(JSON.parse(row.payload_json)).toMatchObject({ dish: row.subject, description: expect.any(String) });
  });

  it('closes the items no agent could finish, even one an agent holds, and the admin cannot open them again', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.48');
    const coke = await oldItem(w, artist, 'coke');
    const long = await oldItem(w, artist, 'sizzling chicken with ginger and spring onion');
    expect((await work(w, artist, 20)).items.map((item) => item.subject).sort()).toEqual(['coke', 'sizzling chicken with ginger and spring onion', '油泼面', '肉夹馍'].sort());

    await cron(w);
    expect((await work(w, artist, 20)).items.map((item) => item.subject)).toEqual(['油泼面', '肉夹馍']);
    for (const id of [coke, long]) expect(await statusOf(w, id)).toEqual({ status: 'dismissed', note: expect.stringContaining('Not a standard dish') });
    const reopened = await w.json<{ error: { message: string } }>(`/api/admin/work/${coke}/reopen`, { method: 'POST', admin: true });
    expect(reopened.status).toBe(409);
    expect(reopened.body.error.message).toContain('coke is not a standard dish');
    // A standard dish an agent holds can still be taken back.
    const held = (await work(w, artist)).items[0]!;
    expect((await w.call(`/api/admin/work/${held.id}/reopen`, { method: 'POST', admin: true })).status).toBe(200);
  });

  it('fills the prompt in from the template as it is when an item is handed out', async () => {
    const w = world();
    await servedDishes(w);
    const template = 'Studio photograph of {en} ({zh}) on a white plate.';
    expect((await w.json('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { template } })).status).toBe(200);
    const artist = await join(w, 'artist', '198.51.100.46');
    expect((await holdItem(w, artist)).payload.prompt).toBe('Studio photograph of Biang biang noodles (油泼面) on a white plate.');
  });

  it('refuses a template whose prompts the upload would refuse', async () => {
    const w = world();
    const template = `{en}: ${'{description} '.repeat(12)}`;
    const { status, body } = await w.json<{ error: { message: string } }>('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { template } });
    expect(status).toBe(422);
    expect(body.error.message).toContain('the prompt must be at most 2000 characters');
  });

  it('can ask for every standard dish, with a prompt the upload takes', async () => {
    expect(ILLUSTRATABLE.size).toBe(DISH_VOCAB.length);
    const w = world();
    expect((await w.json('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { template: DEFAULT_TEMPLATE } })).status).toBe(200);
  });

  it('hands each dish to one agent, within the daily number, and none when paused, saying why', async () => {
    const w = world();
    await servedDishes(w);
    await w.call('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { daily: 1 } });
    const one = await join(w, 'one', '198.51.100.42');
    const two = await join(w, 'two', '198.51.100.43');
    expect((await holdItem(w, one)).subject).toBe('油泼面');
    expect(await work(w, two)).toEqual({ items: [], note: expect.stringContaining("1 illustrate item a day, and today's are all out") });
    await w.call('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { daily: 10, requested: false } });
    expect(await work(w, two)).toEqual({ items: [], note: expect.stringContaining('paused illustrations') });
    await w.call('/api/admin/illustrations/settings', { method: 'PATCH', admin: true, json: { requested: true } });
    expect(await work(w, two)).toEqual({ items: [expect.objectContaining({ subject: '肉夹馍' })], note: expect.stringContaining('No more illustrate items are open') });
  });

  it('hands an agent no more dishes than it may have waiting for review, and says why', async () => {
    const w = world();
    await serving(w, DISH_VOCAB.slice(0, 7).map((entry) => ({ name_zh: entry.zh, price_pence: 600 })));
    await cron(w);
    const artist = await join(w, 'artist', '198.51.100.49');
    const first = await work(w, artist, 20);
    expect(first.items).toHaveLength(5);
    expect(first.note).toBe(
      '0 of your illustrations are waiting for review, of the 5 you may have at once, and the 5 work items you hold need one each. You get more as maintainers review yours and as you answer (or dismiss) what you hold.',
    );
    expect((await uploadFor(w, artist, first.items[0]!)).status).toBe(201);
    const after = await work(w, artist, 20);
    expect(after.items).toHaveLength(4);
    expect(after.note).toContain('1 of your illustrations is waiting for review, of the 5 you may have at once, and the 4 work items you hold');

    const keeper = await maintainer(w);
    const task = (await lease(w, keeper, '?kind=illustration')).tasks[0]!;
    await verdicts(w, keeper, [{ task_id: task.id, verdict: 'verified' }]);
    // One verified raises the limit to 6: room for the two dishes left.
    expect((await work(w, artist, 20)).items).toHaveLength(6);
  });

  it('takes an upload only for the item held, the right dish, square enough and big enough', async () => {
    const w = world();
    await servedDishes(w);
    const artist = await join(w, 'artist', '198.51.100.44');
    const item = await holdItem(w, artist);
    const stranger = await join(w, 'stranger', '198.51.100.45');
    expect((await uploadFor(w, stranger, item)).status).toBe(422);
    expect((await uploadFor(w, artist, item, undefined, '肉夹馍')).body.error!.message).toContain("the work item's dish");
    expect((await uploadFor(w, artist, item, fakeImage('image/png', 1600, 900))).body.error!.message).toContain('close to square');
    expect((await uploadFor(w, artist, item, fakeImage('image/png', 600, 600))).body.error!.message).toContain('at least 768');
    const { status, body } = await uploadFor(w, artist, item);
    expect(status).toBe(201);
    expect([...w.media.keys()].sort()).toEqual([`illustrations/${body.id}/full.webp`, `illustrations/${body.id}/thumb.webp`]);
    const workItem = await w.env.DB.prepare('SELECT status, record_id FROM work_items WHERE id = ?').bind(item.id).first();
    expect(workItem).toMatchObject({ status: 'submitted', record_id: body.id });
    // Opened again while its illustration waits, the item could not be answered.
    expect((await w.call(`/api/admin/work/${item.id}/reopen`, { method: 'POST', admin: true })).status).toBe(409);
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
    const reopened = await w.json<{ error: { message: string } }>(`/api/admin/work/${item.id}/reopen`, { method: 'POST', admin: true });
    expect(reopened.body.error.message).toContain('replace it from Illustrations instead');

    const replaced = await w.json(`/api/admin/illustrations/${id}/replace`, { method: 'POST', admin: true, json: { note: 'The noodles should be wide and flat.' } });
    expect(replaced.body).toEqual({ reopened: true, standard: true });
    await cron(w);
    expect((await w.json<{ dishes: Record<string, string> }>('/api/illustrations')).body.dishes).toEqual({});
    const again = await holdItem(w, artist);
    expect(again.subject).toBe('油泼面');
    expect(again.payload.prompt).toContain('Note from the last review: The noodles should be wide and flat.');
  });

  it('takes down the illustration of a dish that is not standard without asking for another', async () => {
    const w = world();
    const artist = await join(w, 'artist', '198.51.100.50');
    const old = await oldItem(w, artist, 'salt and pepper chicken');
    const held = (await work(w, artist)).items.find((item) => item.id === old)!;
    const id = (await uploadFor(w, artist, held, undefined, 'Salt and pepper chicken')).body.id!;
    const keeper = await maintainer(w);
    await verdicts(w, keeper, [{ task_id: (await lease(w, keeper, '?kind=illustration')).tasks[0]!.id, verdict: 'verified' }]);
    await cron(w);
    expect((await w.json<{ dishes: Record<string, string> }>('/api/illustrations')).body.dishes).toEqual({ 'salt and pepper chicken': id });

    const replaced = await w.json(`/api/admin/illustrations/${id}/replace`, { method: 'POST', admin: true, json: { note: 'Too dark.' } });
    expect(replaced.body).toEqual({ reopened: false, standard: false });
    await cron(w);
    expect((await w.json<{ dishes: Record<string, string> }>('/api/illustrations')).body.dishes).toEqual({});
    expect((await statusOf(w, old))!.status).toBe('done');
    expect((await work(w, artist)).items).toEqual([]);
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
