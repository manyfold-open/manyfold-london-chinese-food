import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  routeEvent,
  sanitizeMobileLinks,
  staggerWindowMinute,
  type InboundEvent,
  type RoomContext,
} from '@manyfold/narra-agent-kit';
import { isNarraGatewayEnabled, kickNarraGateway } from '@manyfold/narra-agent-kit/worker';
import { findRating } from '../src/shared/rating-guard.ts';
import { ensureSchema } from '../src/worker/db';
import { rebuildPlace } from '../src/worker/docs';
import workerDefault, {
  NarraMatrixSync,
  NarraRoomCoordinator,
} from '../src/worker/index';
import {
  formatPlaceUpdatesMessage,
  createLcfGatewayConfig,
  fastRespondLcf,
  LCF_AGENT_ID,
  LCF_AGENT_SPEC,
  LCF_MATRIX_ID,
  queryRecentOpenPlaceUpdates,
} from '../src/worker/narra/gateway';
import type { Env } from '../src/worker/types';
import { createD1 } from './d1';
import { fakeBucket, fakeImages, SITE } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeDOStorage {
  readonly data = new Map<string, unknown>();
  alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.data.has(key)) return undefined;
    return structuredClone(this.data.get(key)) as T;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list<T>(options: { prefix?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const prefix = options.prefix ?? '';
    for (const key of [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort()) {
      if (options.limit && out.size >= options.limit) break;
      out.set(key, structuredClone(this.data.get(key)) as T);
    }
    return out;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarmAt = typeof scheduledTime === 'number' ? scheduledTime : scheduledTime.getTime();
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

function createFakeNamespace<T extends { fetch(req: Request): Promise<Response>; alarm?(): Promise<void> }>(
  factory: (ctx: DurableObjectState) => T,
) {
  const storages = new Map<string, FakeDOStorage>();
  const instances = new Map<string, { instance: T; storage: FakeDOStorage }>();

  const ensure = (name: string) => {
    let entry = instances.get(name);
    if (!entry) {
      let storage = storages.get(name);
      if (!storage) {
        storage = new FakeDOStorage();
        storages.set(name, storage);
      }
      const state = {
        storage,
        id: { toString: () => name, equals: () => false },
        waitUntil: () => undefined,
        blockConcurrencyWhile: async <R>(fn: () => Promise<R>) => fn(),
      } as unknown as DurableObjectState;
      entry = { instance: factory(state), storage };
      instances.set(name, entry);
    }
    return entry;
  };

  const namespace = {
    idFromName: (name: string) => ({ toString: () => name, name } as unknown as DurableObjectId),
    get: (id: DurableObjectId) => {
      const name = String((id as unknown as { name?: string }).name ?? id.toString());
      return {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const req =
            input instanceof Request
              ? input
              : new Request(typeof input === 'string' ? input : input.toString(), init);
          return ensure(name).instance.fetch(req);
        },
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;

  return { namespace, instances };
}

function makeEnv(db: D1Database, extra: Partial<Env> = {}): Env {
  return {
    DB: db,
    MEDIA: fakeBucket(),
    IMAGES: fakeImages(),
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    ADMIN_PASSWORD: 'test-lcf-admin-password',
    PUBLIC_URL: 'https://app.manyfold.ai/london-chinese-food',
    BASE_PATH: '/london-chinese-food',
    NARRA_GATEWAY_ENABLED: 'off',
    NARRA_SYNC: 'off',
    NARRA_AGENT_ID: 'agt_agq657lc2b6qhffpaymugpmzsy',
    NARRA_MATRIX_ID: LCF_MATRIX_ID,
    ...extra,
  };
}

function makeEvent(overrides: Partial<InboundEvent> = {}): InboundEvent {
  const nowMs = Date.now();
  return {
    roomId: '!grp1:matrix.netmind.chat',
    chatType: 'group',
    eventId: '$ev_1',
    senderId: '@alice:matrix.netmind.chat',
    senderName: 'Alice',
    type: 'm.room.message',
    kind: 'text',
    msgtype: 'm.text',
    text: 'hi',
    timestampMs: nowMs,
    timeIso: new Date(nowMs).toISOString(),
    mentions: [],
    ...overrides,
  };
}

async function seedSamplePlaces(db: D1Database): Promise<void> {
  await ensureSchema(db);
  const now = new Date('2026-11-19T12:00:00Z');
  const ts1 = '2026-11-18T10:00:00Z';
  const ts2 = '2026-11-19T09:00:00Z';
  const tsClosed = '2026-11-19T11:00:00Z';

  await db.batch([
    db
      .prepare(
        `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho', 'Soho Noodle House W1D 6JW', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_00000000000000000001',
        'rec_lcf_00000000000000000001',
        'W1D 6JW|soho noodle',
        JSON.stringify({
          name_en: 'Soho Sichuan House',
          name_zh: '苏豪川菜馆',
          category: 'restaurant',
          cuisines: ['sichuan', 'noodles'],
          address: '12 Gerrard Street',
          postcode: 'W1D 6JW',
          outcode: 'W1D',
          borough_code: 'E09000033',
          lat: 51.5115,
          lng: -0.1316,
          trading: 'open',
        }),
        ts1,
        ts1,
        ts1,
        ts1,
      ),
    db
      .prepare(
        `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/ucl', 'Bloomsbury Dumplings WC1E 6BT', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_00000000000000000002',
        'rec_lcf_00000000000000000002',
        'WC1E 6BT|bloomsbury dumplings',
        JSON.stringify({
          name_en: 'Bloomsbury Dumpling House',
          name_zh: '布鲁姆斯伯里小笼包',
          category: 'restaurant',
          cuisines: ['dim-sum', 'shanghai'],
          address: '45 Gower Street',
          postcode: 'WC1E 6BT',
          outcode: 'WC1E',
          borough_code: 'E09000007',
          lat: 51.5245,
          lng: -0.1338,
          trading: 'open',
        }),
        ts2,
        ts2,
        ts2,
        ts2,
      ),
    db
      .prepare(
        `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/closed', 'Closed Place', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_00000000000000000003',
        'rec_lcf_00000000000000000003',
        'E14 5AB|closed place',
        JSON.stringify({
          name_en: 'Closed Canary Tea',
          name_zh: '已关闭茶铺',
          category: 'tea-drinks',
          cuisines: ['bubble-tea'],
          address: '1 Canada Square',
          postcode: 'E14 5AB',
          outcode: 'E14',
          borough_code: 'E09000030',
          lat: 51.5049,
          lng: -0.0195,
          trading: 'closed',
        }),
        tsClosed,
        tsClosed,
        tsClosed,
        tsClosed,
      ),
    db
      .prepare(
        `INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'menu', ?, ?, ?, 'verified', ?, 'https://example.com/ucl/menu', '小笼包 £8.50', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_menu_0000000000000001',
        'rec_lcf_00000000000000000002',
        'rec_lcf_00000000000000000002',
        'menu|bloomsbury|main',
        JSON.stringify({
          owner: 'rec_lcf_00000000000000000002',
          menu: 'main',
          source_kind: 'website',
          items: [
            { name_zh: '小笼包', name_en: 'Xiao long bao', price_pence: 850 },
            { name_zh: '虾饺', name_en: 'Har gow', price_pence: 680 },
          ],
        }),
        ts2,
        ts2,
        ts2,
        ts2,
      ),
    db
      .prepare(
        `INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'review', ?, ?, ?, 'verified', ?, 'https://example.com/ucl/rev_rated', ?, ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_rev_00000000000000002',
        'rec_lcf_00000000000000000002',
        'rec_lcf_00000000000000000002',
        'rev|2',
        JSON.stringify({
          place: 'rec_lcf_00000000000000000002',
          published_on: '2026-11',
          publication: 'Rated Blog',
          author: 'NoScoreFilter',
          source_type: 'blog',
          language: 'en',
          dishes: [],
        }),
        'Rated 4.5/5 stars by diners.',
        ts2,
        ts2,
        ts2,
        ts2,
      ),
    db
      .prepare(
        `INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'review', ?, ?, ?, 'verified', ?, 'https://example.com/ucl/rev1', ?, ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_rev_00000000000000001',
        'rec_lcf_00000000000000000002',
        'rec_lcf_00000000000000000002',
        'rev|1',
        JSON.stringify({
          place: 'rec_lcf_00000000000000000002',
          published_on: '2026-10',
          publication: 'London Eater',
          author: 'Grace Dent',
          source_type: 'critic',
          language: 'en',
          dishes: [{ name: 'Xiao long bao', canonical: '小笼包' }],
        }),
        'Thin-skinned soup dumplings bursting with hot savoury broth.',
        ts2,
        ts2,
        ts2,
        ts2,
      ),
  ]);

  await rebuildPlace(db, 'rec_lcf_00000000000000000001', now);
  await rebuildPlace(db, 'rec_lcf_00000000000000000002', now);
  await rebuildPlace(db, 'rec_lcf_00000000000000000003', now);
}

describe('manyfold-london-chinese-food Narra gateway', () => {
  it('1. stays completely off (0 external/D1/DO calls) when NARRA_GATEWAY_ENABLED is off', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);

    const dbSpy = {
      exec: vi.fn(async () => ({ count: 0, duration: 0 })),
      prepare: vi.fn(() => {
        throw new Error('DB should not be queried when disabled');
      }),
    } as unknown as D1Database;
    const doFetchSpy = vi.fn(async () => Response.json({ ok: true }));
    const ns = {
      idFromName: (n: string) => n as unknown as DurableObjectId,
      get: () => ({ fetch: doFetchSpy }),
    } as unknown as DurableObjectNamespace;

    const env = makeEnv(dbSpy, {
      NARRA_GATEWAY_ENABLED: 'off',
      NARRA_SYNC: 'on',
      NARRA_AGENT_TOKEN: 'narra_tok_should_not_run',
      NARRA_SYNC_DO: ns,
      NARRA_ROOM_DO: ns,
    });

    expect(isNarraGatewayEnabled(env)).toBe(false);
    const kick = await kickNarraGateway(env, createLcfGatewayConfig({ fetchImpl: fetchSpy as unknown as typeof fetch }));
    expect(kick).toEqual({ enabled: false, syncKicked: false, syncRunning: false, broadcast: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(doFetchSpy).not.toHaveBeenCalled();

    // Real scheduled handler runs existing maintenance cron cleanly even when gateway is off.
    const realDb = createD1();
    await ensureSchema(realDb);
    const scheduledEnv = makeEnv(realDb, {
      NARRA_GATEWAY_ENABLED: 'off',
      NARRA_AGENT_TOKEN: 'narra_tok_should_not_run',
      NARRA_SYNC_DO: ns,
      NARRA_ROOM_DO: ns,
    });
    const pending: Promise<unknown>[] = [];
    await workerDefault.scheduled(
      { cron: '*/5 * * * *', scheduledTime: Date.now() } as ScheduledController,
      scheduledEnv,
      { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(doFetchSpy).not.toHaveBeenCalled();
  });

  it('2. strictly protects /api/admin/gateway/status behind ADMIN_PASSWORD and redacts secrets', async () => {
    const db = createD1();
    const NARRA_SECRET = 'narra_secret_should_never_leak_999';
    const MATRIX_SECRET = 'syt_matrix_should_never_leak_888';
    const A2A_SECRET = 'a2a_secret_should_never_leak_777';

    // Unset ADMIN_PASSWORD -> closed (503)
    const closedRes = await workerDefault.fetch(
      new Request(`${SITE}/api/admin/gateway/status`),
      makeEnv(db, { ADMIN_PASSWORD: '' }),
      {} as ExecutionContext,
    );
    expect(closedRes.status).toBe(503);

    const env = makeEnv(db, {
      ADMIN_PASSWORD: 'super-secret-admin-pw',
      NARRA_AGENT_TOKEN: NARRA_SECRET,
      MATRIX_ACCESS_TOKEN: MATRIX_SECRET,
      MANYFOLD_A2A_TOKEN: A2A_SECRET,
    });

    // Unauthenticated -> 401
    const unauthRes = await workerDefault.fetch(
      new Request(`${SITE}/api/admin/gateway/status`),
      env,
      {} as ExecutionContext,
    );
    expect(unauthRes.status).toBe(401);

    // Wrong password -> 401
    const wrongRes = await workerDefault.fetch(
      new Request(`${SITE}/api/admin/gateway/status`, {
        headers: { 'x-admin-password': 'wrong-password' },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(wrongRes.status).toBe(401);

    // Authenticated via mounted BASE_PATH -> 200 and zero secrets leaked
    const okRes = await workerDefault.fetch(
      new Request('https://app.manyfold.ai/london-chinese-food/api/admin/gateway/status', {
        headers: { 'x-admin-password': 'super-secret-admin-pw' },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(okRes.status).toBe(200);
    const json = (await okRes.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      enabled: false,
      syncEnabled: false,
      agentId: 'lcf-guide',
      matrixId: LCF_MATRIX_ID,
      config: {
        NARRA_GATEWAY_ENABLED: 'off',
        NARRA_SYNC: 'off',
        hasNarraAgentToken: true,
        hasMatrixAccessToken: true,
      },
    });
    const rawText = JSON.stringify(json);
    expect(rawText).not.toContain(NARRA_SECRET);
    expect(rawText).not.toContain(MATRIX_SECRET);
    expect(rawText).not.toContain(A2A_SECRET);
  });

  it('3. routes Chinese food queries in en/zh-Hant/zh-Hans and blocks off-topic domains', async () => {
    const groupCtx = (overrides: Partial<RoomContext> = {}): RoomContext => ({
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
      ...overrides,
    });

    const hitEn = await routeEvent(
      makeEvent({ text: 'Any good dim sum or Sichuan restaurant near Chinatown?' }),
      groupCtx(),
      LCF_AGENT_SPEC,
    );
    expect(hitEn.shouldReply).toBe(true);
    expect(hitEn.detectedLang).toBe('en');

    const hitHant = await routeEvent(
      makeEvent({ text: '倫敦中國城有什麼推薦的火鍋或川菜嗎？' }),
      groupCtx(),
      LCF_AGENT_SPEC,
    );
    expect(hitHant.shouldReply).toBe(true);
    expect(hitHant.detectedLang).toBe('zh-Hant');

    const hitHans = await routeEvent(
      makeEvent({ text: '伦敦中国城附近有什么好吃的火锅或者奶茶店吗？' }),
      groupCtx(),
      LCF_AGENT_SPEC,
    );
    expect(hitHans.shouldReply).toBe(true);
    expect(hitHans.detectedLang).toBe('zh-Hans');

    for (const offTopic of [
      'Draw a tarot card for my career please',
      '幫我求一籤看看今天運勢',
      'Any Boots voucher code or promo code?',
      'What is today AI news in AI in 5?',
      'We paid £80 at a restaurant in London, split 4 ways',
      'What pop-up market is on in London this weekend?',
      'Any new UK visa policy changes or AI hackathons?',
    ]) {
      const dec = await routeEvent(makeEvent({ text: offTopic }), groupCtx(), LCF_AGENT_SPEC);
      expect(dec.shouldReply, offTopic).toBe(false);
    }
  });

  it('4. fastRespondLcf queries D1 places/dishes in zh-Hant/zh-Hans/en with bare URLs and NO ratings', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };

    // Greetings in all 3 scripts
    const hiHant = await fastRespondLcf(
      env,
      makeEvent({ text: '妳好' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
    );
    expect(hiHant).toContain('倫敦中餐地圖');
    expect(hiHant).not.toMatch(/[伦图]/);

    const hiHans = await fastRespondLcf(
      env,
      makeEvent({ text: '你好' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hans', shouldQuote: false },
      emptyMem,
    );
    expect(hiHans).toContain('伦敦中餐地图');
    expect(hiHans).not.toMatch(/[倫圖幫]/);

    // Dish + campus query in zh-Hant
    const dishHant = await fastRespondLcf(
      env,
      makeEvent({ text: 'UCL 附近哪裡有小籠包？' }),
      { shouldReply: true, tier: 1, reason: 'domain_match', confidence: 0.9, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
    );
    expect(dishHant).toBeTruthy();
    expect(dishHant).toContain('Bloomsbury Dumpling House');
    expect(dishHant).toContain('https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000002');
    expect(dishHant).not.toMatch(/\[[^\]]+\]\(https?:\/\//);
    expect(findRating(dishHant!)).toBeNull();

    // Cuisine + area query in zh-Hans
    const areaHans = await fastRespondLcf(
      env,
      makeEvent({ text: '中国城附近有什么川菜馆？' }),
      { shouldReply: true, tier: 1, reason: 'domain_match', confidence: 0.9, detectedLang: 'zh-Hans', shouldQuote: false },
      emptyMem,
    );
    expect(areaHans).toBeTruthy();
    expect(areaHans).toContain('Soho Sichuan House');
    expect(areaHans).toContain('https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001');
    expect(findRating(areaHans!)).toBeNull();

    // Place detail query in English (closed places still excluded from near/dish lists; detail shows menu & rating-free review)
    const detailEn = await fastRespondLcf(
      env,
      makeEvent({ text: 'Tell me about Bloomsbury Dumpling House' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'en', shouldQuote: false },
      emptyMem,
    );
    expect(detailEn).toContain('£8.50');
    expect(detailEn).toContain('On the menu at 2026-11-19');
    expect(detailEn).toContain('Grace Dent');
    expect(detailEn).not.toContain('4.5/5');
    expect(detailEn).not.toContain('NoScoreFilter');
    expect(detailEn).toContain('https://app.manyfold.ai/london-chinese-food/en/place/rec_lcf_00000000000000000002');
    expect(findRating(detailEn!)).toBeNull();
  });

  it('5. fetchUpdates excludes closed places, preserves no-ratings invariant, and kickNarraGateway dedupes staggered broadcasts', async () => {
    const db = createD1();
    await seedSamplePlaces(db);

    const openUpdates = await queryRecentOpenPlaceUpdates(makeEnv(db), '2026-11-17T00:00:00Z', 3);
    expect(openUpdates.map((u) => u.id)).toEqual([
      'rec_lcf_00000000000000000002',
      'rec_lcf_00000000000000000001',
    ]);
    // Closed place MUST NOT appear in updates!
    expect(openUpdates.some((u) => u.id === 'rec_lcf_00000000000000000003')).toBe(false);

    const roomMatch = '!lcf_bcast:matrix.netmind.chat';
    const slot = staggerWindowMinute(LCF_AGENT_ID, roomMatch, 60);
    const nowDate = new Date('2026-11-19T12:00:00.000Z');
    nowDate.setUTCMinutes(slot, 0, 0);
    const nowMs = nowDate.getTime();

    const sentPayloads: Array<{ roomId: string; text: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/agent-runtime/chat/send')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { room_id: string; text: string };
        sentPayloads.push({ roomId: body.room_id, text: body.text });
        return Response.json({ status: 'ok', data: { event_id: `$bc_${sentPayloads.length}` } });
      }
      return new Response('not found', { status: 404 });
    });

    let env!: Env;
    const syncHandle = createFakeNamespace((ctx) => new NarraMatrixSync(ctx, env));
    const roomHandle = createFakeNamespace((ctx) => new NarraRoomCoordinator(ctx, env));

    env = makeEnv(db, {
      NARRA_GATEWAY_ENABLED: 'on',
      NARRA_SYNC: 'off',
      NARRA_AGENT_TOKEN: 'narra_lcf_bcast_tok',
      NARRA_SYNC_DO: syncHandle.namespace,
      NARRA_ROOM_DO: roomHandle.namespace,
    });

    // Seed sync DO with roomIds
    const syncStub = syncHandle.namespace.get(syncHandle.namespace.idFromName('narra'));
    await syncStub.fetch('https://narra-sync/kick', { method: 'POST' });
    await syncHandle.instances.get('narra')!.storage.put('roomIds', [roomMatch]);

    const cfg = createLcfGatewayConfig({
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => nowMs,
    });

    const kick1 = await kickNarraGateway(env, cfg);
    expect(kick1.enabled).toBe(true);
    expect(kick1.broadcast?.sent).toHaveLength(1);
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]!.text).toContain('https://app.manyfold.ai/london-chinese-food/en/place/rec_lcf_00000000000000000002');
    expect(sentPayloads[0]!.text).not.toContain('Closed Canary Tea');
    expect(findRating(sentPayloads[0]!.text)).toBeNull();

    // Second kick dedupes via D1 narra_broadcast_log
    const kick2 = await kickNarraGateway(env, cfg);
    expect(kick2.broadcast?.sent).toHaveLength(0);
    expect(sentPayloads).toHaveLength(1);
  });

  it('6. NarraRoomCoordinator falls back cleanly to Manyfold A2A when D1 has no match and sanitizes links', async () => {
    const db = createD1();
    await ensureSchema(db);
    const nowMs = Date.now();
    const sentTexts: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://a2a.lcf.test/rpc') {
        const sse = `data: ${JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {
            kind: 'status-update',
            status: {
              state: 'completed',
              message: {
                role: 'agent',
                parts: [
                  {
                    kind: 'text',
                    text: 'Try checking [London Chinese Food](https://app.manyfold.ai/london-chinese-food/en/guides) for regional dining guides.',
                  },
                ],
              },
            },
          },
        })}\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (url.endsWith('/api/agent-runtime/chat/send')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { text: string };
        sentTexts.push(body.text);
        return Response.json({ status: 'ok', data: { event_id: '$a2a_1' } });
      }
      return new Response('not found', { status: 404 });
    });

    vi.stubGlobal('fetch', fetchMock);

    const env = makeEnv(db, {
      NARRA_GATEWAY_ENABLED: 'on',
      NARRA_SYNC: 'off',
      NARRA_AGENT_TOKEN: 'narra_tok_a2a_test',
      MANYFOLD_A2A_URL: 'https://a2a.lcf.test/rpc',
      MANYFOLD_A2A_TOKEN: 'a2a_secret_lcf',
    });

    const roomHandle = createFakeNamespace((ctx) => new NarraRoomCoordinator(ctx, env));
    const roomId = '!dm_a2a:matrix.netmind.chat';
    const stub = roomHandle.namespace.get(roomHandle.namespace.idFromName(roomId));

    await stub.fetch('https://narra-room/events', {
      method: 'POST',
      body: JSON.stringify({
        roomId,
        chatType: 'dm',
        events: [
          {
            event_id: '$ev_a2a',
            sender: '@alice:matrix.netmind.chat',
            type: 'm.room.message',
            origin_server_ts: nowMs,
            content: { msgtype: 'm.text', body: 'Do you have a regional food guide for regional cuisines?' },
          },
        ],
      }),
    });

    // Wait past 1.8s BurstCoalescer debounce using real Date.now() clock inside NarraRoomCoordinator
    await new Promise((resolve) => setTimeout(resolve, 1_900));
    await roomHandle.instances.get(roomId)!.instance.alarm();

    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]).toBe(
      sanitizeMobileLinks(
        'Try checking [London Chinese Food](https://app.manyfold.ai/london-chinese-food/en/guides) for regional dining guides.',
      ),
    );
    expect(sentTexts[0]).not.toMatch(/\[[^\]]+\]\(https?:\/\//);
    expect(sentTexts[0]).toContain('https://app.manyfold.ai/london-chinese-food/en/guides');
  });

  it('7. converts Simplified place/dish names like 锦里 -> 錦里 in zh-Hant and strips multi-word/sibling @mentions', async () => {
    const db = createD1();
    await ensureSchema(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:30:00Z';

    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/jinli', 'Jinli Soho W1D 6JJ', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000099',
          'rec_lcf_00000000000000000099',
          'W1D 6JJ|jinli',
          JSON.stringify({
            name_en: 'Jinli',
            name_zh: '锦里',
            category: 'restaurant',
            cuisines: ['sichuan'],
            address: '4 Leicester Street',
            postcode: 'W1D 6JJ',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5112,
            lng: -0.1305,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'menu', ?, ?, ?, 'verified', ?, 'https://example.com/jinli/menu', '担担面 £9.80', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_menu_0000000000000099',
          'rec_lcf_00000000000000000099',
          'rec_lcf_00000000000000000099',
          'menu|jinli|main',
          JSON.stringify({
            owner: 'rec_lcf_00000000000000000099',
            menu: 'main',
            source_kind: 'website',
            items: [
              { name_zh: '担担面', name_en: 'Dan dan noodles', price_pence: 980 },
              { name_zh: '水煮鱼', name_en: 'Sichuan boiled fish', price_pence: 1850 },
            ],
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000099', now);

    const env = makeEnv(db);
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };

    // Area + cuisine query in zh-Hant with multi-word & sibling mentions
    const listHant = await fastRespondLcf(
      env,
      makeEvent({ text: '@London Chinese Food @AI in 5 @問一籤 倫敦中國城有什麼川菜嗎？' }),
      { shouldReply: true, tier: 1, reason: 'mention', confidence: 0.95, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
    );
    expect(listHant).toBeTruthy();
    expect(listHant).toContain('Jinli / 錦里');
    expect(listHant).not.toContain('锦里');

    // Direct Traditional Chinese lookup of 錦里 against Simplified D1 record 锦里
    const detailHant = await fastRespondLcf(
      env,
      makeEvent({ text: '@倫敦中餐地圖 @Manyfold Data @Spotted London 請問錦里在哪裡？' }),
      { shouldReply: true, tier: 0, reason: 'mention', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
    );
    expect(detailHant).toBeTruthy();
    expect(detailHant).toContain('Jinli / 錦里');
    expect(detailHant).toContain('擔擔麵');
    expect(detailHant).toContain('水煮魚');
    expect(detailHant).not.toContain('锦里');
    expect(detailHant).not.toContain('担担面');
    expect(detailHant).not.toContain('水煮鱼');

    // Bare mention of multi-word name falls back cleanly to greeting instead of treating "Chinese Food" as query
    const mentionOnly = await fastRespondLcf(
      env,
      makeEvent({ text: '@London Chinese Food @塔羅大師 @Penny @Quidpaw' }),
      { shouldReply: true, tier: 0, reason: 'mention', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
    );
    expect(mentionOnly).toContain('倫敦中餐地圖小幫手');

    // zh-Hans preserves Simplified 锦里
    const listHans = await fastRespondLcf(
      env,
      makeEvent({ text: '@伦敦中餐地图 伦敦中国城有什么川菜？' }),
      { shouldReply: true, tier: 1, reason: 'mention', confidence: 0.95, detectedLang: 'zh-Hans', shouldQuote: true },
      emptyMem,
    );
    expect(listHans).toContain('Jinli / 锦里');

    // Broadcast updates in zh-Hant also convert 锦里 -> 錦里
    const updates = await queryRecentOpenPlaceUpdates(env, '2026-11-18T00:00:00Z', 3);
    const updateTextHant = formatPlaceUpdatesMessage(env, updates, 'zh-Hant');
    expect(updateTextHant).toContain('Jinli / 錦里');
    expect(updateTextHant).not.toContain('锦里');
  });
});
