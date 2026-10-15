import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity, CrewMember } from '../src/shared/activity';
import { activityEvent, boardRows, checkedToday, recentlyUpdated, type ActivityEvent, type ActivityRow } from '../src/shared/activity';
import type { IndexEntry } from '../src/shared/place-doc';
import { join, menu, place, review, submit, world, type World } from './harness';

afterEach(() => vi.unstubAllGlobals());

const decide = (w: World, id: string, status: string, extra: Record<string, unknown> = {}) =>
  w.call(`/api/admin/records/${id}/decide`, { method: 'POST', admin: true, json: { status, ...extra } });

const cron = (w: World) => w.json('/api/admin/maintenance', { method: 'POST', admin: true });

/** A place with a review and a menu, all sent by one collector; `check` decides which pass. */
async function sent(w: World) {
  const token = await join(w, 'wok-scout-test');
  const { results } = await submit(w, token, [
    place(),
    review('#0', { dishes: [{ name: 'biang biang noodles', canonical: '油泼面' }], translation: '油泼面很好吃。' }),
    menu('#0', [
      { section: '面 Noodles', name_zh: '油泼面', name_en: 'Biang biang noodles', price_pence: 1280, canonical: '油泼面' },
      { section: '面 Noodles', name_zh: '臊子面', price_pence: 1150 },
      { section: '茶 Tea', name_en: 'Jasmine tea' },
    ]),
  ]);
  return { token, placeId: results[0]!.id!, reviewId: results[1]!.id!, menuId: results[2]!.id! };
}

describe('the arrivals board', () => {
  it('shows each check of a public record, newest first, with the day’s counts', async () => {
    const w = world();
    const { placeId, reviewId, menuId } = await sent(w);
    for (const id of [placeId, reviewId, menuId]) await decide(w, id, 'verified');
    await cron(w);
    const { status, body } = await w.json<Activity>('/api/activity');
    expect(status).toBe(200);
    expect(body.events.map((event) => [event.type, event.id])).toEqual([
      ['menu', menuId],
      ['quote', reviewId],
      ['place', placeId],
    ]);
    expect(body.events[0]).toMatchObject({ items: 2, by: 'Admin', place: { id: placeId, n: 'Example Noodle House' } });
    expect(body.events[1]!.quote).toMatchObject({ language: 'en', translation: '油泼面很好吃。' });
    expect(body.checked).toBe(3);
    // The collector sent today; the admin who checked is not an agent on shift.
    expect(body.agents).toBe(1);
  });

  it('never shows a record waiting for review, and drops one that stops being public', async () => {
    const w = world();
    const { placeId, reviewId, menuId } = await sent(w);
    await decide(w, placeId, 'verified');
    await cron(w);
    const first = (await w.json<Activity>('/api/activity')).body;
    expect(first.events.map((event) => event.id)).toEqual([placeId]);
    expect(JSON.stringify(first)).not.toContain(reviewId);
    expect(JSON.stringify(first)).not.toContain(menuId);

    await decide(w, reviewId, 'verified');
    await cron(w);
    expect((await w.json<Activity>('/api/activity')).body.events.map((event) => event.id)).toEqual([reviewId, placeId]);

    await decide(w, reviewId, 'rejected', { reason: 'The page does not say this.' });
    await cron(w);
    expect((await w.json<Activity>('/api/activity')).body.events.map((event) => event.id)).toEqual([placeId]);
  });

  it('carries no score, no rating and nothing to rank by', async () => {
    const w = world();
    const { placeId, reviewId } = await sent(w);
    for (const id of [placeId, reviewId]) await decide(w, id, 'verified');
    await cron(w);
    const text = await (await w.call('/api/activity')).text();
    expect(text).not.toMatch(/"(rating|score|stars|aggregate|sentiment|rank)[a-z_]*"/i);
  });

  it('makes an event only of a check of a record that is public now', () => {
    const entry = { id: 'rec_place', s: 'x', n: 'X', z: null, o: 'W1D', p: 0 } as IndexEntry;
    const row = (overrides: Partial<ActivityRow>): ActivityRow => ({
      revision: 1,
      record_id: 'rec_x',
      kind: 'review',
      action: 'verify',
      created_at: '2026-10-14T10:00:00.000Z',
      status: 'verified',
      place_id: 'rec_place',
      data: { publication: 'Time Out', language: 'en' },
      evidence: 'x'.repeat(200),
      ...overrides,
    });
    expect(activityEvent(row({ status: 'pending' }), entry, 'a')).toBeNull();
    expect(activityEvent(row({ status: 'rejected' }), entry, 'a')).toBeNull();
    expect(activityEvent(row({ action: 'submit' }), entry, 'a')).toBeNull();
    expect(activityEvent(row({}), null, 'a')).toBeNull();
    expect(activityEvent(row({}), entry, 'a')!.quote!.excerpt).toHaveLength(158);
    expect(activityEvent(row({ kind: 'illustration', place_id: null, data: { dish: '小笼包' } }), null, 'a')).toMatchObject({ type: 'art', dish: '小笼包', place: null });
    expect(activityEvent(row({ kind: 'photo' }), entry, 'a')).toMatchObject({ type: 'photo', first: true });
  });
});

describe('the crew', () => {
  it('names the agents at work this week with what passed, and no one with nothing', async () => {
    const w = world();
    const { placeId, reviewId } = await sent(w);
    await join(w, 'idle-scout', '198.51.100.9');
    for (const id of [placeId, reviewId]) await decide(w, id, 'verified');
    await cron(w);
    const { status, body } = await w.json<{ crew: CrewMember[] }>('/api/crew');
    expect(status).toBe(200);
    expect(body.crew).toEqual([expect.objectContaining({ label: 'wok-scout-test', role: 'collector', count: 2 })]);
  });
});

describe('the board’s lines', () => {
  const place = { id: 'rec_p', s: 'p', n: 'P', z: null, o: 'W1D' };
  const event = (at: string, overrides: Partial<ActivityEvent> = {}): ActivityEvent => ({ id: `rec_${at}`, at: `2026-10-15T${at}:00.000Z`, type: 'menu', by: 'a', place, items: 5, ...overrides });

  it('puts checks of one place and one kind made together on one line, counting them', () => {
    const rows = boardRows([event('10:20'), event('10:14', { items: 0 }), event('10:06', { items: 7 }), event('09:30'), event('09:29', { type: 'quote', items: undefined })]);
    // Three menus within a quarter of an hour of each other are one line; one checked later is its own.
    expect(rows.map((row) => [row.type, row.count, row.items])).toEqual([
      ['menu', 3, 12],
      ['menu', 1, 5],
      ['quote', 1, undefined],
    ]);
    expect(rows[0]!.at).toBe('2026-10-15T10:20:00.000Z');
    // Another place's check in between keeps them apart.
    const other = { ...place, id: 'rec_q' };
    expect(boardRows([event('10:20'), event('10:19', { place: other }), event('10:18')]).map((row) => row.count)).toEqual([1, 1, 1]);
  });

  it('counts the day only while it is that day in London, and never as a zero', () => {
    const activity = { day: '2026-10-15', checked: 23, agents: 4 };
    expect(checkedToday(activity, new Date('2026-10-15T22:30:00Z'))).toEqual({ checked: 23, agents: 4 });
    // 23:30 in London is still the 15th; half past midnight is the 16th.
    expect(checkedToday(activity, new Date('2026-10-15T23:30:00Z'))).toBeNull();
    expect(checkedToday({ ...activity, checked: 0 }, new Date('2026-10-15T12:00:00Z'))).toBeNull();
  });

  it('falls back to the public places whose page changed last', () => {
    const entry = (id: string, u: string, t = 'open') => ({ id, u, t }) as IndexEntry;
    const found = recentlyUpdated([entry('a', '2026-10-14T10:00:00Z'), entry('b', '2026-10-15T09:00:00Z'), entry('c', '2026-10-15T11:00:00Z', 'closed')], 5);
    expect(found.map((e) => e.id)).toEqual(['b', 'a']);
  });
});
