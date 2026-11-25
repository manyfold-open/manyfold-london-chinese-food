import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkersAiTriageModel,
  heuristicDomainScore,
  routeEvent,
  sanitizeMobileLinks,
  staggerWindowMinute,
  type InboundEvent,
  type RecallTurnResult,
  type RoomContext,
  type TriageDecision,
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
  buildLcfExtraEnvelopeFields,
  createLcfGatewayConfig,
  extractLocation,
  fastRespondLcf,
  formatPlaceUpdatesMessage,
  greetingReply,
  LCF_AGENT_ID,
  LCF_AGENT_SPEC,
  LCF_MATRIX_ID,
  lcfGatewayConfig,
  lcfThinkingMessage,
  parseRequestedLimit,
  pickQuickMealSpots,
  queryRecentOpenPlaceUpdates,
  resolveMemoryLocationHint,
  thanksReply,
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
          cuisines: ['noodles', 'dumplings', 'sichuan'],
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

    const dinner = makeEvent({ text: '晚上能吃啥' });
    const run = vi.fn();
    const env = { AI: { run } } as unknown as Env;
    const triageModel = createLcfGatewayConfig().triageModel?.(env);
    expect((await routeEvent(dinner, groupCtx(), LCF_AGENT_SPEC)).shouldReply).toBe(true);
    expect((await routeEvent(dinner, groupCtx(), LCF_AGENT_SPEC, { triageModel })).shouldReply).toBe(true);
    expect(run).not.toHaveBeenCalled();

    for (const offTopic of [
      'Draw a tarot card for my career please',
      '幫我求一籤看看今天運勢',
      'Any Boots voucher code or promo code?',
      'Boots 有什么非学生也能用的护肤优惠？',
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

    const dinner = makeEvent({ text: '晚上能吃啥' });
    const dinnerContext = { roomId: dinner.roomId, chatType: 'group' as const, members: [], recentHistory: [] };
    const dinnerDecision = await routeEvent(dinner, dinnerContext, LCF_AGENT_SPEC);
    expect(await fastRespondLcf(env, dinner, dinnerDecision, emptyMem, dinnerContext))
      .toBe('你在哪一帶？我幫你找附近的中餐。');

    const areaAnswer = makeEvent({ text: 'Soho 附近' });
    const peerContext: RoomContext = {
      roomId: areaAnswer.roomId, chatType: 'group', members: [],
      recentHistory: [{ eventId: '$spotted', senderId: '@agent-f9388b28:matrix.netmind.chat',
        isAgent: true, timestampMs: areaAnswer.timestampMs - 1000, text: '你下班后想去哪一带？' }],
    };
    const areaDecision = { ...dinnerDecision, shouldReply: true, reason: 'active_session' };
    expect(await fastRespondLcf(env, areaAnswer, areaDecision, emptyMem, peerContext)).toBe('[NO_REPLY]');

    const sichuan = makeEvent({
      text: '@London Chinese Food Soho 晚上有什麼川菜推薦？',
      mentions: [LCF_MATRIX_ID],
    });
    const sichuanDecision = await routeEvent(sichuan, dinnerContext, LCF_AGENT_SPEC);
    expect(await fastRespondLcf(env, sichuan, sichuanDecision, emptyMem, dinnerContext))
      .toContain('Soho Sichuan House / 蘇豪川菜館 (川菜 / 麵館');

    const mildDinner = makeEvent({ text: '那週五在 Soho 先吃個不辣的中餐，飯後附近有免費展嗎？' });
    const mildDecision = await routeEvent(mildDinner, dinnerContext, LCF_AGENT_SPEC);
    expect(mildDecision.shouldReply).toBe(true);
    const mildReply = await fastRespondLcf(env, mildDinner, mildDecision, emptyMem, dinnerContext);
    expect(mildReply).toContain('Soho');
    expect(mildReply).toContain('還沒核實哪些菜能做不辣');

    const oneRestaurant = makeEvent({ text: '先不算錢了，倫敦 Soho 有沒有一間可以吃不辣點心的中餐？' });
    const oneDecision = await routeEvent(oneRestaurant, dinnerContext, LCF_AGENT_SPEC);
    expect(oneDecision.shouldReply).toBe(true);
    const oneReply = await fastRespondLcf(env, oneRestaurant, oneDecision, emptyMem, dinnerContext);
    expect(oneReply).toContain('為你查到 1 間');
    expect(oneReply).toContain('還沒核實哪些菜能做不辣');
    expect(oneReply!.match(/https:\/\/app\.manyfold\.ai\/london-chinese-food\/zh\/place\//g)).toHaveLength(1);

    const preference = makeEvent({ eventId: '$mild-preference', text: '我平常不吃辣，點心通常比較合我胃口。' });
    const nextMeal = makeEvent({ text: '那 Soho 有沒有一間中餐可以推薦？' });
    const prefContext: RoomContext = {
      ...dinnerContext,
      recentHistory: [{
        eventId: preference.eventId, senderId: nextMeal.senderId, isAgent: false,
        timestampMs: nextMeal.timestampMs - 10_000, text: preference.text,
      }],
    };
    expect(await fastRespondLcf(env, preference, oneDecision, emptyMem, prefContext)).toBe('[NO_REPLY]');
    const prefReply = await fastRespondLcf(env, nextMeal, oneDecision, emptyMem, prefContext);
    expect(prefReply).toContain('還沒核實哪些菜能做不辣');
    const otherUser = { ...nextMeal, senderId: '@other:matrix.netmind.chat' };
    expect(await fastRespondLcf(env, otherUser, oneDecision, emptyMem, prefContext))
      .not.toContain('還沒核實哪些菜能做不辣');

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

    // @AI Tarot and @AI Fortune Stick mentions strip cleanly and multi-mention restaurant queries route properly
    const multiLcfCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
        { matrixId: '@agent-tarot:matrix.netmind.chat', displayName: 'AI Tarot', isAgent: true },
        { matrixId: '@agent-fortune:matrix.netmind.chat', displayName: 'AI Fortune Stick', isAgent: true },
      ],
      recentHistory: [],
    };
    const multiRes = await routeEvent(
      makeEvent({ text: '@AI Tarot @London Chinese Food 倫敦有哪些川菜餐廳或餐館？' }),
      multiLcfCtx,
      LCF_AGENT_SPEC,
    );
    expect(multiRes.shouldReply).toBe(true);
    expect(multiRes.reason).toBe('multi_mention_domain_match');

    const bareMultiMention = await fastRespondLcf(
      env,
      makeEvent({ text: '@AI Tarot @AI Fortune Stick @London Chinese Food' }),
      { shouldReply: true, tier: 0, reason: 'mention', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
    );
    expect(bareMultiMention).toContain('倫敦中餐地圖小幫手');

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

  it('8. returns [NO_REPLY] for unmentioned group active_session off-topic, casual chatter, and closings', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db, {
      MANYFOLD_A2A_URL: 'https://a2a.lcf.test/rpc',
      MANYFOLD_A2A_TOKEN: 'a2a_secret_lcf',
    });
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const roomMem = {
      userMemories: [],
      roomMemories: [
        {
          id: 'mem_lcf_1',
          scope: 'room' as const,
          agentId: LCF_AGENT_ID,
          roomId: '!grp1:matrix.netmind.chat',
          kind: 'fact' as const,
          key: 'default_area',
          value: 'Soho',
          createdAt: '2026-11-19T12:00:00Z',
          updatedAt: '2026-11-19T12:00:00Z',
        },
      ],
      promptSafeLines: [],
    };
    const activeDecision = {
      shouldReply: true,
      tier: 0 as const,
      reason: 'active_session',
      confidence: 0.95,
      detectedLang: 'zh-Hant' as const,
      shouldQuote: true,
    };

    // Anti-keywords include pop-up/exhibition/hackathon variants
    for (const kw of ['黑客松', '駭客松', 'hackathon', 'hackathons', '快閃', '快闪', '展覽', '展览', 'pop-up', 'popup', 'exhibition']) {
      expect(LCF_AGENT_SPEC.antiKeywords).toContain(kw);
    }

    // Off-topic pop-up / exhibition turn in unmentioned active_session -> [NO_REPLY]
    const offTopicReply = await fastRespondLcf(
      env,
      makeEvent({ text: '這週末倫敦有什麼免費快閃活動或展覽？' }),
      activeDecision,
      emptyMem,
    );
    expect(offTopicReply).toBe('[NO_REPLY]');

    // Casual chatter with zero food signals (even with room default_area memory & A2A configured) -> [NO_REPLY]
    const chatterReply = await fastRespondLcf(
      env,
      makeEvent({ text: '今天天氣真不錯，晚上想早點休息' }),
      activeDecision,
      roomMem,
    );
    expect(chatterReply).toBe('[NO_REPLY]');

    // Casual closings in unmentioned active_session -> [NO_REPLY], whereas explicit mention responds warmly
    expect(await fastRespondLcf(env, makeEvent({ text: '謝謝' }), activeDecision, emptyMem)).toBe('[NO_REPLY]');
    expect(await fastRespondLcf(env, makeEvent({ text: '晚安' }), activeDecision, emptyMem)).toBe('[NO_REPLY]');
    const explicitGoodnight = await fastRespondLcf(
      env,
      makeEvent({ text: '@lcf-guide 晚安' }),
      { ...activeDecision, reason: 'explicit_mention' },
      emptyMem,
    );
    expect(explicitGoodnight).toContain('倫敦中餐地圖小幫手');
    const explicitThanks = await fastRespondLcf(
      env,
      makeEvent({ text: '@lcf-guide 謝謝' }),
      { ...activeDecision, reason: 'explicit_mention' },
      emptyMem,
    );
    expect(explicitThanks).toBe(thanksReply('zh-Hant'));
    expect(explicitThanks).not.toContain('倫敦中餐地圖小幫手');

    // Genuine food follow-up in active_session still responds from D1
    const followUpReply = await fastRespondLcf(
      env,
      makeEvent({ text: 'UCL 附近呢？' }),
      activeDecision,
      emptyMem,
    );
    expect(followUpReply).toContain('Bloomsbury Dumpling House');
  });

  it('9. resolves UCL automatically from note_abcd1234 user memory on "附近有什麼川菜推薦？"', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);

    const noteMem: RecallTurnResult = {
      userMemories: [
        {
          id: 'mem_note_skip',
          scope: 'user',
          agentId: LCF_AGENT_ID,
          userId: '@alice:matrix.netmind.chat',
          originChatType: 'dm',
          kind: 'preference',
          key: 'note_00001111',
          value: '我不吃香菜',
          createdAt: '2026-11-19T11:50:00Z',
          updatedAt: '2026-11-19T11:50:00Z',
        },
        {
          id: 'mem_note_ucl',
          scope: 'user',
          agentId: LCF_AGENT_ID,
          userId: '@alice:matrix.netmind.chat',
          originChatType: 'dm',
          kind: 'preference',
          key: 'note_abcd1234',
          value: '我平常都在 UCL 附近活動，最愛吃川菜',
          createdAt: '2026-11-19T12:00:00Z',
          updatedAt: '2026-11-19T12:00:00Z',
        },
      ],
      roomMemories: [],
      promptSafeLines: [],
    };

    const hinted = resolveMemoryLocationHint(noteMem, 'zh-Hant', []);
    expect(hinted?.label).toBe('UCL');
    expect(hinted?.campus?.id).toBe('ucl');

    const exactNoteHint = resolveMemoryLocationHint(
      {
        userMemories: [
          {
            id: 'mem_note_exact',
            scope: 'user',
            agentId: LCF_AGENT_ID,
            userId: '@alice:matrix.netmind.chat',
            originChatType: 'dm',
            kind: 'preference',
            key: 'note',
            value: '常在 Soho 活動',
            createdAt: '2026-11-19T12:00:00Z',
            updatedAt: '2026-11-19T12:00:00Z',
          },
        ],
        roomMemories: [],
        promptSafeLines: [],
      },
      'zh-Hant',
      [],
    );
    expect(exactNoteHint?.label).toBe('Soho');

    const reply = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'dm', text: '附近有什麼川菜推薦？' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      noteMem,
    );
    expect(reply).toBeTruthy();
    expect(reply).toContain('UCL');
    expect(reply).toContain('Soho Sichuan House');
    expect(reply).toContain('https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001');
    expect(findRating(reply!)).toBeNull();
  });

  it('keeps the cuisine and distance origin on a Bank follow-up to a recent restaurant list', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const event = makeEvent({ eventId: '$bank', text: '離 Bank 近一點的有嗎？' });
    const context: RoomContext = {
      roomId: event.roomId, chatType: 'group', members: [],
      peers: [{ matrixId: '@agent-peer:matrix.netmind.chat', displayName: 'Spotted London' }],
      recentHistory: [
        { eventId: '$dinner', senderId: event.senderId, isAgent: false,
          text: '活動先放著，晚上想吃川菜，推薦兩家就好。', timestampMs: event.timestampMs - 2000 },
        { eventId: '$dinner-answer', senderId: LCF_MATRIX_ID, isAgent: true, isSelf: true,
          text: 'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001',
          timestampMs: event.timestampMs - 1000 },
      ],
    };
    expect(extractLocation(event.text, 'zh-Hant', [])?.label).toBe('Bank');
    expect(extractLocation('I need to change my bank account', 'en', [])).toBeNull();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(event.timestampMs);
    try {
      const decision = await routeEvent(event, context, LCF_AGENT_SPEC, { nowMs: event.timestampMs });
      expect(decision.independentGroupReply).toBe(true);
      const reply = await fastRespondLcf(makeEnv(db), event, decision,
        { userMemories: [], roomMemories: [], promptSafeLines: [] }, context);
      expect(reply).toContain('Bank');
      expect(reply).toContain('Soho Sichuan House');
      expect(reply).not.toContain('Bloomsbury Dumpling House');
    } finally {
      clock.mockRestore();
    }
  });

  it('10. resolves Soho on implicit eating prompt and returns [NO_REPLY] on unmentioned group bottom fallback', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
    };

    const implicitPrompt = '好餓喔，等下在 Soho 附近有沒有推薦吃的？';
    const loc = extractLocation(implicitPrompt, 'zh-Hant', []);
    expect(loc?.label).toBe('Soho');
    expect(loc?.point).toEqual({ lat: 51.5136, lng: -0.1365 });
    expect(loc?.km).toBe(1.0);
    expect(extractLocation('蘇豪附近有什麼吃的？', 'zh-Hant', [])?.label).toBe('Soho');

    const decision = await routeEvent(makeEvent({ text: implicitPrompt }), groupCtx, LCF_AGENT_SPEC);
    expect(decision.shouldReply).toBe(true);
    expect(decision.tier).toBe(1);
    expect(decision.detectedLang).toBe('zh-Hant');

    const reply = await fastRespondLcf(env, makeEvent({ text: implicitPrompt }), decision, emptyMem);
    expect(reply).toBeTruthy();
    expect(reply).not.toBe('[NO_REPLY]');
    expect(reply).toContain('Soho');
    expect(reply).toContain('Soho Sichuan House');
    expect(reply).not.toContain('Closed Canary Tea');
    expect(reply).toContain('https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001');
    expect(findRating(reply!)).toBeNull();

    // Past-tense anecdote in Soho is suppressed by router
    const anecdoteDecision = await routeEvent(
      makeEvent({ text: '昨晚在 Soho 吃火鍋吃超飽' }),
      groupCtx,
      LCF_AGENT_SPEC,
    );
    expect(anecdoteDecision.shouldReply).toBe(false);

    // Unmentioned group bottom fallback returns [NO_REPLY] when zero places match (both without and with A2A)
    const emptyDb = createD1();
    await ensureSchema(emptyDb);
    const emptyEnvNoA2a = makeEnv(emptyDb);
    const emptyEnvWithA2a = makeEnv(emptyDb, {
      MANYFOLD_A2A_URL: 'https://a2a.lcf.test/rpc',
      MANYFOLD_A2A_TOKEN: 'a2a_secret_lcf',
    });
    const unmentionedDecision = {
      shouldReply: true,
      tier: 1 as const,
      reason: 'domain_match',
      confidence: 0.72,
      detectedLang: 'zh-Hant' as const,
      shouldQuote: true,
    };

    expect(
      await fastRespondLcf(
        emptyEnvNoA2a,
        makeEvent({ text: implicitPrompt }),
        unmentionedDecision,
        emptyMem,
      ),
    ).toBe('[NO_REPLY]');
    expect(
      await fastRespondLcf(
        emptyEnvNoA2a,
        makeEvent({ text: '倫敦哪裡有好吃的？' }),
        unmentionedDecision,
        emptyMem,
      ),
    ).toBe('[NO_REPLY]');
    expect(
      await fastRespondLcf(
        emptyEnvWithA2a,
        makeEvent({ text: implicitPrompt }),
        unmentionedDecision,
        emptyMem,
      ),
    ).toBe('[NO_REPLY]');

    // Explicit mention on the same empty DB still returns helpful prompt (or null for A2A)
    const explicitEmptyReply = await fastRespondLcf(
      emptyEnvNoA2a,
      makeEvent({ text: `@lcf-guide ${implicitPrompt}` }),
      { ...unmentionedDecision, tier: 0, reason: 'explicit_mention' },
      emptyMem,
    );
    expect(explicitEmptyReply).toContain('倫敦中餐地圖目前還沒有找到符合條件的營業中店家');
    expect(
      await fastRespondLcf(
        emptyEnvWithA2a,
        makeEvent({ text: `@lcf-guide ${implicitPrompt}` }),
        { ...unmentionedDecision, tier: 0, reason: 'explicit_mention' },
        emptyMem,
      ),
    ).toBeNull();
  });

  it('11. wins confidently on implicit London hunger/food queries while staying silent on London sightseeing/pop-up queries', async () => {
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
    };

    for (const kw of [
      '逛逛',
      '逛街',
      '好去處',
      '好去处',
      '哪裡好玩',
      '哪里好玩',
      '市集',
      '展覽',
      '展览',
      '快閃',
      '快闪',
      'pop-up',
      'exhibition',
      'sample sale',
    ]) {
      expect(LCF_AGENT_SPEC.antiKeywords, kw).toContain(kw);
    }

    const aiRunSpy = vi.fn(async () => ({ response: '{"score":0.1,"reason":"unexpected_ai_call"}' }));
    const triageModel = createWorkersAiTriageModel({ run: aiRunSpy });

    const hungryEvent = makeEvent({ text: '好餓喔，等下在 Soho 附近有沒有推薦吃的？' });
    const hungryHeuristic = heuristicDomainScore(hungryEvent, LCF_AGENT_SPEC, groupCtx);
    expect(hungryHeuristic).toBeGreaterThanOrEqual(0.78);

    const hungryTriage = await triageModel.score({
      event: hungryEvent,
      context: groupCtx,
      spec: LCF_AGENT_SPEC,
      detectedLang: 'zh-Hant',
    });
    expect(hungryTriage.score).toBeGreaterThanOrEqual(0.9);
    expect(hungryTriage.reason).toBe('domain_match');

    const hungryDecision = await routeEvent(hungryEvent, groupCtx, LCF_AGENT_SPEC, { triageModel });
    expect(hungryDecision.shouldReply).toBe(true);
    expect(hungryDecision.confidence).toBeGreaterThanOrEqual(0.9);

    const sightseeingEvent = makeEvent({ text: '這週末不知道帶朋友去倫敦哪裡逛逛比較特別' });
    const sightseeingHeuristic = heuristicDomainScore(sightseeingEvent, LCF_AGENT_SPEC, groupCtx);
    expect(sightseeingHeuristic).toBeLessThan(0.55);

    const sightseeingTriage = await triageModel.score({
      event: sightseeingEvent,
      context: groupCtx,
      spec: LCF_AGENT_SPEC,
      detectedLang: 'zh-Hant',
    });
    expect(sightseeingTriage.score).toBeLessThan(0.55);

    const sightseeingDecision = await routeEvent(sightseeingEvent, groupCtx, LCF_AGENT_SPEC, { triageModel });
    expect(sightseeingDecision.shouldReply).toBe(false);
    expect(aiRunSpy).not.toHaveBeenCalled();
  });

  it('12. inherits UCL + noodles on unmentioned active_session tube follow-ups and sorts by nearest Tube station', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:45:00Z';

    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/gordon-noodles', 'Gordon Square Noodles WC1H 0PD', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000101',
          'rec_lcf_00000000000000000101',
          'WC1H 0PD|gordon square noodles',
          JSON.stringify({
            name_en: 'Gordon Square Noodles',
            name_zh: '戈登广场面馆',
            category: 'restaurant',
            cuisines: ['noodles', 'lanzhou'],
            address: '10 Gordon Square',
            postcode: 'WC1H 0PD',
            outcode: 'WC1H',
            borough_code: 'E09000007',
            lat: 51.5246,
            lng: -0.1318,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/warren-ramen', 'Warren Street Ramen W1T 5BW', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000102',
          'rec_lcf_00000000000000000102',
          'W1T 5BW|warren street ramen',
          JSON.stringify({
            name_en: 'Warren Street Ramen',
            name_zh: '华伦街拉面',
            category: 'restaurant',
            cuisines: ['noodles'],
            address: '2 Warren Street',
            postcode: 'W1T 5BW',
            outcode: 'W1T',
            borough_code: 'E09000007',
            lat: 51.52495,
            lng: -0.1385,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/closed-ucl-noodles', 'Closed UCL Noodles', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000103',
          'rec_lcf_00000000000000000103',
          'W1T 5BX|closed ucl noodles',
          JSON.stringify({
            name_en: 'Closed UCL Noodles',
            name_zh: '已关闭拉面馆',
            category: 'restaurant',
            cuisines: ['noodles'],
            address: '5 Warren Street',
            postcode: 'W1T 5BX',
            outcode: 'W1T',
            borough_code: 'E09000007',
            lat: 51.52495,
            lng: -0.1383,
            trading: 'closed',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000101', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000102', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000103', now);

    const env = makeEnv(db);
    const emptyMem = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const nowMs = Date.now();

    const firstQueryText = '倫敦 UCL 附近有推薦的拉麵或麵館嗎？';
    const firstEvent = makeEvent({ eventId: '$ev_ucl_noodles_1', text: firstQueryText, timestampMs: nowMs - 20_000 });
    const baseCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
        { matrixId: '@agent-f9388b28:matrix.netmind.chat', displayName: 'Spotted London', isAgent: true },
      ],
      recentHistory: [],
    };

    const firstDecision = await routeEvent(firstEvent, baseCtx, LCF_AGENT_SPEC);
    expect(firstDecision.shouldReply).toBe(true);
    expect(firstDecision.detectedLang).toBe('zh-Hant');

    const firstReply = await fastRespondLcf(env, firstEvent, firstDecision, emptyMem, baseCtx);
    expect(firstReply).toBeTruthy();
    expect(firstReply).toContain('Gordon Square Noodles / 戈登廣場麵館');
    expect(firstReply).toContain('Warren Street Ramen / 華倫街拉麵');
    expect(firstReply).not.toContain('Closed UCL Noodles');
    expect(firstReply).not.toContain('Bloomsbury Dumpling House');
    // First turn sorts by distance to UCL campus: Gordon Square Noodles is closer to UCL than Warren Street Ramen.
    expect(firstReply!.indexOf('Gordon Square Noodles')).toBeLessThan(firstReply!.indexOf('Warren Street Ramen'));

    const followUpEvent = makeEvent({
      eventId: '$ev_ucl_noodles_2',
      text: '有沒有離地鐵站近一點的？',
      timestampMs: nowMs,
    });
    const activeCtx: RoomContext = {
      ...baseCtx,
      activeSession: { active: true, lastAgentReplyAtMs: nowMs - 10_000, expiresAtMs: nowMs + 170_000 },
      recentHistory: [
        {
          eventId: '$ev_ucl_noodles_1',
          senderId: '@alice:matrix.netmind.chat',
          senderName: 'Alice',
          isAgent: false,
          text: firstQueryText,
          timestampMs: nowMs - 20_000,
        },
        {
          eventId: '$ev_lcf_reply_1',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isAgent: true,
          isSelf: true,
          text: firstReply!,
          timestampMs: nowMs - 10_000,
        },
        {
          eventId: '$ev_ucl_noodles_2',
          senderId: '@alice:matrix.netmind.chat',
          senderName: 'Alice',
          isAgent: false,
          text: followUpEvent.text,
          timestampMs: nowMs,
        },
      ],
    };

    const followUpDecision = await routeEvent(followUpEvent, activeCtx, LCF_AGENT_SPEC);
    expect(followUpDecision.shouldReply).toBe(true);
    expect(followUpDecision.reason).toBe('active_session');

    const followUpReply = await fastRespondLcf(env, followUpEvent, followUpDecision, emptyMem, activeCtx);
    expect(followUpReply).toBeTruthy();
    expect(followUpReply).not.toBe('[NO_REPLY]');
    expect(followUpReply).toContain('UCL');
    expect(followUpReply).toContain('Warren Street Ramen / 華倫街拉麵');
    expect(followUpReply).toContain('Gordon Square Noodles / 戈登廣場麵館');
    expect(followUpReply).toContain('近 Warren Street 站約 1 min');
    expect(followUpReply).not.toContain('Closed UCL Noodles');
    expect(followUpReply).not.toContain('Bloomsbury Dumpling House');
    expect(followUpReply).not.toContain('约');
    expect(findRating(followUpReply!)).toBeNull();
    // Follow-up sorts by nearest Tube station distance ascending: Warren Street Ramen comes first!
    expect(followUpReply!.indexOf('Warren Street Ramen')).toBeLessThan(followUpReply!.indexOf('Gordon Square Noodles'));

    // Also verifies English & zh-Hans dish follow-up + tube sorting and that casual chatter still stays [NO_REPLY]
    const enDishFollowUp = await fastRespondLcf(
      env,
      makeEvent({ eventId: '$ev_en_tube', text: 'Any closer to a tube station?' }),
      { ...followUpDecision, detectedLang: 'en' },
      emptyMem,
      {
        ...activeCtx,
        recentHistory: [
          {
            eventId: '$ev_en_dish_1',
            senderId: '@alice:matrix.netmind.chat',
            isAgent: false,
            text: 'Where can I get Xiao long bao near UCL?',
            timestampMs: nowMs - 20_000,
          },
        ],
      },
    );
    expect(enDishFollowUp).toContain('Bloomsbury Dumpling House');
    expect(enDishFollowUp).toMatch(/near [A-Za-z' .&-]+ \(~\d+ min walk\)/);

    const chatterWithHistory = await fastRespondLcf(
      env,
      makeEvent({ eventId: '$ev_chatter', text: '今天天氣真不錯，先休息了' }),
      followUpDecision,
      emptyMem,
      activeCtx,
    );
    expect(chatterWithHistory).toBe('[NO_REPLY]');
  });

  it('13. yields gracefully on primary market + secondary 順便 dim sum queries alongside narra-agent-kit AI rule', async () => {
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
        { matrixId: '@agent-f9388b28:matrix.netmind.chat', displayName: 'Spotted London', isAgent: true },
      ],
      recentHistory: [],
    };

    const marketByTheWay = makeEvent({ text: 'Soho 這週末有什麼好逛的市集順便吃點心？' });
    // Deterministic heuristic stays below silence threshold because 市集 is in antiKeywords
    expect(heuristicDomainScore(marketByTheWay, LCF_AGENT_SPEC, groupCtx)).toBeLessThan(0.55);

    const aiPrompts: string[] = [];
    const triageModel = createWorkersAiTriageModel({
      run: vi.fn(async (_model: string, input: { messages: Array<{ role: string; content: string }> }) => {
        aiPrompts.push(input.messages.map((m) => m.content).join('\n'));
        return { response: '{"score":0.1,"reason":"primary_market_secondary_food"}' };
      }),
    });

    const decision = await routeEvent(marketByTheWay, groupCtx, LCF_AGENT_SPEC, { triageModel });
    expect(decision.shouldReply).toBe(false);
    expect(aiPrompts).toHaveLength(1);
    expect(aiPrompts[0]).toContain('by the way / 順便');
    expect(aiPrompts[0]).toContain('NOT weekend markets');
  });

  it('14. silences meeting-room chatter during active_session while keeping tube and closing-hours follow-ups working', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const nowMs = Date.now();

    const firstQueryText = 'Covent Garden 附近有什麼川菜？';
    const firstReplyText = '🍜 為你查到 1 間營業中選擇（Covent Garden 一帶）：\n• Soho Sichuan House / 蘇豪川菜館';
    const activeCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
        { matrixId: '@agent-f9388b28:matrix.netmind.chat', displayName: 'Spotted London', isAgent: true },
      ],
      activeSession: { active: true, lastAgentReplyAtMs: nowMs - 10_000, expiresAtMs: nowMs + 170_000 },
      recentHistory: [
        {
          eventId: '$ev_cg_sichuan_1',
          senderId: '@alice:matrix.netmind.chat',
          senderName: 'Alice',
          isAgent: false,
          text: firstQueryText,
          timestampMs: nowMs - 20_000,
        },
        {
          eventId: '$ev_cg_lcf_1',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isAgent: true,
          isSelf: true,
          text: firstReplyText,
          timestampMs: nowMs - 10_000,
        },
      ],
    };

    const meetingEvent = makeEvent({
      eventId: '$ev_meeting_chatter',
      text: '對了大家晚點要訂幾點的會議室？',
      timestampMs: nowMs,
    });
    const meetingDecision = await routeEvent(meetingEvent, activeCtx, LCF_AGENT_SPEC);
    expect(meetingDecision.shouldReply).toBe(false);
    expect(meetingDecision.reason).toBe('active_session_chatter');

    const activeSessionDecision: TriageDecision = {
      shouldReply: true,
      tier: 0,
      reason: 'active_session',
      confidence: 0.95,
      detectedLang: 'zh-Hant',
      shouldQuote: true,
    };
    const meetingReply = await fastRespondLcf(env, meetingEvent, activeSessionDecision, emptyMem, activeCtx);
    expect(meetingReply).toBe('[NO_REPLY]');

    const tubeEvent = makeEvent({
      eventId: '$ev_cg_tube_followup',
      text: '有沒有離地鐵站近一點的？',
      timestampMs: nowMs + 1_000,
    });
    const tubeDecision = await routeEvent(tubeEvent, activeCtx, LCF_AGENT_SPEC);
    expect(tubeDecision.shouldReply).toBe(true);
    expect(tubeDecision.reason).toBe('active_session');
    const tubeReply = await fastRespondLcf(env, tubeEvent, tubeDecision, emptyMem, activeCtx);
    expect(tubeReply).toBeTruthy();
    expect(tubeReply).not.toBe('[NO_REPLY]');
    expect(tubeReply).toContain('Soho Sichuan House');
    expect(tubeReply).toContain('Covent Garden');

    const hoursEvent = makeEvent({
      eventId: '$ev_cg_hours_followup',
      text: '他們幾點關門？',
      timestampMs: nowMs + 2_000,
    });
    const hoursDecision = await routeEvent(hoursEvent, activeCtx, LCF_AGENT_SPEC);
    expect(hoursDecision.shouldReply).toBe(true);
    expect(hoursDecision.reason).toBe('active_session');
    const hoursReply = await fastRespondLcf(env, hoursEvent, hoursDecision, emptyMem, activeCtx);
    expect(hoursReply).toBeTruthy();
    expect(hoursReply).not.toBe('[NO_REPLY]');
    expect(hoursReply).toContain('Soho Sichuan House');
    expect(hoursReply).toContain('Covent Garden');
  });

  it('15. handles H1 anti-hit past anecdote silence, H3 primary Soho ramen + secondary AI news, and bare @London Chinese Food greeting', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
        { matrixId: '@agent-3add8bb6:matrix.netmind.chat', displayName: 'AI in 5', isAgent: true },
      ],
      recentHistory: [],
    };

    for (const kw of ['openai', 'anthropic', 'claude', 'gemini', 'deepseek', 'llm', '大模型', '新模型']) {
      expect(LCF_AGENT_SPEC.antiKeywords, kw).toContain(kw);
    }

    const aiRunSpy = vi.fn(async () => ({ response: '{"score":0.1,"reason":"unexpected_ai_call"}' }));
    const triageModel = createWorkersAiTriageModel({ run: aiRunSpy });

    // H1: past-tense hotpot backdrop + 順便 AI model question -> silent/anti-hit
    const h1Event = makeEvent({
      eventId: '$ev_h1',
      text: '剛在唐人街吃完火鍋超撐，順便問一下今天 OpenAI 或 Anthropic 有發新模型嗎？',
    });
    expect(heuristicDomainScore(h1Event, LCF_AGENT_SPEC, groupCtx)).toBeLessThan(0.55);
    const h1HeuristicDecision = await routeEvent(h1Event, groupCtx, LCF_AGENT_SPEC);
    expect(h1HeuristicDecision.shouldReply).toBe(false);

    const h1Triage = await triageModel.score({
      event: h1Event,
      context: groupCtx,
      spec: LCF_AGENT_SPEC,
      detectedLang: 'zh-Hant',
    });
    expect(h1Triage.score).toBeLessThan(0.55);
    expect(h1Triage.reason).toBe('triage_backdrop_only');
    const h1Decision = await routeEvent(h1Event, groupCtx, LCF_AGENT_SPEC, { triageModel });
    expect(h1Decision.shouldReply).toBe(false);
    expect(aiRunSpy).not.toHaveBeenCalled();

    // H3: primary Soho ramen request + secondary 順便 AI news -> replies with Soho noodles/places in zh-Hant
    const h3Event = makeEvent({
      eventId: '$ev_h3',
      text: '幫我找 Soho 附近營業中的拉麵店，順便問一下今天 AI 有什麼大新聞？',
    });
    expect(heuristicDomainScore(h3Event, LCF_AGENT_SPEC, groupCtx)).toBeGreaterThanOrEqual(0.75);
    const h3Triage = await triageModel.score({
      event: h3Event,
      context: groupCtx,
      spec: LCF_AGENT_SPEC,
      detectedLang: 'zh-Hant',
    });
    expect(h3Triage.score).toBeGreaterThanOrEqual(0.9);
    expect(h3Triage.reason).toBe('domain_match');
    const h3Decision = await routeEvent(h3Event, groupCtx, LCF_AGENT_SPEC, { triageModel });
    expect(h3Decision.shouldReply).toBe(true);
    expect(h3Decision.detectedLang).toBe('zh-Hant');
    expect(aiRunSpy).not.toHaveBeenCalled();

    const h3Reply = await fastRespondLcf(env, h3Event, h3Decision, emptyMem, groupCtx);
    expect(h3Reply).toBeTruthy();
    expect(h3Reply).not.toBe('[NO_REPLY]');
    expect(h3Reply).toContain('Soho');
    expect(h3Reply).toContain('Soho Sichuan House / 蘇豪川菜館');
    expect(h3Reply).toContain('麵館');
    expect(h3Reply).toContain('https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001');
    expect(h3Reply).not.toMatch(/[苏馆面]/);
    expect(findRating(h3Reply!)).toBeNull();

    // Bare @London Chinese Food returns greeting
    const bareMentionEv = makeEvent({ eventId: '$ev_bare_lcf', text: '@London Chinese Food' });
    const bareMentionDecision = await routeEvent(bareMentionEv, groupCtx, LCF_AGENT_SPEC);
    expect(bareMentionDecision.shouldReply).toBe(true);
    expect(bareMentionDecision.reason).toBe('explicit_mention');
    const bareGreeting = await fastRespondLcf(env, bareMentionEv, bareMentionDecision, emptyMem, groupCtx);
    expect(bareGreeting).toContain("London Chinese Food guide");
  });

  it('16. handles 1v1 DM follow-up inheritance (UCL + Sichuan), polite thanksReply, capability queries, and active_session silence', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:50:00Z';

    await db
      .prepare(
        `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/euston-sichuan', 'Euston Sichuan Bistro NW1 2BU', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_00000000000000000201',
        'rec_lcf_00000000000000000201',
        'NW1 2BU|euston sichuan bistro',
        JSON.stringify({
          name_en: 'Euston Sichuan Bistro',
          name_zh: '尤斯顿川菜小馆',
          category: 'restaurant',
          cuisines: ['sichuan'],
          address: '8 Euston Square',
          postcode: 'NW1 2BU',
          outcode: 'NW1',
          borough_code: 'E09000007',
          lat: 51.5256,
          lng: -0.1356,
          trading: 'open',
        }),
        ts,
        ts,
        ts,
        ts,
      )
      .run();
    await rebuildPlace(db, 'rec_lcf_00000000000000000201', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const nowMs = Date.now();
    const dmRoomId = '!dm_lcf_1:matrix.netmind.chat';

    const dmBaseCtx: RoomContext = {
      roomId: dmRoomId,
      chatType: 'dm',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
    };

    // 1. Turn 1 in DM: multiline UCL + Sichuan query
    const turn1Text = '我想找倫敦\nUCL 附近好吃的川菜';
    const turn1Event = makeEvent({
      roomId: dmRoomId,
      chatType: 'dm',
      eventId: '$ev_dm_sichuan_1',
      text: turn1Text,
      timestampMs: nowMs - 15_000,
    });
    const turn1Decision = await routeEvent(turn1Event, dmBaseCtx, LCF_AGENT_SPEC);
    expect(turn1Decision.shouldReply).toBe(true);
    expect(turn1Decision.reason).toBe('dm');
    expect(turn1Decision.detectedLang).toBe('zh-Hant');

    const turn1Reply = await fastRespondLcf(env, turn1Event, turn1Decision, emptyMem, dmBaseCtx);
    expect(turn1Reply).toBeTruthy();
    expect(turn1Reply).toContain('UCL 一帶');
    expect(turn1Reply).toContain('Euston Sichuan Bistro / 尤斯頓川菜小館');
    expect(turn1Reply).toContain('Soho Sichuan House / 蘇豪川菜館');
    expect(turn1Reply).not.toContain('Bloomsbury Dumpling House');

    // 2. Turn 2 in DM: nearest-tube follow-up retains BOTH Sichuan cuisine AND UCL location
    const turn2Event = makeEvent({
      roomId: dmRoomId,
      chatType: 'dm',
      eventId: '$ev_dm_sichuan_2',
      text: '有沒有離地鐵站近一點的？',
      timestampMs: nowMs,
    });
    const dmFollowupCtx: RoomContext = {
      ...dmBaseCtx,
      recentHistory: [
        {
          eventId: '$ev_dm_sichuan_1',
          senderId: '@alice:matrix.netmind.chat',
          senderName: 'Alice',
          isAgent: false,
          text: turn1Text,
          timestampMs: nowMs - 15_000,
        },
        {
          eventId: '$ev_dm_lcf_reply_1',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isAgent: true,
          isSelf: true,
          text: turn1Reply!,
          timestampMs: nowMs - 10_000,
        },
      ],
    };
    const turn2Decision = await routeEvent(turn2Event, dmFollowupCtx, LCF_AGENT_SPEC);
    expect(turn2Decision.shouldReply).toBe(true);
    expect(turn2Decision.reason).toBe('dm');
    expect(turn2Decision.detectedLang).toBe('zh-Hant');

    const turn2Reply = await fastRespondLcf(env, turn2Event, turn2Decision, emptyMem, dmFollowupCtx);
    expect(turn2Reply).toBeTruthy();
    expect(turn2Reply).toContain('UCL 一帶');
    expect(turn2Reply).toContain('Euston Sichuan Bistro / 尤斯頓川菜小館');
    expect(turn2Reply).toContain('Soho Sichuan House / 蘇豪川菜館');
    expect(turn2Reply).not.toContain('Bloomsbury Dumpling House');
    expect(turn2Reply).toMatch(/近 .+ 站約 \d+ min/);
    expect(findRating(turn2Reply!)).toBeNull();

    // 3. DM "謝謝！" returns thanksReply('zh-Hant'), NOT self-intro greetingReply
    const thanksEv = makeEvent({
      roomId: dmRoomId,
      chatType: 'dm',
      eventId: '$ev_dm_thanks',
      text: '謝謝！',
      timestampMs: nowMs + 1_000,
    });
    const thanksDec = await routeEvent(thanksEv, dmFollowupCtx, LCF_AGENT_SPEC);
    expect(thanksDec.shouldReply).toBe(true);
    expect(thanksDec.reason).toBe('dm');
    const dmThanks = await fastRespondLcf(env, thanksEv, thanksDec, emptyMem, dmFollowupCtx);
    expect(dmThanks).toBe(thanksReply('zh-Hant'));
    expect(dmThanks).not.toBe(greetingReply('zh-Hant'));

    // 4. DM "你能幫我查什麼？" returns greetingReply('zh-Hant')
    const capEv = makeEvent({
      roomId: dmRoomId,
      chatType: 'dm',
      eventId: '$ev_dm_cap',
      text: '你能幫我查什麼？',
      timestampMs: nowMs + 2_000,
    });
    const capDec = await routeEvent(capEv, dmBaseCtx, LCF_AGENT_SPEC);
    expect(capDec.shouldReply).toBe(true);
    expect(capDec.reason).toBe('dm');
    const dmCap = await fastRespondLcf(env, capEv, capDec, emptyMem, dmBaseCtx);
    expect(dmCap).toBe(greetingReply('zh-Hant'));

    // 5. Unmentioned group active_session "謝謝" still returns [NO_REPLY]
    const activeGroupThanks = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'group', text: '謝謝' }),
      {
        shouldReply: true,
        tier: 0,
        reason: 'active_session',
        confidence: 0.95,
        detectedLang: 'zh-Hant',
        shouldQuote: true,
      },
      emptyMem,
    );
    expect(activeGroupThanks).toBe('[NO_REPLY]');
  });

  it('17. wires Phase 1-4 gateway config (thinkingMessage, enableA2AFailureReply, buildExtraEnvelopeFields) and quick meal-picker fast-path', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:55:00Z';

    // Add a 3rd open spot with opening hours to exercise multi-spot selection & hours prefetch
    await db
      .prepare(
        `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/holborn-noodle', 'Holborn Noodle Bar WC1V 7AA', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_01m4fc98epc5fkgpz83w426dzk',
        'rec_01m4fc98epc5fkgpz83w426dzk',
        'WC1V 7AA|holborn noodle bar',
        JSON.stringify({
          name_en: 'Holborn Noodle Bar',
          name_zh: '霍本拉面馆',
          category: 'restaurant',
          cuisines: ['noodles', 'cantonese'],
          address: '88 High Holborn',
          postcode: 'WC1V 7AA',
          outcode: 'WC1V',
          borough_code: 'E09000007',
          lat: 51.5176,
          lng: -0.1198,
          hours: '11:30-22:00',
          website: 'https://example.com/holborn-noodle',
          trading: 'open',
        }),
        ts,
        ts,
        ts,
        ts,
      )
      .run();
    await rebuildPlace(db, 'rec_01m4fc98epc5fkgpz83w426dzk', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };

    // 1. Gateway config Phase 1-4 wiring
    const cfg = createLcfGatewayConfig();
    expect(cfg.enableA2AFailureReply).toBe(true);
    expect(lcfGatewayConfig.enableA2AFailureReply).toBe(true);
    expect(cfg.thinkingMessage).toBe(lcfThinkingMessage);
    expect(cfg.buildExtraEnvelopeFields).toBe(buildLcfExtraEnvelopeFields);

    const dummyEv = makeEvent({ text: 'test' });
    const dummyDec: TriageDecision = {
      shouldReply: true,
      tier: 0,
      reason: 'dm',
      confidence: 1,
      detectedLang: 'zh-Hant',
      shouldQuote: false,
    };
    expect(cfg.thinkingMessage!('zh-Hant', dummyEv, dummyDec)).toBe(
      '🍜 正在幫你查倫敦中餐與最新資訊，稍等一下…',
    );
    expect(cfg.thinkingMessage!('zh-Hans', dummyEv, dummyDec)).toBe(
      '🍜 正在帮你查伦敦中餐与最新信息，稍等一下…',
    );
    expect(cfg.thinkingMessage!('en', dummyEv, dummyDec)).toBe(
      '🍜 Looking up London Chinese food details for you, one moment…',
    );

    // 2. buildExtraEnvelopeFields extracts rec_... IDs from recent self reply & replyToTarget
    const prefetchCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [
        {
          eventId: '$self_1',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isAgent: true,
          isSelf: true,
          text: [
            '🍜 為你查到 2 間營業中選擇：',
            '- Bloomsbury Dumpling House',
            'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000002/bloomsbury-dumpling-house',
            '- Holborn Noodle Bar',
            'https://app.manyfold.ai/london-chinese-food/zh/place/rec_01m4fc98epc5fkgpz83w426dzk/holborn-noodle-bar',
          ].join('\n'),
          timestampMs: Date.now() - 10_000,
        },
      ],
    };
    const followup = makeEvent({ text: '對了，那間星期六中午有開嗎？' });
    const singlePlaceCtx: RoomContext = {
      ...prefetchCtx,
      activeSession: { active: true },
      recentHistory: [{ ...prefetchCtx.recentHistory[0]!,
        text: 'https://app.manyfold.ai/london-chinese-food/zh/place/rec_01m4fc98epc5fkgpz83w426dzk/holborn-noodle-bar',
      }],
    };
    const hoursDecision = await routeEvent(followup, singlePlaceCtx, LCF_AGENT_SPEC);
    expect(hoursDecision.shouldReply).toBe(true);
    const hoursReply = await fastRespondLcf(env, followup, hoursDecision, emptyMem, singlePlaceCtx);
    expect(hoursReply).toContain('Holborn Noodle Bar');
    expect(hoursReply).toContain('11:30-22:00');
    expect(hoursReply).toContain('你問的時段我還沒核實');
    expect(hoursReply).toContain('https://example.com/holborn-noodle');

    const afterThanks: RoomContext = {
      ...singlePlaceCtx,
      activeSession: { active: false },
      recentHistory: [...singlePlaceCtx.recentHistory, {
        eventId: '$thanks', senderId: followup.senderId, isAgent: false,
        text: '好，謝啦，我先跟朋友確認一下。', timestampMs: followup.timestampMs - 1000,
      }],
    };
    const triageModel = cfg.triageModel?.(env);
    const afterThanksDecision = await routeEvent(followup, afterThanks, LCF_AGENT_SPEC, { triageModel });
    expect(afterThanksDecision.reason).toBe('recent_restaurant_hours');
    expect(await fastRespondLcf(env, followup, afterThanksDecision, emptyMem, afterThanks)).toBe(hoursReply);
    const peerAfter: RoomContext = {
      ...afterThanks,
      recentHistory: [...afterThanks.recentHistory, {
        eventId: '$other-agent', senderId: '@agent-other:matrix.netmind.chat', isAgent: true,
        text: '我找到附近的週末展覽。', timestampMs: followup.timestampMs - 500,
      }],
    };
    expect((await routeEvent(followup, peerAfter, LCF_AGENT_SPEC, { triageModel })).shouldReply).toBe(false);

    const extra = await buildLcfExtraEnvelopeFields(
      env,
      makeEvent({ text: '這兩間哪間適合帶長輩去？' }),
      dummyDec,
      emptyMem,
      prefetchCtx,
    );
    expect(extra).not.toBeNull();
    expect(extra!.d1_prefetched_records).toBeTruthy();
    expect(extra!.d1_prefetched_records.length).toBeLessThanOrEqual(1_400);
    expect(extra!.d1_prefetched_records).toContain('Bloomsbury Dumpling House');
    expect(extra!.d1_prefetched_records).toContain('WC1E 6BT');
    expect(extra!.d1_prefetched_records).toContain('£8.50');
    expect(extra!.d1_prefetched_records).toContain('Holborn Noodle Bar');
    expect(extra!.d1_prefetched_records).toContain('WC1V 7AA');
    expect(extra!.d1_prefetched_records).toContain('11:30-22:00');
    expect(extra!.d1_prefetched_records).not.toContain('4.5/5');
    expect(findRating(extra!.d1_prefetched_records)).toBeNull();

    // replyToTarget takes priority
    const replyExtra = await buildLcfExtraEnvelopeFields(
      env,
      makeEvent({ text: '這間附近好停車嗎？' }),
      { ...dummyDec, detectedLang: 'en' },
      emptyMem,
      {
        ...prefetchCtx,
        recentHistory: [],
        replyToTarget: {
          eventId: '$self_reply_target',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isSelf: true,
          isAgent: true,
          text: 'https://app.manyfold.ai/london-chinese-food/en/place/rec_lcf_00000000000000000001/soho-sichuan-house',
        },
      },
    );
    expect(replyExtra?.d1_prefetched_records).toContain('Soho Sichuan House');
    expect(replyExtra?.d1_prefetched_records).toContain('W1D 6JW');

    // Empty history returns null
    expect(
      await buildLcfExtraEnvelopeFields(
        env,
        dummyEv,
        dummyDec,
        emptyMem,
        { ...prefetchCtx, recentHistory: [] },
      ),
    ).toBeNull();

    // 3. Quick meal-picker fast-path ("今天中午吃什麼？" / "what should we eat for lunch")
    const quickHant = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'dm', eventId: '$ev_lunch_1', text: '今天中午吃什麼？' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
    );
    expect(quickHant).toBeTruthy();
    expect(quickHant).toContain('幫你挑 2 間營業中倫敦中餐');
    expect(quickHant).not.toContain('Closed Canary Tea');
    expect(quickHant!.match(/https:\/\/app\.manyfold\.ai\/london-chinese-food\/zh\/place\//g)).toHaveLength(2);
    expect(quickHant).not.toMatch(/\[[^\]]+\]\(https?:\/\//);
    expect(findRating(quickHant!)).toBeNull();

    // Deterministic for same eventId
    const quickHantRepeat = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'dm', eventId: '$ev_lunch_1', text: '今天中午吃什麼？' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
    );
    expect(quickHantRepeat).toBe(quickHant);

    // English quick meal-picker with memory location hint
    const quickEn = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'dm', eventId: '$ev_lunch_en', text: 'what should we eat for lunch?' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'en', shouldQuote: false },
      {
        userMemories: [
          {
            id: 'mem_loc',
            scope: 'user',
            agentId: LCF_AGENT_ID,
            userId: '@alice:matrix.netmind.chat',
            kind: 'fact',
            key: 'default_area',
            value: 'Soho',
            createdAt: ts,
            updatedAt: ts,
          },
        ],
        roomMemories: [],
        promptSafeLines: [],
      },
    );
    expect(quickEn).toContain('quick open London Chinese food picks near Soho');
    expect(quickEn).not.toContain('Closed Canary Tea');
    expect(quickEn!.match(/https:\/\/app\.manyfold\.ai\/london-chinese-food\/en\/place\//g)).toHaveLength(2);

    // Unmentioned group silence guard remains untouched when anti-keywords hit
    const antiMealReply = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'group', eventId: '$ev_anti_meal', text: '去快閃市集逛完晚上吃什麼？' }),
      { shouldReply: true, tier: 1, reason: 'domain_match', confidence: 0.6, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
    );
    expect(antiMealReply).toBe('[NO_REPLY]');
  });

  it('18. excludes bubble tea, bakery, dessert, and grocery shops from pickQuickMealSpots & "今天中午吃什麼？" when restaurants exist', async () => {
    const mealPool = [
      { id: 'boba-1', entry: { c: 'tea-drinks', k: ['bubble-tea'] } },
      { id: 'boba-2', entry: { c: 'restaurant', k: ['bubble_tea', 'tea'] } },
      { id: 'boba-zh', entry: { c: '奶茶', k: ['奶茶'] } },
      { id: 'bakery-1', entry: { c: 'bakery-dessert', k: ['bakery', 'desserts'] } },
      { id: 'dessert-zh', entry: { c: 'restaurant', k: ['甜品', '烘焙'] } },
      { id: 'grocery-1', entry: { c: 'grocery', k: ['groceries', 'supermarket'] } },
      { id: 'grocery-zh', entry: { c: '超市', k: ['超市'] } },
      { id: 'savory-1', entry: { c: 'restaurant', k: ['sichuan'] } },
      { id: 'savory-2', entry: { c: 'restaurant', k: ['hong-kong-cafe'] } },
      { id: 'savory-3', entry: { c: 'takeaway', k: ['cantonese', 'roast-meats'] } },
    ];

    for (let i = 0; i < 20; i++) {
      const picked = pickQuickMealSpots(mealPool, `$seed_${i}`, 2);
      expect(picked).toHaveLength(2);
      for (const p of picked) {
        expect(p.id.startsWith('savory-'), `seed ${i} picked non-meal ${p.id}`).toBe(true);
      }
    }

    // Falls back gracefully when only non-meal shops exist
    const bobaOnly = mealPool.filter((item) => !item.id.startsWith('savory-'));
    expect(pickQuickMealSpots(bobaOnly, '$seed_fallback', 2)).toHaveLength(2);

    // End-to-end D1 check: add open bubble tea, bakery, and grocery right in Soho alongside savory restaurants
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:58:00Z';

    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-boba', 'Soho Bubble Tea Lab W1D 6AB', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000301',
          'rec_lcf_00000000000000000301',
          'W1D 6AB|soho bubble tea lab',
          JSON.stringify({
            name_en: 'Soho Bubble Tea Lab',
            name_zh: '苏豪奶茶研究所',
            category: 'tea-drinks',
            cuisines: ['bubble-tea', 'tea'],
            address: '15 Wardour Street',
            postcode: 'W1D 6AB',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5136,
            lng: -0.1364,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-bakery', 'Chinatown Bun Bakery W1D 6AC', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000302',
          'rec_lcf_00000000000000000302',
          'W1D 6AC|chinatown bun bakery',
          JSON.stringify({
            name_en: 'Chinatown Bun Bakery',
            name_zh: '唐人街烘焙坊',
            category: 'bakery-dessert',
            cuisines: ['bakery', 'desserts'],
            address: '18 Wardour Street',
            postcode: 'W1D 6AC',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5135,
            lng: -0.1362,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-grocery', 'Loon Fung Supermarket W1D 6AD', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000303',
          'rec_lcf_00000000000000000303',
          'W1D 6AD|loon fung supermarket',
          JSON.stringify({
            name_en: 'Loon Fung Supermarket',
            name_zh: '龙凤行超市',
            category: 'grocery',
            cuisines: ['groceries'],
            address: '42 Gerrard Street',
            postcode: 'W1D 6AD',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5114,
            lng: -0.131,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000301', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000302', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000303', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    for (const eventId of ['$ev_lunch_a', '$ev_lunch_b', '$ev_lunch_c', '$ev_lunch_d', '$ev_lunch_e']) {
      const reply = await fastRespondLcf(
        env,
        makeEvent({ chatType: 'dm', eventId, text: '今天中午吃什麼？' }),
        { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
        emptyMem,
      );
      expect(reply).toBeTruthy();
      expect(reply).toContain('幫你挑 2 間營業中倫敦中餐');
      expect(reply).not.toContain('Soho Bubble Tea Lab');
      expect(reply).not.toContain('Chinatown Bun Bakery');
      expect(reply).not.toContain('Loon Fung Supermarket');
      expect(reply).toContain('Soho Sichuan House');
      expect(reply).toContain('Bloomsbury Dumpling House');
    }
  });

  it('19. routes meal-picker domainKeywords, bypasses comparative follow-ups to A2A, and caps results via parseRequestedLimit', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:59:00Z';

    // Seed two open Soho dim-sum restaurants so default group limit (3) would return multiple spots
    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-dimsum-1', 'Soho Dim Sum Club W1D 5AA', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000401',
          'rec_lcf_00000000000000000401',
          'W1D 5AA|soho dim sum club',
          JSON.stringify({
            name_en: 'Soho Dim Sum Club',
            name_zh: '苏豪点心会',
            category: 'restaurant',
            cuisines: ['dim-sum', 'cantonese'],
            address: '10 Wardour Street',
            postcode: 'W1D 5AA',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5134,
            lng: -0.1345,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-dimsum-2', 'Wardour Tea House W1D 5AB', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000402',
          'rec_lcf_00000000000000000402',
          'W1D 5AB|wardour tea house',
          JSON.stringify({
            name_en: 'Wardour Tea House',
            name_zh: '华都茶楼',
            category: 'restaurant',
            cuisines: ['dim-sum', 'cantonese'],
            address: '22 Wardour Street',
            postcode: 'W1D 5AB',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5137,
            lng: -0.1351,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000401', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000402', now);

    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
    };

    // 1. Meal-picker phrases match domainKeywords and route cleanly in group chat
    for (const phrase of [
      '中午吃什麼',
      '中午吃什么',
      '午餐吃什麼',
      '午餐吃什么',
      '晚餐吃什麼',
      '晚餐吃什么',
      '晚上吃什麼',
      '晚上吃什么',
      '今天吃什麼',
      '今天吃什么',
    ]) {
      expect(LCF_AGENT_SPEC.domainKeywords).toContain(phrase);
    }
    const lunchEvent = makeEvent({ eventId: '$ev_lunch_kw', text: '今天中午吃什麼？' });
    expect(heuristicDomainScore(lunchEvent, LCF_AGENT_SPEC, groupCtx)).toBeGreaterThanOrEqual(0.55);
    const lunchRoute = await routeEvent(lunchEvent, groupCtx, LCF_AGENT_SPEC);
    expect(lunchRoute.shouldReply).toBe(true);
    expect(lunchRoute.detectedLang).toBe('zh-Hant');

    // 2. parseRequestedLimit extracts explicit Chinese & English limits and caps fastRespondLcf output
    expect(parseRequestedLimit('週末先在 Soho 吃點心再逛展覽，各推 1 個')).toBe(1);
    expect(parseRequestedLimit('幫我推薦 2 間')).toBe(2);
    expect(parseRequestedLimit('挑三家就好')).toBe(3);
    expect(parseRequestedLimit('just 1 dim sum spot in Soho')).toBe(1);
    expect(parseRequestedLimit('pick two near UCL')).toBe(2);
    expect(parseRequestedLimit('Soho 附近有什麼點心？')).toBeNull();

    const envNoA2a = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };

    const oneDimSum = await fastRespondLcf(
      envNoA2a,
      makeEvent({
        eventId: '$ev_soho_dimsum_1',
        text: '@London Chinese Food @Spotted London 週末先在 Soho 吃點心再逛展覽，各推 1 個',
      }),
      {
        shouldReply: true,
        tier: 0,
        reason: 'explicit_mention',
        confidence: 1,
        detectedLang: 'zh-Hant',
        shouldQuote: true,
      },
      emptyMem,
      groupCtx,
    );
    expect(oneDimSum).toBeTruthy();
    expect(oneDimSum).toContain('為你查到 1 間營業中選擇');
    expect(oneDimSum!.match(/https:\/\/app\.manyfold\.ai\/london-chinese-food\/zh\/place\//g)).toHaveLength(1);
    expect(findRating(oneDimSum!)).toBeNull();

    // Without explicit count, both Soho dim-sum spots are returned
    const multiDimSum = await fastRespondLcf(
      envNoA2a,
      makeEvent({ eventId: '$ev_soho_dimsum_multi', text: '@London Chinese Food 週末想在 Soho 吃點心' }),
      {
        shouldReply: true,
        tier: 0,
        reason: 'explicit_mention',
        confidence: 1,
        detectedLang: 'zh-Hant',
        shouldQuote: true,
      },
      emptyMem,
      groupCtx,
    );
    expect(multiDimSum!.match(/https:\/\/app\.manyfold\.ai\/london-chinese-food\/zh\/place\//g)).toHaveLength(2);

    // 3. Comparative follow-up returns null when A2A credential is present so Manyfold A2A compares prefetched places
    const envWithA2a = makeEnv(db, {
      MANYFOLD_A2A_URL: 'https://a2a.lcf.test/rpc',
      MANYFOLD_A2A_TOKEN: 'a2a_secret_lcf',
    });
    const nowMs = Date.now();
    const priorListCtx: RoomContext = {
      ...groupCtx,
      chatType: 'dm',
      recentHistory: [
        {
          eventId: '$prev_q',
          senderId: '@alice:matrix.netmind.chat',
          senderName: 'Alice',
          isAgent: false,
          text: 'Soho 附近有什麼川菜或點心？',
          timestampMs: nowMs - 20_000,
        },
        {
          eventId: '$prev_a',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isAgent: true,
          isSelf: true,
          text: [
            '🍜 為你查到 2 間營業中選擇（Soho 一帶）：',
            '- Soho Sichuan House / 蘇豪川菜館',
            'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001/soho-sichuan-house',
            '- Soho Dim Sum Club / 蘇豪點心會',
            'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000401/soho-dim-sum-club',
          ].join('\n'),
          timestampMs: nowMs - 10_000,
        },
      ],
    };

    const comparativeText = '這幾間裡面哪一間最適合帶不吃辣的英國朋友去？';
    const dmComp = await fastRespondLcf(
      envWithA2a,
      makeEvent({ chatType: 'dm', eventId: '$ev_comp_dm', text: comparativeText }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
      priorListCtx,
    );
    expect(dmComp).toBeNull();

    const mentionComp = await fastRespondLcf(
      envWithA2a,
      makeEvent({ chatType: 'group', eventId: '$ev_comp_mention', text: `@London Chinese Food ${comparativeText}` }),
      { shouldReply: true, tier: 0, reason: 'explicit_mention', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
      { ...priorListCtx, chatType: 'group' },
    );
    expect(mentionComp).toBeNull();

    const activeSessionComp = await fastRespondLcf(
      envWithA2a,
      makeEvent({ chatType: 'group', eventId: '$ev_comp_active', text: comparativeText }),
      { shouldReply: true, tier: 0, reason: 'active_session', confidence: 0.95, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
      { ...priorListCtx, chatType: 'group' },
    );
    expect(activeSessionComp).toBeNull();

    // Without A2A credential, comparative follow-up does NOT return null
    const noA2aComp = await fastRespondLcf(
      envNoA2a,
      makeEvent({ chatType: 'dm', eventId: '$ev_comp_no_a2a', text: comparativeText }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
      priorListCtx,
    );
    expect(noA2aComp).not.toBeNull();

    // With explicit new location + cuisine, D1 lookup still runs instead of bypassing to A2A
    const explicitNewComp = await fastRespondLcf(
      envWithA2a,
      makeEvent({ chatType: 'dm', eventId: '$ev_comp_new_loc', text: 'Soho 哪一間點心最適合帶不吃辣的朋友去？' }),
      { shouldReply: true, tier: 0, reason: 'dm', confidence: 1, detectedLang: 'zh-Hant', shouldQuote: false },
      emptyMem,
      priorListCtx,
    );
    expect(explicitNewComp).toBeTruthy();
    expect(explicitNewComp).toContain('Soho Dim Sum Club');

    // Cold unmentioned group domain_match stays [NO_REPLY] (never triggers A2A)
    const unmentionedColdComp = await fastRespondLcf(
      envWithA2a,
      makeEvent({ chatType: 'group', eventId: '$ev_comp_cold', text: comparativeText }),
      { shouldReply: true, tier: 1, reason: 'domain_match', confidence: 0.7, detectedLang: 'zh-Hant', shouldQuote: true },
      emptyMem,
      groupCtx,
    );
    expect(unmentionedColdComp).toBe('[NO_REPLY]');

    // Simplified Chinese active-session follow-ups ("哪一间", "这几家", "哪一个") match FOOD_FOLLOWUP_RE
    for (const zhHansFollowup of ['哪一间可以订位？', '这几家都开着吗？', '哪一个有包间？']) {
      const followupRes = await fastRespondLcf(
        envNoA2a,
        makeEvent({ chatType: 'group', eventId: `$ev_zh_hans_fu_${zhHansFollowup.length}`, text: zhHansFollowup }),
        { shouldReply: true, tier: 0, reason: 'active_session', confidence: 0.95, detectedLang: 'zh-Hans', shouldQuote: true },
        emptyMem,
        { ...priorListCtx, chatType: 'group' },
      );
      expect(followupRes, zhHansFollowup).toBeTruthy();
      expect(followupRes, zhHansFollowup).not.toBe('[NO_REPLY]');
      expect(followupRes, zhHansFollowup).toContain('Soho');
    }
  });

  it('20. excludes grocery and bubble-tea shops from generic location-only food queries while preserving explicit grocery searches', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:59:00Z';

    // Seed a Chinese grocery + bubble-tea shop right on UCL campus (closer than Bloomsbury Dumpling House)
    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/yohome-ucl', 'YOHOME UCL WC1E 6BT', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000501',
          'rec_lcf_00000000000000000501',
          'WC1E 6BT|yohome ucl',
          JSON.stringify({
            name_en: 'YOHOME UCL',
            name_zh: '优家超市 UCL',
            category: 'grocery',
            cuisines: ['groceries', 'bubble-tea'],
            address: '100 Gower Street',
            postcode: 'WC1E 6BT',
            outcode: 'WC1E',
            borough_code: 'E09000007',
            lat: 51.5246,
            lng: -0.134,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/ucl-boba', 'UCL Milk Tea Bar WC1E 6BU', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000502',
          'rec_lcf_00000000000000000502',
          'WC1E 6BU|ucl milk tea bar',
          JSON.stringify({
            name_en: 'UCL Milk Tea Bar',
            name_zh: 'UCL 奶茶吧',
            category: 'tea-drinks',
            cuisines: ['bubble-tea'],
            address: '102 Gower Street',
            postcode: 'WC1E 6BU',
            outcode: 'WC1E',
            borough_code: 'E09000007',
            lat: 51.52462,
            lng: -0.13405,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000501', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000502', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const dmDecision: TriageDecision = {
      shouldReply: true,
      tier: 0,
      reason: 'dm',
      confidence: 1,
      detectedLang: 'zh-Hant',
      shouldQuote: false,
    };

    // Generic location-only food query excludes grocery & bubble-tea shops when savory restaurants exist nearby
    const genericUclReply = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'dm', eventId: '$ev_ucl_generic_food', text: 'UCL 附近有什麼好吃的？' }),
      dmDecision,
      emptyMem,
    );
    expect(genericUclReply).toBeTruthy();
    expect(genericUclReply).toContain('Bloomsbury Dumpling House');
    expect(genericUclReply).not.toContain('YOHOME UCL');
    expect(genericUclReply).not.toContain('UCL Milk Tea Bar');
    expect(findRating(genericUclReply!)).toBeNull();

    // Explicit grocery search ("UCL 附近中超") still returns YOHOME UCL
    const groceryUclReply = await fastRespondLcf(
      env,
      makeEvent({ chatType: 'dm', eventId: '$ev_ucl_grocery', text: 'UCL 附近中超' }),
      dmDecision,
      emptyMem,
    );
    expect(groceryUclReply).toBeTruthy();
    expect(groceryUclReply).toContain('YOHOME UCL');
    expect(groceryUclReply).not.toContain('Bloomsbury Dumpling House');
    expect(findRating(groceryUclReply!)).toBeNull();
  });

  it("21. matches standalone Chinese BBQ queries in zh-Hans and returns 1 King's Cross pick on dual-@ food+outing co-mention", async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:59:30Z';

    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/kx-bbq', 'Kings Cross Skewer House N1C 4AB', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000601',
          'rec_lcf_00000000000000000601',
          'N1C 4AB|kings cross skewer house',
          JSON.stringify({
            name_en: "King's Cross Skewer House",
            name_zh: '国王十字烧烤串串',
            category: 'restaurant',
            cuisines: ['bbq', 'dongbei'],
            address: '15 Granary Square',
            postcode: 'N1C 4AB',
            outcode: 'N1C',
            borough_code: 'E09000007',
            lat: 51.5352,
            lng: -0.1255,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/kx-noodles', 'Pancras Noodle Bar N1C 4AG', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000602',
          'rec_lcf_00000000000000000602',
          'N1C 4AG|pancras noodle bar',
          JSON.stringify({
            name_en: 'Pancras Noodle Bar',
            name_zh: '潘克拉斯面馆',
            category: 'restaurant',
            cuisines: ['noodles', 'sichuan'],
            address: '8 Pancras Square',
            postcode: 'N1C 4AG',
            outcode: 'N1C',
            borough_code: 'E09000007',
            lat: 51.5335,
            lng: -0.1252,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000601', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000602', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const groupCtx: RoomContext = {
      roomId: '!grp1:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
        { matrixId: '@agent-f9388b28:matrix.netmind.chat', displayName: 'Spotted London', isAgent: true },
      ],
      recentHistory: [],
    };

    // 1. Standalone Chinese BBQ prompts match bbq in zh-Hans
    for (const bbqText of ['我想吃烧烤', '怎么没人给我推荐烧烤', '伦敦哪里可以撸串吃烤肉？']) {
      const ev = makeEvent({ eventId: `$ev_bbq_${bbqText.length}`, text: bbqText });
      expect(heuristicDomainScore(ev, LCF_AGENT_SPEC, groupCtx), bbqText).toBeGreaterThanOrEqual(0.55);
      const dec = await routeEvent(ev, groupCtx, LCF_AGENT_SPEC);
      expect(dec.shouldReply, bbqText).toBe(true);
      expect(dec.detectedLang, bbqText).toBe('zh-Hans');

      const reply = await fastRespondLcf(env, ev, dec, emptyMem, groupCtx);
      expect(reply, bbqText).toBeTruthy();
      expect(reply, bbqText).not.toBe('[NO_REPLY]');
      expect(reply, bbqText).toContain("King's Cross Skewer House / 国王十字烧烤串串");
      expect(reply, bbqText).toContain('烧烤串串');
      expect(reply, bbqText).not.toContain('Soho Sichuan House');
      expect(findRating(reply!)).toBeNull();
    }

    // 2. Dual-@ "@London Chinese Food @Spotted London 週末想去 King's Cross 吃飯加逛逛，各推 1 個"
    const dualPrompt = "@London Chinese Food @Spotted London 週末想去 King's Cross 吃飯加逛逛，各推 1 個";
    const aiRunSpy = vi.fn(async () => ({ response: '{"score":0.1,"reason":"unexpected_ai_call"}' }));
    const triageModel = createWorkersAiTriageModel({ run: aiRunSpy });
    const dualEvent = makeEvent({
      eventId: '$ev_dual_kx',
      text: dualPrompt,
      mentions: [LCF_MATRIX_ID, '@agent-f9388b28:matrix.netmind.chat'],
    });
    const dualDecision = await routeEvent(dualEvent, groupCtx, LCF_AGENT_SPEC, { triageModel });
    expect(dualDecision.shouldReply).toBe(true);
    expect(dualDecision.reason).toBe('multi_mention_domain_match');
    expect(dualDecision.detectedLang).toBe('zh-Hant');
    expect(aiRunSpy).not.toHaveBeenCalled();

    const dualReply = await fastRespondLcf(env, dualEvent, dualDecision, emptyMem, groupCtx);
    expect(dualReply).toBeTruthy();
    expect(dualReply).not.toBe('[NO_REPLY]');
    expect(dualReply).toContain("為你查到 1 間營業中選擇（King's Cross 一帶）");
    expect(dualReply!.match(/https:\/\/app\.manyfold\.ai\/london-chinese-food\/zh\/place\//g)).toHaveLength(1);
    expect(findRating(dualReply!)).toBeNull();
  });

  it('22. scopes buildLcfExtraEnvelopeFields prefetch to latest self reply with place URLs (and replyToTarget) without mixing older self turns', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-19T12:00:00Z');
    const ts = '2026-11-19T11:59:30Z';

    await db
      .prepare(
        `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
         VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/old-bbq', 'Old BBQ Spot N1C 4AB', ?, 'tok_1', ?, ?, ?)`,
      )
      .bind(
        'rec_lcf_00000000000000000701',
        'rec_lcf_00000000000000000701',
        'N1C 4AB|old bbq spot',
        JSON.stringify({
          name_en: 'Old Skewer BBQ',
          name_zh: '老牌烧烤串串',
          category: 'restaurant',
          cuisines: ['bbq'],
          address: '15 Granary Square',
          postcode: 'N1C 4AB',
          outcode: 'N1C',
          borough_code: 'E09000007',
          lat: 51.5352,
          lng: -0.1255,
          trading: 'open',
        }),
        ts,
        ts,
        ts,
        ts,
      )
      .run();
    await rebuildPlace(db, 'rec_lcf_00000000000000000701', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const dec: TriageDecision = {
      shouldReply: true,
      tier: 0,
      reason: 'dm',
      confidence: 1,
      detectedLang: 'zh-Hans',
      shouldQuote: false,
    };
    const nowMs = Date.now();
    const olderBbqTurn = {
      eventId: '$self_old_bbq',
      senderId: LCF_MATRIX_ID,
      senderName: 'London Chinese Food',
      isAgent: true,
      isSelf: true,
      text: [
        '🍜 为你查到 1 家营业中选择：',
        '- Old Skewer BBQ / 老牌烧烤串串',
        'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000701/old-skewer-bbq',
      ].join('\n'),
      timestampMs: nowMs - 3_600_000,
    };
    const latestSpotsTurn = {
      eventId: '$self_latest_spots',
      senderId: LCF_MATRIX_ID,
      senderName: 'London Chinese Food',
      isAgent: true,
      isSelf: true,
      text: [
        '🍜 为你查到 2 家营业中选择：',
        '- Soho Sichuan House / 苏豪川菜馆',
        'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000001/soho-sichuan-house',
        '- Bloomsbury Dumpling House / 布鲁姆斯伯里小笼包',
        'https://app.manyfold.ai/london-chinese-food/zh/place/rec_lcf_00000000000000000002/bloomsbury-dumpling-house',
      ].join('\n'),
      timestampMs: nowMs - 30_000,
    };

    // 1. Latest self reply has 2 (< limit 4) place URLs -> stop immediately; older BBQ turn MUST be excluded
    const latestOnly = await buildLcfExtraEnvelopeFields(
      env,
      makeEvent({ chatType: 'dm', text: '这几家哪家最适合带不吃辣的同事？' }),
      dec,
      emptyMem,
      {
        roomId: '!dm_scope:matrix.netmind.chat',
        chatType: 'dm',
        members: [],
        recentHistory: [olderBbqTurn, latestSpotsTurn],
      },
    );
    expect(latestOnly).not.toBeNull();
    expect(latestOnly!.d1_prefetched_records).toContain('Soho Sichuan House');
    expect(latestOnly!.d1_prefetched_records).toContain('Bloomsbury Dumpling House');
    expect(latestOnly!.d1_prefetched_records).not.toContain('Old Skewer BBQ');
    expect(latestOnly!.d1_prefetched_records).not.toContain('rec_lcf_00000000000000000701');

    // 2. replyToTarget with place URL takes priority AND does NOT mix in recentHistory places
    const replyScoped = await buildLcfExtraEnvelopeFields(
      env,
      makeEvent({ chatType: 'group', text: '这家适合聚餐吗？' }),
      dec,
      emptyMem,
      {
        roomId: '!grp_scope:matrix.netmind.chat',
        chatType: 'group',
        members: [],
        recentHistory: [olderBbqTurn, latestSpotsTurn],
        replyToTarget: {
          eventId: '$self_old_bbq',
          senderId: LCF_MATRIX_ID,
          senderName: 'London Chinese Food',
          isAgent: true,
          isSelf: true,
          text: olderBbqTurn.text,
        },
      },
    );
    expect(replyScoped).not.toBeNull();
    expect(replyScoped!.d1_prefetched_records).toContain('Old Skewer BBQ');
    expect(replyScoped!.d1_prefetched_records).not.toContain('Soho Sichuan House');
    expect(replyScoped!.d1_prefetched_records).not.toContain('Bloomsbury Dumpling House');

    // 3. If the very latest self turn has no URLs, fall back to the most recent self turn with URLs and stop there
    const nonUrlLatestSelfTurn = {
      eventId: '$self_no_url',
      senderId: LCF_MATRIX_ID,
      senderName: 'London Chinese Food',
      isAgent: true,
      isSelf: true,
      text: '不客气！还有想了解哪家的菜色吗？',
      timestampMs: nowMs - 10_000,
    };
    const afterNoUrl = await buildLcfExtraEnvelopeFields(
      env,
      makeEvent({ chatType: 'dm', text: '刚才那两家哪家不辣？' }),
      dec,
      emptyMem,
      {
        roomId: '!dm_scope:matrix.netmind.chat',
        chatType: 'dm',
        members: [],
        recentHistory: [olderBbqTurn, latestSpotsTurn, nonUrlLatestSelfTurn],
      },
    );
    expect(afterNoUrl).not.toBeNull();
    expect(afterNoUrl!.d1_prefetched_records).toContain('Soho Sichuan House');
    expect(afterNoUrl!.d1_prefetched_records).toContain('Bloomsbury Dumpling House');
    expect(afterNoUrl!.d1_prefetched_records).not.toContain('Old Skewer BBQ');
  });

  it('23. routes dessert / ice cream prompts ("我想吃冰淇淋", "好想吃糖水甜品，伦敦哪里有？") and returns dessert spots in zh-Hans without non-meal exclusion', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const now = new Date('2026-11-20T12:00:00Z');
    const ts = '2026-11-20T11:59:30Z';

    await db.batch([
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-desserts', 'Chinatown Tong Sui Lab W1D 6DE', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000801',
          'rec_lcf_00000000000000000801',
          'W1D 6DE|chinatown tong sui lab',
          JSON.stringify({
            name_en: 'Chinatown Tong Sui Lab',
            name_zh: '唐人街糖水甜品屋',
            category: 'bakery-dessert',
            cuisines: ['desserts'],
            address: '22 Newport Court',
            postcode: 'W1D 6DE',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5119,
            lng: -0.1287,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
      db
        .prepare(
          `INSERT INTO records (id, kind, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, verified_at, created_at, updated_at)
           VALUES (?, 'place', ?, ?, 'verified', ?, 'https://example.com/soho-gelato', 'Soho Matcha Ice Cream W1D 6DF', ?, 'tok_1', ?, ?, ?)`,
        )
        .bind(
          'rec_lcf_00000000000000000802',
          'rec_lcf_00000000000000000802',
          'W1D 6DF|soho matcha ice cream',
          JSON.stringify({
            name_en: 'Soho Matcha Ice Cream',
            name_zh: '苏豪抹茶冰淇淋',
            category: 'bakery-dessert',
            cuisines: ['desserts', 'bakery'],
            address: '30 Wardour Street',
            postcode: 'W1D 6DF',
            outcode: 'W1D',
            borough_code: 'E09000033',
            lat: 51.5128,
            lng: -0.1321,
            trading: 'open',
          }),
          ts,
          ts,
          ts,
          ts,
        ),
    ]);
    await rebuildPlace(db, 'rec_lcf_00000000000000000801', now);
    await rebuildPlace(db, 'rec_lcf_00000000000000000802', now);

    const env = makeEnv(db);
    const emptyMem: RecallTurnResult = { userMemories: [], roomMemories: [], promptSafeLines: [] };
    const groupCtx: RoomContext = {
      roomId: '!grp_desserts:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
    };

    const cases: Array<{ text: string; userLanguageHint?: 'zh-Hans' }> = [
      { text: '我想吃冰淇淋', userLanguageHint: 'zh-Hans' },
      { text: '好想吃糖水甜品，伦敦哪里有？' },
    ];

    for (const { text, userLanguageHint } of cases) {
      const ctx: RoomContext = userLanguageHint ? { ...groupCtx, userLanguageHint } : groupCtx;
      const ev = makeEvent({ eventId: `$ev_dessert_${text.length}`, text });
      expect(heuristicDomainScore(ev, LCF_AGENT_SPEC, ctx), text).toBeGreaterThanOrEqual(0.55);
      const dec = await routeEvent(ev, ctx, LCF_AGENT_SPEC);
      expect(dec.shouldReply, text).toBe(true);
      expect(dec.detectedLang, text).toBe('zh-Hans');

      const reply = await fastRespondLcf(env, ev, dec, emptyMem, ctx);
      expect(reply, text).toBeTruthy();
      expect(reply, text).not.toBe('[NO_REPLY]');
      expect(reply, text).toContain('Chinatown Tong Sui Lab / 唐人街糖水甜品屋');
      expect(reply, text).toContain('Soho Matcha Ice Cream / 苏豪抹茶冰淇淋');
      expect(reply, text).toContain('糖水甜品');
      expect(reply, text).not.toContain('Soho Sichuan House');
      expect(findRating(reply!)).toBeNull();
    }
  });

  it('24. deterministically scores direct present-tense food/dessert cravings ("我想吃冰淇淋", "我想吃烧烤") as domain_match (>= 0.9) without LLM triage', async () => {
    expect(LCF_AGENT_SPEC.domainDescription).toContain('Chinese BBQ skewers, desserts, tong sui, ice cream');

    const groupCtx: RoomContext = {
      roomId: '!grp_craving:matrix.netmind.chat',
      chatType: 'group',
      members: [
        { matrixId: '@alice:matrix.netmind.chat', displayName: 'Alice', isAgent: false },
        { matrixId: LCF_MATRIX_ID, displayName: 'London Chinese Food', isAgent: true },
      ],
      recentHistory: [],
    };

    const triageModel = createWorkersAiTriageModel(null);

    for (const text of ['我想吃冰淇淋', '我想吃烧烤']) {
      const event = makeEvent({ eventId: `$ev_craving_${text.length}`, text });
      const scored = await triageModel.score({
        event,
        context: groupCtx,
        spec: LCF_AGENT_SPEC,
        detectedLang: 'zh-Hans',
      });
      expect(scored.reason, text).toBe('domain_match');
      expect(scored.score, text).toBeGreaterThanOrEqual(0.9);

      const decision = await routeEvent(event, groupCtx, LCF_AGENT_SPEC, { triageModel });
      expect(decision.shouldReply, text).toBe(true);
      expect(decision.confidence, text).toBeGreaterThanOrEqual(0.9);
    }
  });
});

it('speaks only on its own topic in mixed group chatter', async () => {
  const cases = [
    '晚上能吃啥',
    '我先去開個會',
    '今晚倫敦有什麼市集',
    '今天 AI 圈有啥新消息',
    '能抽張塔羅看看工作嗎',
    '幫我求一支籤',
    '有英國簽證資料可以查嗎',
    '晚餐 £80 我付的，四個人怎麼分',
    'Boots 有折扣碼嗎',
    '昨天吃火鍋超爽',
  ];
  const nowMs = Date.now();
  const replies: string[] = [];
  for (const text of cases) {
    const event = makeEvent({ text, timestampMs: nowMs, chatType: 'group', mentions: [] });
    const context = { roomId: event.roomId, chatType: 'group' as const, members: [], recentHistory: [] };
    if ((await routeEvent(event, context, LCF_AGENT_SPEC, { nowMs })).shouldReply) replies.push(text);
  }
  expect(replies).toEqual(["晚上能吃啥"]);

  const text = '晚上能吃啥';
  const directedEvent = makeEvent({ text: `@Ken ${text}`, timestampMs: nowMs, chatType: 'group', mentions: ['@ken:example.com'] });
  const directedContext = { roomId: directedEvent.roomId, chatType: 'group' as const, members: [], recentHistory: [] };
  expect((await routeEvent(directedEvent, directedContext, LCF_AGENT_SPEC, { nowMs })).shouldReply).toBe(false);
});

it('takes its own part of the mixed dinner and exhibition request after a peer answers', async () => {
  const nowMs = Date.now();
  const event = makeEvent({
    text: '那週五在 Soho 先吃個不辣的中餐，飯後附近有免費展嗎？',
    timestampMs: nowMs,
    chatType: 'group',
    mentions: [],
  });
  const peer = { matrixId: '@agent-f9388b28:matrix.netmind.chat', displayName: 'Spotted London', isAgent: true };
  const context = {
    roomId: event.roomId,
    chatType: 'group' as const,
    members: [peer],
    recentHistory: [{
      eventId: '$peer-already-answered',
      senderId: peer.matrixId,
      isAgent: true,
      timestampMs: nowMs + 5,
      text: 'Here are options for my part.',
    }],
  };
  expect(await routeEvent(event, context, LCF_AGENT_SPEC, { nowMs: nowMs + 10 }))
    .toMatchObject({ shouldReply: true, independentGroupReply: true });
  expect(await routeEvent(event, { ...context, members: [], recentHistory: [] }, LCF_AGENT_SPEC, { nowMs: nowMs + 10 }))
    .not.toHaveProperty('independentGroupReply');
});

describe('plain food asks in a group (zack test, 2026-11-24)', () => {
  // Every agent left these unanswered: Food now claims them and asks where the person is.
  it.each([
    ['肚子餓了', '餓了嗎？你在哪一帶？我幫你找附近的中餐。'],
    ['肚子好餓', '餓了嗎？你在哪一帶？我幫你找附近的中餐。'],
    ['好餓', '餓了嗎？你在哪一帶？我幫你找附近的中餐。'],
    ['晚上有啥可以吃', '你在哪一帶？我幫你找附近的中餐。'],
    ['有啥可以吃', '你在哪一帶？我幫你找附近的中餐。'],
    ['有啥中餐好吃', '你在哪一帶？我幫你找附近的中餐。'],
    ['晚上能吃啥', '你在哪一帶？我幫你找附近的中餐。'],
  ])('answers "%s" with a location question', async (text, expected) => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);
    const run = vi.fn();
    const triageModel = createLcfGatewayConfig().triageModel?.({ ...env, AI: { run } } as unknown as Env);
    const event = makeEvent({ text, chatType: 'group', mentions: [] });
    const context = { roomId: event.roomId, chatType: 'group' as const, members: [], recentHistory: [] };
    const decision = await routeEvent(event, context, LCF_AGENT_SPEC, { triageModel });
    expect(decision.shouldReply).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(await fastRespondLcf(env, event, decision, { userMemories: [], roomMemories: [], promptSafeLines: [] }, context)).toBe(expected);
  });

  it('does not ask "你在哪一帶" again a few minutes after asking it (Netmind London, 2026-11-24)', async () => {
    const db = createD1();
    await seedSamplePlaces(db);
    const env = makeEnv(db);
    const event = makeEvent({ text: '肚子餓了', chatType: 'group', mentions: [] });
    const asked = {
      eventId: '$asked',
      senderId: LCF_AGENT_SPEC.matrixId,
      isAgent: true,
      isSelf: true,
      text: '餓了嗎？你在哪一帶？我幫你找附近的中餐。',
      timestampMs: event.timestampMs - 140_000,
    };
    const context = { roomId: event.roomId, chatType: 'group' as const, members: [], recentHistory: [asked] };
    const decision = await routeEvent(event, { ...context, recentHistory: [] }, LCF_AGENT_SPEC);
    const reply = await fastRespondLcf(env, event, decision, { userMemories: [], roomMemories: [], promptSafeLines: [] }, context);
    expect(reply ?? '').not.toContain('你在哪一帶');
  });

  it.each(['今天 AI 圈有啥新聞', '有啥新聞可以看', '晚上可以幹嘛', '昨天吃火鍋超爽', '我吃飽了', '剛剛付了100磅'])(
    'does not claim "%s"',
    async (text) => {
      const event = makeEvent({ text, chatType: 'group', mentions: [] });
      const context = { roomId: event.roomId, chatType: 'group' as const, members: [], recentHistory: [] };
      expect((await routeEvent(event, context, LCF_AGENT_SPEC)).shouldReply).toBe(false);
    },
  );
});
