import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueWeakSourceRechecks } from '../src/worker/console';
import { ensureSchema } from '../src/worker/db';
import { gatherFacts } from '../src/worker/facts';
import { HUMAN_DAILY_MAX } from '../src/worker/maintainer';
import { BROWSER_WAIT_MS, maintain } from '../src/worker/maintenance';
import { skillVersion } from '../src/worker/skill';
import { join, lease, maintainer, NOW_ISO, place, review, row, submit, tasksOf, verdicts, verifyQuote, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

/** A collector that has asked for its standing (so it has standings rows) and a maintainer. */
async function people(w: World) {
  const collector = await join(w, 'collector');
  for (const focus of ['places', 'reviews-en', 'menus']) await w.call(`/api/skill?focus=${focus}`, { token: collector });
  return { collector, keeper: await maintainer(w) };
}

const review_ = async (w: World) => (await w.json<{ items: { type: string; record: { id: string }; unsure_type: string | null; reason: string }[] }>('/api/admin/review', { admin: true })).body.items;

describe('a source that cannot stand alone', () => {
  it('refuses a place sent with only an FSA listing, and a verdict quoting one', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const fsa = { source_url: 'https://ratings.food.gov.uk/business/123456', evidence: 'Example Noodle House, 12 Example Street, London W1D 6JW.' };
    const refused = (await submit(w, collector, [place({}, fsa)])).results[0]!;
    expect(refused).toMatchObject({ status: 'invalid', errors: [{ field: 'source_url' }] });
    expect(refused.errors![0]!.message).toContain('Food Standards Agency listing');
    await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    const verdict = await verdicts(w, keeper, [verifyQuote(task!.id, fsa)]);
    expect(verdict.results[0]).toMatchObject({ status: 'error', errors: [{ field: 'source_url' }] });
    const osm = await verdicts(w, keeper, [verifyQuote(task!.id, { source_url: 'https://www.openstreetmap.org/node/258016416', evidence: 'cuisine chinese' })]);
    expect(osm.results[0]!.errors![0]!.message).toContain('OpenStreetMap entry');
  });

  it('queues rechecks of places verified on one, longest verified first', async () => {
    const w = world();
    await ensureSchema(w.env.DB);
    const at = '2026-01-01T00:00:00.000Z';
    for (const [id, source] of [['rec_fsa_one', 'https://ratings.food.gov.uk/business/1'], ['rec_own_site', 'https://example.com/'], ['rec_osm', 'https://www.openstreetmap.org/node/3'], ['rec_fsa_two', 'https://www.ratings.food.gov.uk/business/2']]) {
      await w.env.DB.prepare(
        `INSERT INTO records (id, kind, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, 'verified', '{}', ?, 'quote', ?, 'tok_x', ?, ?, ?)`,
      ).bind(id, `W1D 6JW|${id}`, source, at, at, at, at).run();
    }
    expect(await queueWeakSourceRechecks(w.env.DB, 'place', 1, new Date())).toEqual({ queued: 1, remaining: 2 });
    expect(await queueWeakSourceRechecks(w.env.DB, 'place', 5, new Date())).toEqual({ queued: 2, remaining: 0 });
    const tasks = (await w.env.DB.prepare(`SELECT record_id, type, note FROM tasks ORDER BY record_id`).all<{ record_id: string; type: string; note: string }>()).results;
    expect(tasks.map((task) => task.record_id)).toEqual(['rec_fsa_one', 'rec_fsa_two', 'rec_osm']);
    expect(tasks[0]!.note).toContain('Verified earlier on ratings.food.gov.uk');
    expect(tasks[2]!.note).toContain('Verified earlier on openstreetmap.org');
    expect(tasks[2]!.note).toContain('Search its name and address');
  });
});

describe('the same place under another spelling', () => {
  it('refuses a place with the same phone at the same address, and only tells of a name alike', async () => {
    const w = world();
    const token = await join(w);
    await submit(w, token, [place({ name_en: 'Spring Way Brockley', name_zh: undefined, phone: '020 8699 1957' })]);
    const same = (await submit(w, token, [place({ name_en: 'Springway', name_zh: undefined, phone: '02086991957' })])).results[0]!;
    expect(same).toMatchObject({ status: 'duplicate' });
    expect(same.hint).toContain('the same phone at the same address');
    const alike = (await submit(w, token, [place({ name_en: 'Spring Way', name_zh: undefined })])).results[0]!;
    expect(alike.status).toBe('accepted');
    const [task] = await tasksOf(w, alike.id!);
    expect(task!.note).toContain('a name alike');
  });

  it('keeps the FSA id of the lead a place answers', async () => {
    const w = world();
    const token = await join(w);
    await w.json('/api/admin/leads', { method: 'POST', admin: true, json: { leads: [{ subject: 'fsa:4242', name: 'Example Noodle House', postcode: 'W1D 6JW' }] } });
    const { body } = await w.json<{ items: { id: string }[] }>('/api/work?type=lead&limit=1', { token });
    const sent = (await submit(w, token, [{ ...place(), work_item: body.items[0]!.id }])).results[0]!;
    expect(JSON.parse((await row(w, sent.id!))!.data_json).fsa_id).toBe('4242');
  });
});

describe('a maintainer who cannot decide', () => {
  it('must say why, in one of four words', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    const result = await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', reason: 'Not sure.' }]);
    expect(result.results[0]!.errors![0]).toMatchObject({ field: 'unsure_type' });
    expect(result.results[0]!.errors![0]!.message).toContain('cannot_open');
  });

  it('is refused a browser when the server can read the passage itself', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    w.pages['https://example.com/contact'] = '<p>Example Noodle House, 12 Example Street, London W1D 6JW.</p>';
    await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    const result = await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'cannot_open', reason: 'The page timed out.' }]);
    expect(result.results[0]!.errors![0]!.message).toContain('found the passage on it, so no browser is needed');
  });

  it('hands a page it cannot open to a maintainer with a browser, who alone may lease it, then to the site team', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const browser = await maintainer(w, 'browser maintainer', { capabilities: ['browser'] });
    await submit(w, collector, [place({}, { source_url: 'https://example.com/blocked' })]);
    const [task] = (await lease(w, keeper)).tasks;
    const handed = await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'cannot_open', reason: 'The page returned 403 Forbidden, also in a browser.' }]);
    expect(handed.results[0]).toMatchObject({ status: 'applied', record_status: 'pending', routed: 'browser' });
    const other = await maintainer(w, 'another maintainer');
    expect((await lease(w, other)).tasks).toEqual([]);
    const [held] = (await lease(w, browser)).tasks;
    expect(held).toMatchObject({ id: task!.id, needs: 'browser' });
    const last = await verdicts(w, browser, [{ task_id: held!.id, verdict: 'unsure', unsure_type: 'cannot_open', reason: 'A bot check in my browser too.' }]);
    expect(last.results[0]).toMatchObject({ routed: 'site-team' });
    expect((await review_(w)).map((item) => [item.record.id, item.unsure_type])).toEqual([[task!.record.id, 'cannot_open']]);
  });

  it('sends a page no one could open to the site team when no maintainer with a browser came within a day', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await maintainer(w, 'browser maintainer', { capabilities: ['browser'] });
    await submit(w, collector, [place({}, { source_url: 'https://example.com/blocked' })]);
    const [task] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'cannot_open', reason: 'Bot check.' }]);
    expect((await maintain(w.env.DB, new Date())).escalated).toBe(0);
    expect((await maintain(w.env.DB, new Date(Date.now() + BROWSER_WAIT_MS + 60_000))).escalated).toBe(1);
    const [item] = await review_(w);
    expect(item).toMatchObject({ unsure_type: 'cannot_open' });
    expect(item!.reason).toContain('No maintainer with a browser took it within a day. Bot check.');
  });

  it('asks a second maintainer about a conflict, then the site team', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    const first = await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'conflict', reason: 'One listing says closed, its own site takes orders.' }]);
    expect(first.results[0]).toMatchObject({ routed: 'second-opinion' });
    expect((await lease(w, keeper)).tasks).toEqual([]);
    const second = await maintainer(w, 'second maintainer');
    const [again] = (await lease(w, second)).tasks;
    expect(again!.id).toBe(task!.id);
    const last = await verdicts(w, second, [{ task_id: again!.id, verdict: 'unsure', unsure_type: 'conflict', reason: 'Still both ways.' }]);
    expect(last.results[0]).toMatchObject({ routed: 'site-team' });
  });

  it('parks a duplicate of a pending record until that one is decided', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const [first, second, third] = (await submit(w, collector, [place(), place({ name_en: 'Example Noodles', name_zh: undefined }), place({ name_en: 'Noodle House Example', name_zh: undefined })])).results;
    const tasks = (await lease(w, keeper)).tasks;
    const taskOf = (id: string) => tasks.find((task) => task.record.id === id)!;
    const parked = await verdicts(w, keeper, [
      { task_id: taskOf(second!.id!).id, verdict: 'unsure', unsure_type: 'duplicate_pending', duplicate_of: first!.id, reason: 'Same place as the first.' },
      { task_id: taskOf(third!.id!).id, verdict: 'unsure', unsure_type: 'duplicate_pending', duplicate_of: first!.id, reason: 'Same place again.' },
    ]);
    expect(parked.results.map((result) => result.status)).toEqual(['applied', 'applied']);
    // The first, verified by someone else, takes both with it.
    const other = await maintainer(w, 'second maintainer');
    await w.call(`/api/tasks/release`, { method: 'POST', token: keeper, json: { task_ids: [taskOf(first!.id!).id] } });
    const [held] = (await lease(w, other)).tasks;
    expect(held!.record.id).toBe(first!.id);
    await verdicts(w, other, [verifyQuote(held!.id)]);
    expect((await row<{ merged_into: string }>(w, second!.id!))).toMatchObject({ status: 'merged', merged_into: first!.id });
    expect((await row<{ merged_into: string }>(w, third!.id!))).toMatchObject({ status: 'merged', merged_into: first!.id });
  });

  it('opens a parked duplicate again when the record it waited for is rejected, and refuses two waiting on each other', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const [first, second] = (await submit(w, collector, [place(), place({ name_en: 'Example Noodles', name_zh: undefined })])).results;
    const tasks = (await lease(w, keeper)).tasks;
    const taskOf = (id: string) => tasks.find((task) => task.record.id === id)!;
    await verdicts(w, keeper, [{ task_id: taskOf(second!.id!).id, verdict: 'unsure', unsure_type: 'duplicate_pending', duplicate_of: first!.id, reason: 'Same place.' }]);
    const loop = await verdicts(w, keeper, [{ task_id: taskOf(first!.id!).id, verdict: 'unsure', unsure_type: 'duplicate_pending', duplicate_of: second!.id, reason: 'Same place.' }]);
    expect(loop.results[0]!.errors![0]!.message).toContain('already waits for this one');
    await verdicts(w, keeper, [{ task_id: taskOf(first!.id!).id, verdict: 'rejected', reason: 'Its menu shows a pizzeria.' }]);
    const [task] = await tasksOf(w, second!.id!);
    expect(task).toMatchObject({ status: 'open' });
    expect(task!.note).toContain(`${first!.id}, was not accepted: decide this one on its own`);
  });

  it(`sends at most ${HUMAN_DAILY_MAX} tasks a day to the site team`, async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await w.json('/api/admin/tokens/' + (await w.json<{ tokens: { id: string; label: string }[] }>('/api/admin/tokens?role=collector', { admin: true })).body.tokens[0]!.id, {
      method: 'PATCH',
      admin: true,
      json: { pending_cap: 100 },
    });
    for (let i = 0; i < 3; i += 1) {
      await submit(w, collector, Array.from({ length: 10 }, (_, n) => place({ name_en: `Place ${i}-${n}`, name_zh: undefined, address: `${i * 10 + n + 1} Example Street` })));
    }
    let sent = 0;
    let refused: string | undefined;
    while (!refused) {
      const { tasks } = await lease(w, keeper);
      if (tasks.length === 0) break;
      for (const task of tasks) {
        const result = (await verdicts(w, keeper, [{ task_id: task.id, verdict: 'unsure', unsure_type: 'policy', reason: 'The rules do not say.' }])).results[0]!;
        if (result.status === 'applied') sent += 1;
        else {
          refused = result.errors![0]!.message;
          break;
        }
      }
    }
    expect(sent).toBe(HUMAN_DAILY_MAX);
    expect(refused).toContain('POST /api/tasks/release');
  });

  it('gives tasks back with release, and may reject a record on a recheck', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    const released = await w.json<{ released: number }>('/api/tasks/release', { method: 'POST', token: keeper, json: { task_ids: [task!.id] } });
    expect(released.body.released).toBe(1);
    const [again] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [verifyQuote(again!.id)]);
    await w.json(`/api/records/${again!.record.id}/flag`, { method: 'POST', token: collector, json: { reason: 'Its menu is all pizza now.' } });
    const other = await maintainer(w, 'second maintainer');
    const [recheck] = (await lease(w, other)).tasks;
    expect(recheck!.type).toBe('recheck');
    const rejected = await verdicts(w, other, [{ task_id: recheck!.id, verdict: 'rejected', reason: 'Its menu shows only pizza and kebabs.' }]);
    expect(rejected.results[0]).toMatchObject({ status: 'applied', record_status: 'rejected' });
  });

  it('does not count records waiting for the site team against their collector', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await submit(w, collector, [place()]);
    const before = await w.json<{ standing: { place: { pending: number } } }>('/api/me', { token: collector });
    expect(before.body.standing.place.pending).toBe(1);
    const [task] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'policy', reason: 'The rules do not say.' }]);
    const after = await w.json<{ standing: { place: { pending: number } } }>('/api/me', { token: collector });
    expect(after.body.standing.place.pending).toBe(0);
  });
});

describe('the version of the instructions', () => {
  it('is required of maintainers, and refused once the rules changed', async () => {
    const w = world();
    const { keeper } = await people(w);
    const skill = await w.call('/api/skill', { token: keeper });
    const version = skill.headers.get('x-skill-version')!;
    expect(version).toBe(await skillVersion('maintainer'));
    expect(await skill.text()).toContain(`X-Skill-Version: ${version}`);
    expect((await w.json('/api/tasks', { token: keeper, headers: { 'x-no-skill-version': '1' } })).status).toBe(428);
    const stale = await w.json<{ error: { code: string; message: string } }>('/api/tasks', { token: keeper, headers: { 'x-skill-version': 'abc123abc123' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).not.toContain(version);
    expect((await w.json('/api/tasks', { token: keeper, headers: { 'x-skill-version': version } })).status).toBe(200);
  });

  it('is asked of collectors, and an old one refused', async () => {
    const w = world();
    const token = await join(w);
    const plain = await w.json<{ warnings: string[] }>('/api/records', { method: 'POST', token, json: { records: [place()] } });
    expect(plain.body.warnings.join(' ')).toContain('X-Skill-Version');
    const stale = await w.json('/api/records', { method: 'POST', token, json: { records: [place({ name_en: 'Other' })] }, headers: { 'x-skill-version': 'abc123abc123' } });
    expect(stale.status).toBe(409);
    const current = await w.json<{ warnings: string[] }>('/api/records', {
      method: 'POST',
      token,
      json: { records: [place({ name_en: 'Another', name_zh: undefined, address: '14 Example Street' })] },
      headers: { 'x-skill-version': await skillVersion('collector') },
    });
    expect(current.status).toBe(200);
    expect(current.body.warnings.join(' ')).not.toContain('X-Skill-Version');
  });
});

describe('leads that cannot be finished', () => {
  it('are dismissed after their second rejected attempt, and take food evidence and dismissals from the admin', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await w.json('/api/admin/leads', { method: 'POST', admin: true, json: { leads: [{ subject: 'fsa:1', name: 'Lucky House', postcode: 'W1D 6JW' }, { subject: 'fsa:2', name: 'Poplar Grocers', postcode: 'W1D 6JW' }] } });
    const patched = await w.json<{ updated: number; dismissed: number }>('/api/admin/leads', {
      method: 'PATCH',
      admin: true,
      json: { leads: [{ subject: 'fsa:1', priority: 5, food_evidence: { url: 'https://www.just-eat.co.uk/restaurants-lucky/menu', site: 'just-eat', cuisines: ['Chinese'] } }, { subject: 'fsa:2', dismiss: 'Its partner shop sells halal meat and vegetables, nothing Chinese.' }] },
    });
    expect(patched.body).toEqual({ updated: 1, dismissed: 1 });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { body } = await w.json<{ items: { id: string; payload: { food_evidence?: { url: string }; attempts?: number } }[] }>('/api/work?type=lead&limit=5', { token: collector });
      expect(body.items).toHaveLength(1);
      expect(body.items[0]!.payload.food_evidence!.url).toContain('just-eat');
      const sent = (await submit(w, collector, [{ ...place({ name_en: `Lucky House ${attempt}`, name_zh: undefined, address: `${attempt} Example Street` }), work_item: body.items[0]!.id }])).results[0]!;
      const [task] = (await lease(w, keeper)).tasks;
      expect(task!.record.id).toBe(sent.id);
      await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'rejected', reason: 'No page shows Chinese food there.' }]);
    }
    const left = await w.json<{ items: unknown[] }>('/api/work?type=lead&limit=5', { token: collector });
    expect(left.body.items).toEqual([]);
    const status = await w.env.DB.prepare(`SELECT status, json_extract(payload_json, '$.attempts') AS attempts FROM work_items WHERE subject = 'fsa:1'`).first<{ status: string; attempts: number }>();
    expect(status).toEqual({ status: 'dismissed', attempts: 2 });
  });
});

describe('the site team', () => {
  it('verifies with a passage of its own, which becomes the source, and keeps a precedent until it is adopted', async () => {
    const w = world();
    const { collector } = await people(w);
    const { results } = await submit(w, collector, [place()]);
    const decided = await w.json<{ record: { source_url: string; status: string } }>(`/api/admin/records/${results[0]!.id}/decide`, {
      method: 'POST',
      admin: true,
      json: {
        status: 'verified',
        source_url: 'https://www.just-eat.co.uk/restaurants-example/menu',
        evidence: 'Example Noodle House - Chinese, 12 Example Street',
        precedent: 'A delivery listing that takes orders shows both the food and that it trades.',
      },
    });
    expect(decided.body.record).toMatchObject({ status: 'verified', source_url: 'https://www.just-eat.co.uk/restaurants-example/menu' });
    const open = await w.json<{ precedents: { id: number; rule: string }[] }>('/api/admin/precedents', { admin: true });
    expect(open.body.precedents.map((precedent) => precedent.rule)).toEqual(['A delivery listing that takes orders shows both the food and that it trades.']);
    const adopted = await w.json<{ precedents: unknown[] }>(`/api/admin/precedents/${open.body.precedents[0]!.id}/adopt`, { method: 'POST', admin: true });
    expect(adopted.body.precedents).toEqual([]);
    const fsa = await w.json(`/api/admin/records/${results[0]!.id}/decide`, {
      method: 'POST',
      admin: true,
      json: { status: 'verified', source_url: 'https://ratings.food.gov.uk/business/1', evidence: 'Example Noodle House 12 Example Street' },
    });
    expect(fsa.status).toBe(422);
  });

  it('verifies a place resting on an FSA listing only with a page that shows its food', async () => {
    const w = world();
    await ensureSchema(w.env.DB);
    const at = NOW_ISO();
    await w.env.DB.prepare(
      `INSERT INTO records (id, kind, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, created_at, updated_at)
       VALUES ('rec_fsa_only', 'place', 'W1D 6JW|example', 'pending', ?, 'https://ratings.food.gov.uk/business/1', 'Example Noodle House', ?, 'tok_x', ?, ?)`,
    ).bind(JSON.stringify(place().data), at, at, at).run();
    const bare = await w.json<{ error: { message: string } }>('/api/admin/records/rec_fsa_only/decide', { method: 'POST', admin: true, json: { status: 'verified' } });
    expect(bare.status).toBe(422);
    expect(bare.body.error.message).toContain('Send source_url and evidence');
    const shown = await w.json<{ record: { status: string; source_url: string } }>('/api/admin/records/rec_fsa_only/decide', {
      method: 'POST',
      admin: true,
      json: { status: 'verified', source_url: 'https://example-noodles.co.uk/menu', evidence: 'Example Noodle House menu: beef ho fun' },
    });
    expect(shown.body.record).toMatchObject({ status: 'verified', source_url: 'https://example-noodles.co.uk/menu' });
  });

  it("keeps a place's brand reference in step when it edits the brand", async () => {
    const w = world();
    const { collector } = await people(w);
    const [brand, branch] = (await submit(w, collector, [
      { kind: 'brand', data: { name_en: 'Example Tea', website: 'https://example-tea.com/', category: 'tea-drinks' }, source_url: 'https://example-tea.com/about', evidence: 'Example Tea has twelve shops.', observed_at: NOW_ISO() },
      place(),
    ])).results;
    const edited = await w.json(`/api/admin/records/${branch!.id}`, { method: 'PATCH', admin: true, json: { corrections: { brand: brand!.id } } });
    expect(edited.status).toBe(200);
    expect((await row<{ ref_id: string }>(w, branch!.id!))!.ref_id).toBe(brand!.id);
    await w.json(`/api/admin/records/${branch!.id}`, { method: 'PATCH', admin: true, json: { corrections: { brand: null } } });
    expect((await row<{ ref_id: string | null }>(w, branch!.id!))!.ref_id).toBeNull();
    const wrong = await w.json(`/api/admin/records/${branch!.id}`, { method: 'PATCH', admin: true, json: { corrections: { brand: branch!.id } } });
    expect(wrong.status).toBe(422);
  });

  it("keeps a place's brand reference in step when a maintainer corrects the brand", async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const [brand, branch] = (await submit(w, collector, [
      { kind: 'brand', data: { name_en: 'Example Tea', website: 'https://example-tea.com/', category: 'tea-drinks' }, source_url: 'https://example-tea.com/about', evidence: 'Example Tea has twelve shops.', observed_at: NOW_ISO() },
      place({ brand: '#0' }),
    ])).results;
    expect((await row<{ ref_id: string }>(w, branch!.id!))!.ref_id).toBe(brand!.id);
    const tasks = (await lease(w, keeper)).tasks;
    const brandTask = tasks.find((task) => task.record.id === brand!.id)!;
    await verdicts(w, keeper, [{ task_id: brandTask.id, verdict: 'verified', source_url: 'https://example-tea.com/about', evidence: 'Example Tea has twelve shops.', observed_at: NOW_ISO() }]);
    const [placeTask] = (await lease(w, keeper)).tasks;
    const wrong = await verdicts(w, keeper, [verifyQuote(placeTask!.id, { corrections: { brand: placeTask!.record.id } })]);
    expect(wrong.results[0]!.errors![0]).toMatchObject({ field: 'corrections.brand' });
    await verdicts(w, keeper, [verifyQuote(placeTask!.id, { corrections: { brand: null } })]);
    expect((await row<{ ref_id: string | null }>(w, branch!.id!))!.ref_id).toBeNull();
  });

  it('suspends a maintainer once more than half of ten verdicts it looked at again were overturned', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const records = (await submit(w, collector, Array.from({ length: 10 }, (_, n) => place({ name_en: `Place ${n}`, name_zh: undefined, address: `${n + 1} Example Street` })))).results;
    const { tasks } = await lease(w, keeper);
    await verdicts(w, keeper, tasks.map((task) => verifyQuote(task.id)));
    for (const [n, record] of records.entries()) {
      const status = n < 6 ? 'rejected' : 'verified';
      await w.json(`/api/admin/records/${record.id}/decide`, { method: 'POST', admin: true, json: { status, reason: 'Its menu shows a pizzeria.' } });
    }
    const tokens = await w.json<{ tokens: { label: string; status: string; quality: { checked: number; overturned: number } | null }[] }>('/api/admin/tokens?role=maintainer', { admin: true });
    expect(tokens.body.tokens[0]).toMatchObject({ status: 'suspended', quality: { checked: 10, overturned: 6 } });
  });

  it('shows what waits for a browser, and how long the oldest item has waited', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await maintainer(w, 'browser maintainer', { capabilities: ['browser'] });
    await submit(w, collector, [place({}, { source_url: 'https://example.com/blocked' }), review('#0')]);
    const [task] = (await lease(w, keeper, '?kind=place')).tasks;
    await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'cannot_open', reason: 'Bot check.' }]);
    const { body } = await w.json<{ kinds: { kind: string; needs_browser: number; oldest_review_at: string | null }[] }>('/api/admin/overview', { admin: true });
    expect(body.kinds.find((kind) => kind.kind === 'place')).toMatchObject({ needs_browser: 1, oldest_review_at: null });
  });
});

describe('what the server looks up', () => {
  it("finds a place's FSA business and delivery listings, without any score", async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await submit(w, collector, [place()]);
    w.pages['https://api.ratings.food.gov.uk/Establishments?address=W1D%206JW&pageSize=50'] = JSON.stringify({
      establishments: [
        { FHRSID: 9, BusinessName: 'Example Noodle House', BusinessType: 'Restaurant/Cafe/Canteen', AddressLine1: '12 Example Street', PostCode: 'W1D 6JW', RatingDate: '2026-03-01T00:00:00', RatingValue: '5' },
        { FHRSID: 8, BusinessName: 'Pizza Palace', BusinessType: 'Takeaway/sandwich shop', PostCode: 'W1D 6JW', RatingDate: '2025-01-01T00:00:00', RatingValue: '3' },
      ],
    });
    w.pages['https://uk.api.just-eat.io/discovery/uk/restaurants/enriched/bypostcode/W1D6JW'] = JSON.stringify({
      restaurants: [
        { name: 'Example Noodle House', uniqueName: 'example-noodle', address: { firstLine: '12 Example Street', postalCode: 'W1D 6JW' }, cuisines: [{ name: 'Chinese' }], isOpenNowForDelivery: true, rating: { starRating: 4.5 } },
        { name: 'Far Away', uniqueName: 'far', address: { firstLine: '1 Elsewhere', postalCode: 'N7 8AB' }, cuisines: [{ name: 'Pizza' }] },
      ],
    });
    expect(await gatherFacts(w.env.DB, new Date())).toBe(1);
    const [task] = (await lease(w, keeper)).tasks as unknown as { facts: { fsa: Record<string, unknown>; listings: Record<string, unknown>[] } }[];
    expect(task!.facts.fsa).toEqual({ id: '9', name: 'Example Noodle House', address: '12 Example Street', business_type: 'Restaurant/Cafe/Canteen', last_inspection: '2026-03-01', match: 'exact' });
    expect(task!.facts.listings).toEqual([
      { site: 'just-eat', name: 'Example Noodle House', address: '12 Example Street', cuisines: ['Chinese'], open_now: true, offline: false, url: 'https://www.just-eat.co.uk/restaurants-example-noodle/menu' },
    ]);
    expect(JSON.stringify(task!.facts)).not.toMatch(/RatingValue|starRating|rating/i);
    expect(await gatherFacts(w.env.DB, new Date())).toBe(0);
  });

  it('looks nothing up on Just Eat when the admin turns it off', async () => {
    const w = world();
    const { collector } = await people(w);
    await submit(w, collector, [place()]);
    await w.json('/api/admin/facts/settings', { method: 'PATCH', admin: true, json: { just_eat: false } });
    await gatherFacts(w.env.DB, new Date());
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((call) => String(call[0]));
    expect(calls.some((url) => url.includes('just-eat'))).toBe(false);
    expect(calls.some((url) => url.includes('ratings.food.gov.uk'))).toBe(true);
  });
});
