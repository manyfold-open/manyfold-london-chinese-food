import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionToken } from '../src/worker/admin';
import { ADMIN, join, lease, maintainer, menu, NOW_ISO, place, review, row, SITE, submit, tasksOf, verdicts, verifyQuote, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const standingsMatchRecords = async (w: World) => {
  // Every standings row equals a count of its token's records: no change slipped past moveStanding.
  const { results } = await w.env.DB.prepare(
    `SELECT s.token_id, s.kind, s.verified, s.rejected, s.merged, s.stale,
       (SELECT COUNT(*) FROM records r WHERE r.submitted_by = s.token_id AND r.kind = s.kind AND r.status IN ('verified', 'applied')) AS v,
       (SELECT COUNT(*) FROM records r WHERE r.submitted_by = s.token_id AND r.kind = s.kind AND r.status = 'rejected') AS j,
       (SELECT COUNT(*) FROM records r WHERE r.submitted_by = s.token_id AND r.kind = s.kind AND r.status = 'merged') AS m,
       (SELECT COUNT(*) FROM records r WHERE r.submitted_by = s.token_id AND r.kind = s.kind AND r.status = 'stale') AS t
     FROM standings s`,
  ).all<{ verified: number; rejected: number; merged: number; stale: number; v: number; j: number; m: number; t: number }>();
  for (const entry of results) expect([entry.verified, entry.rejected, entry.merged, entry.stale]).toEqual([entry.v, entry.j, entry.m, entry.t]);
};

/** A collector that has asked for its standing (so it has standings rows) and a maintainer. */
async function people(w: World) {
  const collector = await join(w, 'collector');
  for (const focus of ['places', 'reviews-en', 'menus']) await w.call(`/api/skill?focus=${focus}`, { token: collector });
  return { collector, keeper: await maintainer(w) };
}

describe('the admin API', () => {
  it('stays closed without a password, refuses a wrong one, and issues a maintainer token once', async () => {
    const closed = world({ ADMIN_PASSWORD: '' });
    expect((await closed.json('/api/admin/overview', { admin: true })).status).toBe(503);
    const w = world();
    expect((await w.json('/api/admin/overview', { headers: { 'x-admin-password': 'nope' } })).status).toBe(401);
    const { status, body } = await w.json<{ token: string; kinds: string[] }>('/api/admin/tokens', { method: 'POST', admin: true, json: { label: 'photo checker', kinds: ['photo'] } });
    expect(status).toBe(201);
    expect(body).toMatchObject({ kinds: ['photo'] });
    const list = await w.json<{ tokens: Record<string, unknown>[] }>('/api/admin/tokens', { admin: true });
    expect(JSON.stringify(list.body)).not.toContain(body.token);
    expect(ADMIN).toBeTruthy();
  });

  it('keeps the console signed in with a session cookie, never the password', async () => {
    const w = world();
    expect((await w.json('/api/admin/session', { method: 'POST', headers: { 'x-admin-password': 'nope' } })).status).toBe(401);
    const signedIn = await w.call('/api/admin/session', { method: 'POST', admin: true });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^lcf_admin=\d{13}\.[A-Za-z0-9_-]{43}; Max-Age=1209600; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
    expect(cookie).not.toContain(ADMIN);
    const session = cookie.split(';')[0]!;
    expect((await w.call('/api/admin/session', { headers: { cookie: session } })).status).toBe(200);
    expect((await w.call('/api/admin/overview', { headers: { cookie: session } })).status).toBe(200);
    // A change needs the site's own origin: the browser sends one with every POST it makes.
    const change = { method: 'POST', json: { label: 'from the console' }, headers: { cookie: session } };
    expect((await w.call('/api/admin/tokens', { ...change, headers: { ...change.headers, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await w.call('/api/admin/tokens', { ...change, headers: { ...change.headers, origin: SITE } })).status).toBe(201);
    // A forged, an expired, or another password's cookie opens nothing.
    const [expiry, signature] = session.slice('lcf_admin='.length).split('.');
    expect((await w.call('/api/admin/overview', { headers: { cookie: `lcf_admin=${Number(expiry) + 1}.${signature}` } })).status).toBe(401);
    expect((await w.call('/api/admin/overview', { headers: { cookie: `lcf_admin=${await sessionToken(ADMIN, Date.now() - 1000)}` } })).status).toBe(401);
    const changed = world({ ADMIN_PASSWORD: 'a new password' });
    expect((await changed.call('/api/admin/overview', { headers: { cookie: session } })).status).toBe(401);
    // Locking clears the cookie.
    const locked = await w.call('/api/admin/session', { method: 'DELETE', headers: { cookie: session } });
    expect(locked.headers.get('set-cookie')).toMatch(/^lcf_admin=; Max-Age=0; Path=\//);
  });

  it('counts wrong passwords per address, never the right one', async () => {
    const w = world();
    for (let i = 0; i < 40; i += 1) expect((await w.call('/api/admin/overview', { admin: true })).status).toBe(200);
    const guesser = { 'cf-connecting-ip': '192.0.2.66' };
    for (let i = 0; i < 20; i += 1) expect((await w.call('/api/admin/overview', { headers: { ...guesser, 'x-admin-password': `guess ${i}` } })).status).toBe(401);
    const locked = await w.call('/api/admin/overview', { headers: { ...guesser, 'x-admin-password': ADMIN } });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await w.call('/api/admin/overview', { admin: true })).status).toBe(200);
  });
});

describe('leasing', () => {
  it('never hands out a blocked task, a token its own record, or a kind it does not review', async () => {
    const w = world();
    w.pages['https://example.com/contact'] = '<p>Example Noodle House, 12 Example Street, London W1D 6JW.</p>';
    const { collector, keeper } = await people(w);
    const { results } = await submit(w, collector, [place(), review('#0')]);
    const photos = await maintainer(w, 'photo checker', { kinds: ['photo'] });
    expect((await lease(w, photos)).tasks).toEqual([]);
    const held = await lease(w, keeper);
    expect(held.tasks.map((task) => task.record.id)).toEqual([results[0]!.id]);
    expect(held.tasks[0]!.note).toContain('found this passage');
  });

  it('says why there is nothing to lease: the records are the maintainer’s own, or wait for their place', async () => {
    const w = world();
    const { keeper } = await people(w);
    await submit(w, keeper, [place(), review('#0')]);
    const own = (await w.json<{ tasks: unknown[]; note: string }>('/api/tasks', { token: keeper })).body;
    expect(own.tasks).toEqual([]);
    expect(own.note).toContain('1 open task is for records this token sent, and a maintainer never reviews its own');
    expect(own.note).toContain('1 wait for their place to be verified first, or for the record they duplicate to be decided.');
    const other = await maintainer(w, 'second maintainer');
    const leased = await lease(w, other);
    expect(leased.tasks).toHaveLength(1);
    expect((leased as unknown as { note?: string }).note).toBeUndefined();
    await verdicts(w, other, [{ task_id: leased.tasks[0]!.id, verdict: 'unsure', unsure_type: 'policy', reason: 'The rules do not say whether a canteen inside a college counts.' }]);
    const third = await maintainer(w, 'third maintainer');
    const after = (await w.json<{ tasks: unknown[]; note: string }>('/api/tasks', { token: third })).body;
    expect(after.tasks).toEqual([]);
    expect(after.note).toContain('1 wait for the site team, because a maintainer was unsure of them');
  });

  it('opens the children when the place is verified', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { results } = await submit(w, collector, [place(), review('#0'), menu('#0')]);
    const [task] = (await lease(w, keeper)).tasks;
    const outcome = await verdicts(w, keeper, [verifyQuote(task!.id)]);
    expect(outcome.results[0]).toMatchObject({ status: 'applied', record_status: 'verified' });
    expect((await tasksOf(w, results[1]!.id!))[0]!.status).toBe('open');
    const next = await lease(w, keeper);
    expect(next.tasks.map((leased) => leased.kind).sort()).toEqual(['menu', 'review']);
    expect(next.tasks[0]!.parent).toMatchObject({ id: results[0]!.id, kind: 'place' });
  });
});

describe('verdicts', () => {
  async function verifiedPlace(w: World, collector: string, keeper: string) {
    const { results } = await submit(w, collector, [place(), review('#0'), menu('#0', [{ name_zh: '油泼面', price_pence: 1280 }, { name_zh: '肉夹馍', price_pence: 650 }, { name_zh: '凉皮', price_pence: 700 }])]);
    const [task] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [verifyQuote(task!.id)]);
    return { placeId: results[0]!.id!, reviewId: results[1]!.id!, menuId: results[2]!.id! };
  }

  it('verifies an excerpt as it stands, accepts the same passage set right, and refuses another passage', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { reviewId } = await verifiedPlace(w, collector, keeper);
    const task = (await lease(w, keeper, '?kind=review')).tasks[0]!;
    const different = await verdicts(w, keeper, [{ task_id: task.id, verdict: 'verified', evidence: 'The service was slow and the dining room was cold.' }]);
    expect(different.results[0]!.errors![0]!.message).toContain('different passage');
    const exact = 'The biang biang noodles were wide as a belt, and slick with chilli oil; we came back the next week.';
    const fine = await verdicts(w, keeper, [{ task_id: task.id, verdict: 'verified', evidence: exact }]);
    expect(fine.results[0]!.status).toBe('applied');
    expect((await row<{ evidence: string }>(w, reviewId))!.evidence).toBe(exact);
  });

  it('patches a menu by index against the leased hash', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { menuId } = await verifiedPlace(w, collector, keeper);
    const task = (await lease(w, keeper, '?kind=menu')).tasks[0]!;
    const stale = await verdicts(w, keeper, [verifyQuote(task.id, { base_hash: 'nope', patches: { items: [{ index: 0, set: { price_pence: 1380 } }] }, evidence: '油泼面 £13.80' })]);
    expect(stale.results[0]!.errors![0]!.field).toBe('base_hash');
    const patched = await verdicts(w, keeper, [
      verifyQuote(task.id, { base_hash: task.record.hash, patches: { items: [{ index: 0, set: { price_pence: 1380 } }, { index: 2, remove: true }] }, evidence: '油泼面 £13.80' }),
    ]);
    expect(patched.results[0]!.status).toBe('applied');
    const items = JSON.parse((await row(w, menuId))!.data_json).items as { name_zh: string; price_pence: number }[];
    expect(items.map((item) => `${item.name_zh}${item.price_pence}`)).toEqual(['油泼面1380', '肉夹馍650']);
  });

  it('places a corrected postcode again', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { results } = await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [verifyQuote(task!.id, { corrections: { postcode: 'N7 8AB' } })]);
    expect(JSON.parse((await row(w, results[0]!.id!))!.data_json)).toMatchObject({ postcode: 'N7 8AB', borough: 'Islington', outcode: 'N7' });
  });

  it('withdraws the pending children of a rejected place, without counting against their collector', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { results } = await submit(w, collector, [place(), review('#0'), menu('#0')]);
    const [task] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'rejected', reason: 'There is no such place at that address.' }]);
    expect((await row(w, results[1]!.id!))!.status).toBe('withdrawn');
    expect((await tasksOf(w, results[1]!.id!))[0]!.status).toBe('cancelled');
    const standing = await w.json<{ standing: Record<string, { rejected: number }> }>('/api/me', { token: collector });
    expect(standing.body.standing.place!.rejected).toBe(1);
    expect(standing.body.standing.review!.rejected).toBe(0);
    await standingsMatchRecords(w);
  });

  it('refuses to reject over a page it could not read: that is unsure', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    await submit(w, collector, [place()]);
    const [task] = (await lease(w, keeper)).tasks;
    const refused = await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'rejected', reason: 'The page returned 403 Forbidden.' }]);
    expect(refused.results[0]!.errors![0]!.message).toContain('send verdict unsure with unsure_type cannot_open');
    const unsure = await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'unsure', unsure_type: 'cannot_open', reason: 'The page returned 403 Forbidden.' }]);
    expect(unsure.results[0]!.status).toBe('applied');
    const queue = await w.json<{ items: { type: string }[] }>('/api/admin/review', { admin: true });
    expect(queue.body.items.map((item) => item.type)).toEqual(['unsure']);
  });

  it('merges a duplicate place and moves its children to the one it duplicates', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { placeId } = await verifiedPlace(w, collector, keeper);
    const other = await join(w, 'other', '198.51.100.9');
    const { results } = await submit(w, other, [place({ postcode: 'W1D 5PG', name_en: 'Example Noodle Bar' }), review('#0', {}, { source_url: 'https://example.com/elsewhere', evidence: 'A different review of the same place, with its hand-pulled noodles.' })]);
    let task = (await lease(w, keeper)).tasks.find((leased) => leased.record.id === results[0]!.id)!;
    while (!task) task = (await lease(w, keeper)).tasks.find((leased) => leased.record.id === results[0]!.id)!;
    await verdicts(w, keeper, [{ task_id: task.id, verdict: 'duplicate', duplicate_of: placeId }]);
    const moved = await row<{ parent_id: string; root_id: string }>(w, results[1]!.id!);
    expect(moved).toMatchObject({ parent_id: placeId, root_id: placeId, status: 'pending' });
    expect((await tasksOf(w, results[1]!.id!))[0]!.status).toBe('open');
    await standingsMatchRecords(w);
  });

  it('applies a proposal in place, keeping the id and the old version in history', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { placeId } = await verifiedPlace(w, collector, keeper);
    const { results } = await submit(w, collector, [{ ...place({ trading: 'closed', closed_on: '2026-09' }), updates: placeId }]);
    const task = (await lease(w, keeper, '?kind=place')).tasks.find((leased) => leased.type === 'update')!;
    expect(task.target).toMatchObject({ id: placeId });
    const outcome = await verdicts(w, keeper, [verifyQuote(task.id)]);
    expect(outcome.results[0]).toMatchObject({ status: 'applied', record_status: 'applied' });
    expect(JSON.parse((await row(w, placeId))!.data_json)).toMatchObject({ trading: 'closed', closed_on: '2026-09' });
    expect((await row(w, results[0]!.id!))!.status).toBe('applied');
    const history = await w.json<{ revisions: { action: string; before: { data: { trading: string } } }[] }>(`/api/admin/records/${placeId}`, { admin: true });
    expect(history.body.revisions.at(-1)).toMatchObject({ action: 'update', before: { data: { trading: 'open' } } });
    await standingsMatchRecords(w);
  });

  it('refuses a proposal whose target changed after it was made', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const { placeId } = await verifiedPlace(w, collector, keeper);
    await submit(w, collector, [{ ...place({ trading: 'closed' }), updates: placeId }]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await w.call(`/api/admin/records/${placeId}`, { method: 'PATCH', admin: true, json: { corrections: { phone: '020 7123 4567' } } });
    const task = (await lease(w, keeper, '?kind=place')).tasks.find((leased) => leased.type === 'update')!;
    const outcome = await verdicts(w, keeper, [verifyQuote(task.id)]);
    expect(outcome.results[0]!.errors![0]!.message).toContain('changed after this proposal');
  });

  it('suspends a collector once more than half of ten reviewed records are rejected', async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const postcodes = ['W1D 6JW', 'W1D 5PG', 'N7 8AB', 'E14 5AB'];
    const records = Array.from({ length: 10 }, (_, index) => place({ postcode: postcodes[index % 4], name_en: `Place ${index}` }));
    await submit(w, collector, records);
    const held = [...(await lease(w, keeper)).tasks];
    const items = held.map((task, index) => (index < 6 ? { task_id: task.id, verdict: 'rejected', reason: 'No such place on the page.' } : verifyQuote(task.id)));
    await verdicts(w, keeper, items);
    expect((await w.json('/api/me', { token: collector })).status).toBe(403);
  });
});

describe('undoing a token', () => {
  it("puts back what it decided, and what the server did because of it", async () => {
    const w = world();
    const { collector, keeper } = await people(w);
    const since = new Date(Date.now() - 1000).toISOString();
    const { results } = await submit(w, collector, [place(), review('#0')]);
    const [task] = (await lease(w, keeper)).tasks;
    await verdicts(w, keeper, [{ task_id: task!.id, verdict: 'rejected', reason: 'Not a Chinese restaurant.' }]);
    expect((await row(w, results[1]!.id!))!.status).toBe('withdrawn');
    const me = await w.json<{ token_id: string }>('/api/me', { token: keeper });
    const undone = await w.json<{ reverted: number; skipped: unknown[] }>(`/api/admin/tokens/${me.body.token_id}/revert`, { method: 'POST', admin: true, json: { since } });
    expect(undone.body).toMatchObject({ reverted: 2, skipped: [] });
    expect((await row(w, results[0]!.id!))!.status).toBe('pending');
    expect((await row(w, results[1]!.id!))!.status).toBe('pending');
    expect((await tasksOf(w, results[1]!.id!)).at(-1)!.status).toBe('blocked');
    await standingsMatchRecords(w);
  });
});

describe('flags', () => {
  it('queues a recheck of a live place with the reason, once', async () => {
    const w = world();
    const { collector } = await people(w);
    const id = (await submit(w, collector, [place()])).results[0]!.id!;
    await w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status: 'verified' } });
    const first = await w.json<{ queued: boolean }>(`/api/records/${id}/flag`, { method: 'POST', token: collector, json: { reason: 'Shuttered, sign gone', source_url: 'https://example.com/news' } });
    expect(first.body.queued).toBe(true);
    expect((await w.json<{ queued: boolean }>(`/api/records/${id}/flag`, { method: 'POST', token: collector, json: { reason: 'again' } })).body.queued).toBe(false);
    const recheck = (await tasksOf(w, id)).find((task) => task.type === 'recheck')!;
    expect(recheck.note).toContain('Shuttered, sign gone (https://example.com/news)');
    void NOW_ISO;
  });
});
