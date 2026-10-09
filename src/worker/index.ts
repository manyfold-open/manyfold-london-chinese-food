/**
 * The Worker: the API under /api, the media, the generated files, and the single-page app for
 * everything else. It is served at app.manyfold.ai/london-chinese-food (BASE_PATH) and at the
 * root of its workers.dev host; src/worker/mount.ts is the one place that knows the prefix, so
 * every route below is written as if the site were at the root, and every link it hands out is
 * made with publicUrl().
 *
 * Agents (Authorization: Bearer lcf_...):
 *   POST /api/join                    a collector token; no token needed, limited per IP
 *   GET  /api/me                      the token's role, status and standing per kind
 *   GET  /api/skill?focus=            instructions for the token's role (and a collector's focus)
 *   GET  /api/schema                  every kind's fields, the closed lists, the boroughs
 *   POST /api/records                 up to 20 records of any kinds (Idempotency-Key supported)
 *   POST /api/records/:id/flag        ask for a live place, brand or menu to be checked again
 *   GET  /api/work?type=&limit=       work items handed to this token
 *   POST /api/work/:id/dismiss        give a work item up, with the reason
 *   GET  /api/tasks?limit=&kind=      maintainers: lease tasks (and list the ones held)
 *   POST /api/verdicts                maintainers: up to 20 verdicts on leased tasks
 *
 * Readers: POST /api/records/:id/report (a problem, or a takedown request), limited per IP.
 *
 * Open data (CC BY 4.0, src/worker/exports.ts): /export/places.csv, /export/places.json and
 * /export/menus.jsonl.gz, never review excerpts.
 *
 * Admin (x-admin-password, closed until ADMIN_PASSWORD is set): /api/admin/*, see below.
 *
 * A cron trigger runs the housekeeping every five minutes.
 */

import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { KINDS, normName, type Kind } from '../shared/kinds';
import type { IndexEntry, PlaceDoc } from '../shared/place-doc';
import type { Locale } from '../shared/i18n';
import { queryPlaces } from '../shared/places-query';
import { WORK_TYPES, type IssuedToken, type JoinResponse, type MeResponse, type Role, type WorkResponse, type WorkType } from '../shared/types';
import { requireAdmin, SESSION_COOKIE, SESSION_DAYS, sessionToken, validSession } from './admin';
import { cachedFor, cachedJson, cacheKeyOf, forget, isDailyLimit } from './cache';
import {
  activity,
  adoptPrecedent,
  banCollector,
  createReport,
  decide,
  editRecord,
  listPrecedents,
  listRecords,
  markSpotCheck,
  overview,
  queueWeakSourceRechecks,
  recheckToken,
  recordDetail,
  resolveReport,
  revertToken,
  reviewQueue,
  setBlockedHosts,
  setWeakSourceDaily,
  spotCheck,
  takedown,
  weakSourceDaily,
} from './console';
import { ensureSchema } from './db';
import { buildDishes, buildIndex, datasetJson, dishPlaces, placeDoc, rebuildNow, refreshDocs, sourcePage } from './docs';
import { menusJsonl, placesCsv, placesJson } from './exports';
import { maintain } from './maintenance';
import { factsSettings, gatherFacts, updateFactsSettings } from './facts';
import { applyVerdicts, flagRecord, LEASE_MAX, leaseTasks, releaseTasks, workOf } from './maintainer';
import { mountOf, publicUrl, withMount } from './mount';
import { replaceIllustration, syncIllustrateWork, updateIllustrationSettings } from './illustrations';
import { asJpeg, deleteImage, imageResponse, type MediaKind } from './media';
import { enforce, RULES, sweep } from './ratelimit';
import { suggestMenuLink, uploadIllustration, uploadPhoto } from './uploads';
import { pathMeta, placeMeta, preferredLocale, sitemap, withMeta } from './seo';
import { blockedHosts, illustrationSettings, putSetting } from './settings';
import { collectorSkill, FOCUSES, maintainerSkill, publicSkill, schemaDocument, skillVersion, type Focus } from './skill';
import { fetchPage, idempotencyKey, recall, remember, submitRecords } from './submit';
import {
  adminTokens,
  authenticate,
  capabilitiesOf,
  createCollectorToken,
  createMaintainerToken,
  kindsOf,
  maintainerQuality,
  requireRole,
  standing,
  TOKEN_ENV,
  updateToken,
  type Token,
} from './tokens';
import { HttpError, type Env } from './types';
import { dismiss, handOut, HANDOUT_MAX, importLeads, isWorkType, menuPages, openLeads, reopenWork, updateLeads, workAdmin } from './work';

const SERVICE = 'manyfold-london-chinese-food';
const BODY_MAX = 1_000_000;

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

const openCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] });
app.use('/api/*', (c, next) => (c.req.path.startsWith('/api/admin/') ? next() : openCors(c, next)));

app.use('/api/*', async (c, next) => {
  if (c.req.path !== '/api/health') await ensureSchema(c.env.DB);
  await next();
});

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status as 400, error.headers);
  }
  if (isDailyLimit(error)) {
    console.error('d1 daily limit', error);
    return c.json({ error: { code: 'over_daily_limit', message: 'The database has used its reads for today.' } }, 503);
  }
  console.error('unhandled', error);
  return c.json({ error: { code: 'internal', message: 'Something went wrong.' } }, 500);
});

/* ───────── helpers ───────── */

/** The site's address as this request reached it, mount included: what agents and pages link to. */
const siteOf = (c: AppContext): string => publicUrl(c, '');

/** The site's public address, or null when it is not configured (local development). */
const publicUrlOf = (env: Env): URL | null => {
  try {
    return env.PUBLIC_URL ? new URL(env.PUBLIC_URL) : null;
  } catch {
    return null;
  }
};

/** Whether this request came to the host whose pages may be indexed. */
export const onPublicHost = (env: Env, url: URL): boolean => publicUrlOf(env)?.host === url.host;

const ipOf = (c: AppContext): string => c.req.header('cf-connecting-ip') ?? 'unknown';

async function readJson(c: AppContext): Promise<unknown> {
  const text = await c.req.text();
  if (text.length > BODY_MAX) throw new HttpError(413, 'too_large', `The request body must be at most ${BODY_MAX} bytes.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_json', 'The request body must be JSON.');
  }
}

const body = async (c: AppContext): Promise<Record<string, unknown>> => ((await readJson(c)) ?? {}) as Record<string, unknown>;

const markdown = (c: AppContext, text: string, headers: Record<string, string> = {}) =>
  c.body(text, 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', ...headers });

/**
 * The version of the instructions an agent follows, sent back on every lease and verdict
 * (X-Skill-Version): refused when missing for a maintainer, and for anyone when the rules changed
 * since the agent read them. Its value is never told here: the agent gets it by reading them.
 */
async function requireSkillVersion(c: AppContext, token: Token, required: boolean): Promise<string | null> {
  const sent = c.req.header('x-skill-version');
  if (!sent) {
    if (!required) return `Send the header X-Skill-Version with the version of the instructions you follow (GET ${siteOf(c)}/api/skill gives it): once the rules change, calls with an older version are refused until you read them again.`;
    throw new HttpError(
      428,
      'skill_version_required',
      `Send the header X-Skill-Version with the version of the instructions you follow: read GET ${siteOf(c)}/api/skill (its X-Skill-Version header, also named in the text) and follow them.`,
    );
  }
  if (sent !== (await skillVersion(token.role))) {
    throw new HttpError(
      409,
      'skill_changed',
      `The instructions changed since you read them (you sent version ${sent}). Read GET ${siteOf(c)}/api/skill again, follow what changed, and send its version.`,
    );
  }
  return null;
}

/** The token behind this request, counted against its per-minute limit. */
async function agentToken(c: AppContext): Promise<Token> {
  const token = await authenticate(c.env.DB, c.req.header('authorization'), new Date());
  await enforce(c.env.DB, [{ scope: 'token', subject: token.id, rule: RULES.tokenPerMinute }]);
  return token;
}

const parseKind = (raw: string | undefined): Kind | undefined => {
  if (raw === undefined || raw === '') return undefined;
  if (!(KINDS as readonly string[]).includes(raw)) throw new HttpError(422, 'invalid_query', `kind must be one of ${KINDS.join(', ')}; got ${raw}`);
  return raw as Kind;
};

const parseLimit = (raw: string | undefined, max: number, fallback: number): number => {
  if (raw === undefined) return fallback;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new HttpError(422, 'invalid_query', `limit must be a whole number from 1 to ${max}; got ${raw}`);
  return limit;
};

/* ───────── read ───────── */

app.get('/api/health', (c) => c.json({ status: 'ok', service: SERVICE, time: new Date().toISOString() }));

/**
 * The robots.txt of the whole public host. app.manyfold.ai has no origin of its own at its root,
 * and a robots.txt that fails tells search engines to crawl nothing there, so this Worker owns the
 * exact route. Any other host (workers.dev, local) is kept out of search results.
 */
app.get('/robots.txt', (c) => {
  const url = new URL(c.req.url);
  const site = publicUrlOf(c.env);
  const text =
    onPublicHost(c.env, url) && site
      ? `User-agent: *\nAllow: /\n\nSitemap: ${site.origin}${site.pathname.replace(/\/+$/, '')}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n';
  return c.text(text, 200, { 'cache-control': 'public, max-age=3600' });
});

app.get('/api/schema', (c) => c.json(schemaDocument(), 200, { 'cache-control': 'public, max-age=300' }));

// Public reads, cached at the edge (src/worker/cache.ts): a busy page costs D1 a read a window per
// data center, not one per view.
const PAGE_CACHE = cachedFor(60);
const SLOW_CACHE = cachedFor(300);

const jsonText = (c: AppContext, text: string) => c.body(text, 200, { 'content-type': 'application/json; charset=utf-8' });

/** A stored dataset, built at once the first time it is asked for. */
async function dataset(c: AppContext, name: 'index' | 'dishes' | 'illustrations'): Promise<string> {
  const stored = await datasetJson(c.env.DB, name);
  if (stored !== null) return stored;
  if (name === 'index') await buildIndex(c.env.DB, new Date());
  else await buildDishes(c.env.DB, new Date());
  return (await datasetJson(c.env.DB, name)) ?? (name === 'illustrations' ? '{}' : '[]');
}

app.get('/api/index', PAGE_CACHE, async (c) => jsonText(c, `{"places":${await dataset(c, 'index')}}`));

app.get('/api/places/:id', PAGE_CACHE, async (c) => {
  const doc = await placeDoc(c.env.DB, c.req.param('id'));
  if (!doc) throw new HttpError(404, 'not_found', 'No public place has that id.');
  return jsonText(c, doc);
});

app.get('/api/dishes', SLOW_CACHE, async (c) => jsonText(c, `{"dishes":${await dataset(c, 'dishes')}}`));

app.get('/api/dishes/:key', SLOW_CACHE, async (c) => c.json(await dishPlaces(c.env.DB, normName(decodeURIComponent(c.req.param('key'))))));

app.get('/api/illustrations', SLOW_CACHE, async (c) => {
  const settings = await illustrationSettings(c.env.DB);
  return jsonText(c, `{"shown":${settings.shown},"dishes":${settings.shown ? await dataset(c, 'illustrations') : '{}'}}`);
});

const pageOf = (raw: string | undefined) => Math.max(1, Math.min(1000, Number(raw ?? 1) || 1));
app.get('/api/sources/:key', SLOW_CACHE, async (c) => c.json(await sourcePage(c.env.DB, 'source', c.req.param('key'), pageOf(c.req.query('page')))));
app.get('/api/critics/:key', SLOW_CACHE, async (c) => c.json(await sourcePage(c.env.DB, 'author', c.req.param('key'), pageOf(c.req.query('page')))));

/**
 * Agents' search before they send: public places by name or postcode, and brands. Places come
 * from the index (the same code readers filter with); brands are few and read live.
 */
app.get('/api/search', PAGE_CACHE, async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  const postcode = c.req.query('postcode')?.trim() ?? '';
  if (!q && !postcode) throw new HttpError(422, 'invalid_query', 'Send q (words of a name) or postcode, or both.');
  const entries = await cachedJson<{ places: IndexEntry[] }>(c, `${cacheKeyOf(c).split('?')[0]!.replace(/\/search$/, '/index')}`, 60, async () => ({
    places: JSON.parse(await dataset(c, 'index')) as IndexEntry[],
  }));
  const places = queryPlaces(entries.places, { q, postcode, categories: c.req.query('category') ? [c.req.query('category')!] : undefined, sort: 'name' })
    .slice(0, 25)
    .map((entry) => ({ id: entry.id, name_en: entry.n, name_zh: entry.z, postcode: entry.pc, category: entry.c, trading: entry.t, brand: entry.br }));
  const { results } = await c.env.DB.prepare(`SELECT id, status, data_json FROM records WHERE kind = 'brand' AND status IN ('pending', 'verified', 'stale')`).all<{ id: string; status: string; data_json: string }>();
  const words = normName(q).split(' ').filter(Boolean);
  const brands = results
    .map((row) => {
      const data = JSON.parse(row.data_json) as { name_en?: string; name_zh?: string; website?: string };
      return { id: row.id, status: row.status, name_en: data.name_en ?? null, name_zh: data.name_zh ?? null, website: data.website ?? null };
    })
    .filter((brand) => words.length > 0 && words.every((word) => `${normName(brand.name_en ?? '')} ${normName(brand.name_zh ?? '')}`.includes(word)))
    .slice(0, 10);
  return c.json({ places, brands });
});

app.post('/api/records/:id/report', async (c) => {
  await enforce(c.env.DB, [{ scope: 'report', subject: ipOf(c), rule: RULES.reportPerHour }]);
  await createReport(c.env.DB, c.req.param('id'), await body(c), new Date());
  return c.json({ ok: true }, 201);
});

/* ───────── images ───────── */

const MEDIA_CACHE = cachedFor(86_400);
const SIZES = { 'full.webp': 'full', 'thumb.webp': 'thumb' } as const;

/** An image readers may see: its record public, and for a photo its place public too. */
async function publicImage(c: AppContext, kind: MediaKind, id: string, file: string): Promise<Response> {
  const size = SIZES[file as keyof typeof SIZES];
  if (!size) throw new HttpError(404, 'not_found', 'Images are full.webp or thumb.webp.');
  const row = await c.env.DB
    .prepare(`SELECT r.status, p.status AS parent_status FROM records r LEFT JOIN records p ON p.id = r.parent_id WHERE r.id = ? AND r.kind = ?`)
    .bind(id, kind)
    .first<{ status: string; parent_status: string | null }>();
  const live = (status: string | null) => status === 'verified' || status === 'stale';
  if (!row || !live(row.status) || (kind === 'photo' && !live(row.parent_status))) throw new HttpError(404, 'not_found', 'No public image has that id.');
  const response = await imageResponse(c.env.MEDIA, kind, id, size, 'public, max-age=86400');
  if (!response) throw new HttpError(404, 'not_found', 'No public image has that id.');
  return response;
}

app.get('/media/p/:id/:file', MEDIA_CACHE, (c) => publicImage(c, 'photo', c.req.param('id'), c.req.param('file')));
app.get('/media/i/:id/:file', MEDIA_CACHE, (c) => publicImage(c, 'illustration', c.req.param('id'), c.req.param('file')));

/** Where an upload form may be served from: the public site, and the host this request came to. */
const formHosts = (c: AppContext): string[] => [...new Set([publicUrlOf(c.env)?.hostname, new URL(c.req.url).hostname].filter((host): host is string => Boolean(host)))];

app.get('/api/upload-config', (c) => c.json({ turnstile_site_key: c.env.TURNSTILE_SITE_KEY ?? '' }, 200, { 'cache-control': 'public, max-age=300' }));

/**
 * A visitor's photo. A browser always says where a cross-origin POST comes from, and this form
 * posts only from this site; Turnstile, checked on the server, is the real gate (uploads.ts).
 */
app.post('/api/places/:id/photos', async (c) => {
  const origin = c.req.header('origin');
  if (origin !== undefined && origin !== new URL(c.req.url).origin) throw new HttpError(403, 'cross_origin', 'Upload photos from this site’s own form.');
  return c.json(await uploadPhoto(c.env, c.req.param('id'), c.req.raw, { ip: ipOf(c), hosts: formHosts(c), now: new Date() }), 201);
});

/** A visitor's link to the place's menu online: a hint for collectors (uploads.ts, suggestMenuLink). */
app.post('/api/places/:id/menu-links', async (c) => {
  const origin = c.req.header('origin');
  if (origin !== undefined && origin !== new URL(c.req.url).origin) throw new HttpError(403, 'cross_origin', 'Send menu links from this site’s own form.');
  return c.json(await suggestMenuLink(c.env, c.req.param('id'), await body(c), { ip: ipOf(c), hosts: formHosts(c), now: new Date() }), 201);
});

/* ───────── agents ───────── */

app.post('/api/join', async (c) => {
  const ip = ipOf(c);
  await enforce(c.env.DB, [
    { scope: 'join-hour', subject: ip, rule: RULES.joinPerHour },
    { scope: 'join-day', subject: ip, rule: RULES.joinPerDay },
  ]);
  if (Math.random() < 0.05) await sweep(c.env.DB);
  const { token, secret } = await createCollectorToken(c.env.DB, (await body(c)).agent_name, new Date());
  const reply: JoinResponse = {
    token: secret,
    token_id: token.id,
    role: 'collector',
    skill_url: `${siteOf(c)}/api/skill`,
    note: `Your token is the token field (it starts with lcf_). Save it as ${TOKEN_ENV} in your workspace .env: it is shown only once.`,
  };
  return c.json(reply, 201);
});

app.get('/api/me', async (c) => {
  const token = await agentToken(c);
  const now = new Date();
  const kinds = KINDS.filter((kind) => kind !== 'photo');
  const reply: MeResponse = {
    token_id: token.id,
    role: token.role,
    label: token.label,
    status: token.status,
    kinds: token.kinds,
    created_at: token.createdAt,
    standing: Object.fromEntries(await Promise.all(kinds.map(async (kind) => [kind, await standing(c.env.DB, token, kind, now)] as const))),
  };
  if (token.role === 'maintainer') reply.work = await workOf(c.env.DB, token, now);
  return c.json(reply);
});

app.get('/api/skill', async (c) => {
  const token = await agentToken(c);
  const now = new Date();
  const version = await skillVersion(token.role);
  const headers = { 'x-skill-version': version };
  if (token.role === 'maintainer') {
    const [work, quality, capabilities] = await Promise.all([
      workOf(c.env.DB, token, now),
      maintainerQuality(c.env.DB, token.id, now),
      capabilitiesOf(c.env.DB, token.id),
    ]);
    return markdown(c, maintainerSkill(siteOf(c), token, work, now, { version, warnings: quality.warnings, browser: capabilities.includes('browser') }), headers);
  }
  const raw = c.req.query('focus') ?? 'places';
  if (!(FOCUSES as readonly string[]).includes(raw)) throw new HttpError(422, 'invalid_query', `focus must be one of ${FOCUSES.join(', ')}; got ${raw}`);
  const focus = raw as Focus;
  const kinds: Kind[] = focus === 'places' ? ['place', 'brand'] : focus === 'menus' ? ['menu'] : focus === 'illustrations' ? ['illustration'] : ['review'];
  const standings = Object.fromEntries(await Promise.all(kinds.map(async (kind) => [kind, await standing(c.env.DB, token, kind, now)] as const)));
  return markdown(c, collectorSkill(siteOf(c), token, focus, standings, now, version), headers);
});

app.post('/api/records', async (c) => {
  const token = await agentToken(c);
  requireRole(token, ['collector', 'maintainer']);
  const now = new Date();
  const key = idempotencyKey(c.req.header('idempotency-key'));
  if (key) {
    const earlier = await recall(c.env.DB, token.id, key, now);
    if (earlier) return c.json(earlier);
  }
  const versionWarning = await requireSkillVersion(c, token, false);
  const reply = await submitRecords(c.env.DB, token, await readJson(c), { now, fetchPage: (url) => fetchPage(url) });
  if (versionWarning) reply.warnings.push(versionWarning);
  if (key) await remember(c.env.DB, token.id, key, reply, now);
  return c.json(reply);
});

app.post('/api/records/:id/flag', async (c) => {
  const token = await agentToken(c);
  await enforce(c.env.DB, [{ scope: 'flag', subject: token.id, rule: RULES.flagPerDay }]);
  return c.json(await flagRecord(c.env.DB, token, c.req.param('id'), await body(c), new Date()));
});

app.get('/api/work', async (c) => {
  const token = await agentToken(c);
  const type = c.req.query('type');
  if (!isWorkType(type)) throw new HttpError(422, 'invalid_query', `type must be one of ${WORK_TYPES.join(', ')}.`);
  const limit = parseLimit(c.req.query('limit'), HANDOUT_MAX, 5);
  const { items, note } = await handOut(c.env.DB, token, type as WorkType, limit, new Date());
  // A menu's photos are public once verified: give every page's address, in order.
  const shown = await Promise.all(
    items.map(async (item) => {
      if (item.type !== 'transcribe') return item;
      const pages = await menuPages(c.env.DB, String(item.payload?.place ?? ''), item.subject);
      const urls = pages.map((id) => publicUrl(c, `/media/p/${id}/full.webp`));
      return { ...item, payload: { ...item.payload, photo: pages[0] ?? item.subject, pages, image_url: urls[0] ?? null, image_urls: urls } };
    }),
  );
  const reply: WorkResponse = { items: shown, note };
  return c.json(reply);
});

app.post('/api/work/:id/dismiss', async (c) => {
  const token = await agentToken(c);
  return c.json(await dismiss(c.env.DB, token, c.req.param('id'), await body(c), new Date()));
});

app.get('/api/tasks', async (c) => {
  const token = await agentToken(c);
  requireRole(token, ['maintainer']);
  await requireSkillVersion(c, token, true);
  const kind = parseKind(c.req.query('kind'));
  if (kind && !kindsOf(token).includes(kind)) throw new HttpError(403, 'wrong_kind', `This token reviews ${token.kinds.join(', ')}, not ${kind}.`);
  const limit = parseLimit(c.req.query('limit'), LEASE_MAX, LEASE_MAX);
  return c.json(
    await leaseTasks(
      c.env.DB,
      token,
      { limit, kind, mediaUrl: (taskId) => publicUrl(c, `/api/tasks/${taskId}/media`), photoUrl: (id) => publicUrl(c, `/media/p/${id}/full.webp`) },
      new Date(),
    ),
  );
});

/** The image of a photo or illustration task, for the maintainer holding it, while the lease lasts. */
app.get('/api/tasks/:id/media', async (c) => {
  const token = await agentToken(c);
  requireRole(token, ['maintainer']);
  const task = await c.env.DB
    .prepare(`SELECT t.record_id, t.record_kind, t.leased_to, t.lease_expires_at FROM tasks t WHERE t.id = ? AND t.status = 'leased'`)
    .bind(c.req.param('id'))
    .first<{ record_id: string; record_kind: string; leased_to: string; lease_expires_at: string }>();
  if (!task || task.leased_to !== token.id || task.lease_expires_at <= new Date().toISOString()) {
    throw new HttpError(404, 'not_found', 'You hold no lease on that task; lease it with GET /api/tasks.');
  }
  if (task.record_kind !== 'photo' && task.record_kind !== 'illustration') throw new HttpError(404, 'not_found', 'That task has no image.');
  const size = c.req.query('size') === 'thumb' ? 'thumb' : 'full';
  const image = await imageResponse(c.env.MEDIA, task.record_kind, task.record_id, size, 'no-store');
  if (!image) throw new HttpError(404, 'not_found', 'The image is gone.');
  return c.req.query('format') === 'jpeg' ? asJpeg(c.env.IMAGES, image) : image;
});

app.post('/api/illustrations', async (c) => {
  const token = await agentToken(c);
  requireRole(token, ['collector', 'maintainer']);
  return c.json(await uploadIllustration(c.env, token, c.req.raw, new Date()), 201);
});

app.post('/api/verdicts', async (c) => {
  const token = await agentToken(c);
  requireRole(token, ['maintainer']);
  await requireSkillVersion(c, token, true);
  return c.json(await applyVerdicts(c.env.DB, token, await readJson(c), new Date()));
});

/** Tasks a maintainer holds, given back untouched. Always open to it, whatever version it read. */
app.post('/api/tasks/release', async (c) => {
  const token = await agentToken(c);
  requireRole(token, ['maintainer']);
  return c.json(await releaseTasks(c.env.DB, token, await readJson(c), new Date()));
});

/* ───────── admin ───────── */

/** The console's session cookie lives under the site's path, so other apps on the host never get it. */
const sessionCookie = (c: AppContext) => ({
  path: mountOf(c) || '/',
  httpOnly: true,
  sameSite: 'Strict' as const,
  secure: new URL(c.req.url).protocol === 'https:',
});

/** Locking the console forgets its session; it needs no password, so even a stale cookie can be cleared. */
app.delete('/api/admin/session', (c) => {
  deleteCookie(c, SESSION_COOKIE, sessionCookie(c));
  return c.json({ open: false });
});

app.use('/api/admin/*', async (c, next) => {
  const password = c.req.header('x-admin-password');
  if (password === undefined && (await validSession(c.env, getCookie(c, SESSION_COOKIE)))) {
    // A cookie rides along on whatever the browser sends; a change must come from this site's own pages.
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('origin') !== new URL(c.req.url).origin) {
      throw new HttpError(403, 'cross_origin', 'Admin changes are made from this site’s own /settings pages.');
    }
    await next();
    return;
  }
  await requireAdmin(c.env, password, ipOf(c));
  await next();
});

/** Whether the console is open: the session cookie (or a password) still opens the admin API. */
app.get('/api/admin/session', (c) => c.json({ open: true }));

/** The console trades the password for a session cookie, good for SESSION_DAYS. */
app.post('/api/admin/session', async (c) => {
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  setCookie(c, SESSION_COOKIE, await sessionToken((c.env.ADMIN_PASSWORD ?? '').trim(), expiresAt), {
    ...sessionCookie(c),
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return c.json({ open: true, expires_at: new Date(expiresAt).toISOString() });
});

/**
 * Admin changes readers should see now rather than at the next cron run: once one succeeds, the
 * pages it touched are rebuilt. Maintainers' verdicts wait for the cron.
 */
const refreshesDocs: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  await next();
  if (c.res.ok) await refreshDocs(c.env.DB, new Date(), { max: 100 });
};

app.post('/api/admin/tokens', async (c) => {
  const input = await body(c);
  if (input.role !== undefined && input.role !== 'maintainer') {
    throw new HttpError(422, 'invalid_body', 'The admin API issues maintainer tokens; collectors get theirs from /join.');
  }
  const now = new Date();
  const { token, secret } = await createMaintainerToken(c.env.DB, input, now);
  const [summary] = await adminTokens(c.env.DB, now, { id: token.id });
  const reply: IssuedToken = {
    ...summary!,
    token: secret,
    note: `Shown once. Send it to its owner privately; their agent keeps it as ${TOKEN_ENV} in its workspace .env.`,
  };
  return c.json(reply, 201);
});

app.get('/api/admin/tokens', async (c) => {
  const role = c.req.query('role');
  if (role !== undefined && role !== 'collector' && role !== 'maintainer') throw new HttpError(422, 'invalid_query', 'role must be collector or maintainer.');
  return c.json({ tokens: await adminTokens(c.env.DB, new Date(), { role: role as Role | undefined }) });
});

app.patch('/api/admin/tokens/:id', async (c) => c.json(await updateToken(c.env.DB, c.req.param('id'), await body(c), new Date())));
app.post('/api/admin/tokens/:id/revert', refreshesDocs, async (c) => c.json(await revertToken(c.env.DB, c.req.param('id'), (await body(c)).since, new Date())));
app.post('/api/admin/tokens/:id/ban', refreshesDocs, async (c) => c.json(await banCollector(c.env.DB, c.req.param('id'), new Date())));
app.post('/api/admin/tokens/:id/recheck', async (c) => c.json(await recheckToken(c.env.DB, c.req.param('id'), new Date())));

app.get('/api/admin/overview', async (c) => c.json({ kinds: await overview(c.env.DB) }));
app.get('/api/admin/activity', async (c) => c.json({ items: await activity(c.env.DB, { kind: parseKind(c.req.query('kind')), actor: c.req.query('actor') }) }));
app.get('/api/admin/review', async (c) => c.json({ items: await reviewQueue(c.env.DB, parseKind(c.req.query('kind'))) }));
app.post('/api/admin/reports/:id/resolve', async (c) => {
  await resolveReport(c.env.DB, Number(c.req.param('id')));
  return c.json({ ok: true });
});

app.get('/api/admin/records', async (c) =>
  c.json(
    await listRecords(c.env.DB, {
      kind: c.req.query('kind'),
      status: c.req.query('status'),
      q: c.req.query('q'),
      parent: c.req.query('parent'),
      by: c.req.query('by'),
      page: Number(c.req.query('page') ?? 1) || 1,
    }),
  ),
);
app.get('/api/admin/records/:id', async (c) => c.json(await recordDetail(c.env.DB, c.req.param('id'))));
app.post('/api/admin/records/:id/decide', refreshesDocs, async (c) => c.json(await decide(c.env.DB, c.req.param('id'), await body(c), new Date())));
app.patch('/api/admin/records/:id', refreshesDocs, async (c) => c.json(await editRecord(c.env.DB, c.req.param('id'), await body(c), new Date())));
app.post('/api/admin/records/:id/takedown', refreshesDocs, async (c) => {
  const detail = await takedown(c.env.DB, c.req.param('id'), await body(c), new Date());
  const { kind, id } = detail.record;
  if (kind === 'photo' || kind === 'illustration') {
    await deleteImage(c.env.MEDIA, kind, id);
    const path = kind === 'photo' ? 'p' : 'i';
    await forget([publicUrl(c, `/media/${path}/${id}/full.webp`), publicUrl(c, `/media/${path}/${id}/thumb.webp`)]);
  }
  return c.json(detail);
});

/** Any record's image, in any status, for the admin. */
app.get('/api/admin/records/:id/media', async (c) => {
  const row = await c.env.DB.prepare('SELECT kind FROM records WHERE id = ?').bind(c.req.param('id')).first<{ kind: string }>();
  if (!row || (row.kind !== 'photo' && row.kind !== 'illustration')) throw new HttpError(404, 'not_found', 'No image record has that id.');
  const image = await imageResponse(c.env.MEDIA, row.kind, c.req.param('id'), c.req.query('size') === 'thumb' ? 'thumb' : 'full', 'no-store');
  if (!image) throw new HttpError(404, 'not_found', 'The image is gone.');
  return image;
});

/** Visitors have no tokens to undo: the admin rejects their pending photos from a time window at once. */
app.post('/api/admin/photos/reject', refreshesDocs, async (c) => {
  const input = await body(c);
  const since = typeof input.since === 'string' ? Date.parse(input.since) : Number.NaN;
  const until = typeof input.until === 'string' ? Date.parse(input.until) : Date.now();
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 300) : '';
  if (!Number.isFinite(since) || !Number.isFinite(until) || !reason) throw new HttpError(422, 'invalid_body', 'Send since and until (ISO 8601) and a reason.');
  const { results } = await c.env.DB
    .prepare(`SELECT id FROM records INDEXED BY records_age WHERE kind = 'photo' AND status = 'pending' AND created_at >= ? AND created_at <= ? AND submitted_by = 'visitor'`)
    .bind(new Date(since).toISOString(), new Date(until).toISOString())
    .all<{ id: string }>();
  const now = new Date();
  for (const { id } of results) await decide(c.env.DB, id, { status: 'rejected', reason }, now);
  return c.json({ rejected: results.length });
});

app.get('/api/admin/illustrations/settings', async (c) => c.json(await illustrationSettings(c.env.DB)));
app.patch('/api/admin/illustrations/settings', async (c) => c.json(await updateIllustrationSettings(c.env.DB, await body(c), new Date())));
app.post('/api/admin/illustrations/:id/replace', refreshesDocs, async (c) => {
  const id = c.req.param('id');
  const outcome = await replaceIllustration(c.env.DB, id, await body(c), new Date());
  await forget([publicUrl(c, `/media/i/${id}/full.webp`), publicUrl(c, `/media/i/${id}/thumb.webp`)]);
  return c.json(outcome);
});

app.get('/api/admin/blocked-hosts', async (c) => c.json({ hosts: await blockedHosts(c.env.DB) }));
app.put('/api/admin/blocked-hosts', async (c) => c.json({ hosts: await setBlockedHosts(c.env.DB, (await body(c)).hosts, new Date()) }));

app.get('/api/admin/spot-check/:kind', async (c) => c.json(await spotCheck(c.env.DB, c.req.param('kind'), new Date())));
app.post('/api/admin/spot-check/:kind/:recordId', async (c) =>
  c.json(await markSpotCheck(c.env.DB, c.req.param('kind'), c.req.param('recordId'), await body(c), new Date())),
);

app.get('/api/admin/work', async (c) => {
  const type = c.req.query('type');
  return c.json(await workAdmin(c.env.DB, isWorkType(type) ? type : null, c.req.query('status') ?? null));
});
app.post('/api/admin/work/:id/reopen', async (c) => {
  await reopenWork(c.env.DB, c.req.param('id'), new Date());
  return c.json({ ok: true });
});
app.post('/api/admin/leads', async (c) => c.json(await importLeads(c.env.DB, (await body(c)).leads, new Date())));
app.patch('/api/admin/leads', async (c) => c.json(await updateLeads(c.env.DB, (await body(c)).leads, new Date())));
app.get('/api/admin/leads', async (c) => c.json(await openLeads(c.env.DB, c.req.query('prefix') ?? '', c.req.query('after') ?? '', Number(c.req.query('limit') ?? 500))));

app.get('/api/admin/precedents', async (c) => c.json({ precedents: await listPrecedents(c.env.DB, c.req.query('all') === '1') }));
app.post('/api/admin/precedents/:id/adopt', async (c) => c.json({ precedents: await adoptPrecedent(c.env.DB, Number(c.req.param('id')), new Date()) }));

app.get('/api/admin/facts/settings', async (c) => c.json(await factsSettings(c.env.DB)));
app.patch('/api/admin/facts/settings', async (c) => c.json(await updateFactsSettings(c.env.DB, await body(c), new Date())));

/** Verified places whose source cannot stand alone (an FSA listing): how many, and rechecks for them now or daily. */
app.get('/api/admin/source-rechecks', async (c) => {
  const { remaining } = await queueWeakSourceRechecks(c.env.DB, 'place', 0, new Date());
  return c.json({ remaining, daily: await weakSourceDaily(c.env.DB) });
});
app.post('/api/admin/source-rechecks', async (c) => {
  const limit = (await body(c)).limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new HttpError(422, 'invalid_body', 'limit must be a whole number from 1 to 500.');
  return c.json(await queueWeakSourceRechecks(c.env.DB, 'place', limit, new Date()));
});
app.put('/api/admin/source-rechecks', async (c) => c.json({ daily: await setWeakSourceDaily(c.env.DB, (await body(c)).daily, new Date()) }));

/** The cron's work, also run from POST /api/admin/maintenance: housekeeping, then the read models. */
async function runCron(env: Env, now: Date, everyDueRecord: boolean) {
  const housekeeping = await maintain(env.DB, now, { everyDueRecord });
  const docs = await refreshDocs(env.DB, now, { whole: everyDueRecord });
  const illustrate = await syncIllustrateWork(env.DB, now);
  const facts = await gatherFacts(env.DB, now);
  const purged = everyDueRecord ? await purgeMedia(env, now) : 0;
  const daily = everyDueRecord ? await onceADay(env, now) : null;
  return { ...housekeeping, docs, illustrate, facts, purged, ...daily };
}

/** Items waiting this long for the site team go into the daily digest. */
const DIGEST_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * What runs once a UTC day, whoever calls first (the day's first cron run, or the admin): the
 * day's rechecks of places verified on a source that cannot stand alone, as many as the admin set,
 * and the digest of items waiting long for the site team, when a webhook is set.
 */
async function onceADay(env: Env, now: Date): Promise<{ source_rechecks: number; digest: number }> {
  const day = now.toISOString().slice(0, 10);
  const done = await env.DB.prepare(`SELECT value FROM settings WHERE scope = '*' AND key = 'daily-run'`).first<{ value: string }>();
  if (done?.value === day) return { source_rechecks: 0, digest: 0 };
  await putSetting(env.DB, 'daily-run', day, now).run();
  const daily = await weakSourceDaily(env.DB);
  const { queued } = daily > 0 ? await queueWeakSourceRechecks(env.DB, 'place', daily, now) : { queued: 0 };
  let digest = 0;
  if (env.REVIEW_DIGEST_WEBHOOK) {
    const waiting = (await reviewQueue(env.DB)).filter((item) => Date.parse(item.at) <= now.getTime() - DIGEST_AFTER_MS);
    if (waiting.length > 0) {
      const site = env.PUBLIC_URL ?? '';
      const lines = waiting.slice(0, 20).map((item) => `- ${item.record.kind} "${item.record.name}" (${item.record.id}), since ${item.at.slice(0, 10)}: ${item.reason.slice(0, 140)}`);
      const text = `London Chinese Food: ${waiting.length} ${waiting.length === 1 ? 'item has' : 'items have'} waited more than 3 days for the site team.\n${lines.join('\n')}${waiting.length > 20 ? `\n…and ${waiting.length - 20} more.` : ''}\n${site}/settings`;
      try {
        await fetch(env.REVIEW_DIGEST_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, msg_type: 'text', content: { text } }) });
        digest = waiting.length;
      } catch {
        digest = 0;
      }
    }
  }
  return { source_rechecks: queued, digest };
}

/**
 * Images of photos and illustrations rejected (or withdrawn) a month ago leave R2; a takedown
 * removes them at once. Run once a day, over the records that turned 30 days old since.
 */
async function purgeMedia(env: Env, now: Date): Promise<number> {
  const day = 24 * 60 * 60 * 1000;
  const { results } = await env.DB
    .prepare(
      `SELECT id, kind FROM records INDEXED BY records_age WHERE kind IN ('photo', 'illustration') AND status IN ('rejected', 'withdrawn')
         AND updated_at > ? AND updated_at <= ?`,
    )
    .bind(new Date(now.getTime() - 32 * day).toISOString(), new Date(now.getTime() - 30 * day).toISOString())
    .all<{ id: string; kind: MediaKind }>();
  for (const row of results) await deleteImage(env.MEDIA, row.kind, row.id);
  return results.length;
}

/** The scheduled run at the top of each UTC day, which looks at every due record. */
const firstRunOfDay = (now: Date) => now.getUTCHours() === 0 && now.getUTCMinutes() < 5;

app.post('/api/admin/maintenance', async (c) => c.json(await runCron(c.env, new Date(), true)));

/** Rebuilds pages at once: one place (?place=), or every dirty one. */
app.post('/api/admin/docs/rebuild', async (c) => {
  const place = c.req.query('place');
  const now = new Date();
  if (place) await rebuildNow(c.env.DB, [place], now);
  return c.json(place ? { rebuilt: 1 } : await refreshDocs(c.env.DB, now, { max: 200, whole: true }));
});

app.all('/api/*', () => {
  throw new HttpError(404, 'not_found', 'No such API route.');
});

/* ───────── files ───────── */

app.get('/SKILL.md', (c) => markdown(c, publicSkill(siteOf(c))));

/** The canonical site address: the public one, whatever host this request came to. */
const canonicalSite = (c: AppContext): string => (c.env.PUBLIC_URL ?? siteOf(c)).replace(/\/+$/, '');

app.get('/sitemap.xml', cachedFor(3600), async (c) => {
  await ensureSchema(c.env.DB);
  const places = JSON.parse(await dataset(c, 'index')) as IndexEntry[];
  const dishes = JSON.parse(await dataset(c, 'dishes')) as [string, string | null, string | null, number][];
  return c.body(sitemap(canonicalSite(c), places, dishes), 200, { 'content-type': 'application/xml; charset=utf-8' });
});

/** The open data: places and menus, CC BY 4.0. Rebuilt for each edge once an hour at most. */
const download = (c: AppContext, body: ReadableStream<Uint8Array>, type: string, name: string) =>
  c.body(body, 200, { 'content-type': type, 'content-disposition': `attachment; filename="${name}"`, 'access-control-allow-origin': '*' });

app.get('/export/places.csv', cachedFor(3600), async (c) => {
  await ensureSchema(c.env.DB);
  return download(c, placesCsv(c.env.DB, canonicalSite(c)), 'text/csv; charset=utf-8', 'london-chinese-food-places.csv');
});

app.get('/export/places.json', cachedFor(3600), async (c) => {
  await ensureSchema(c.env.DB);
  return download(c, placesJson(c.env.DB, canonicalSite(c), new Date()), 'application/json; charset=utf-8', 'london-chinese-food-places.json');
});

app.get('/export/menus.jsonl.gz', cachedFor(3600), async (c) => {
  await ensureSchema(c.env.DB);
  return download(c, menusJsonl(c.env.DB, canonicalSite(c), new Date()), 'application/gzip', 'london-chinese-food-menus.jsonl.gz');
});

/** "/" opens in the reader's language: their earlier choice, else their browser's. */
app.get('/', (c) => {
  const locale = preferredLocale(c.req.header('cookie'), c.req.header('accept-language'));
  return c.redirect(publicUrl(c, `/${locale}/`), 302);
});

/**
 * A page: the app's HTML with the page's own title, description, links and, for a place, its
 * structured data. A place that is not public answers 404, with the app's not-found page.
 */
async function page(c: AppContext): Promise<Response> {
  const url = new URL(c.req.url);
  const match = /^\/(zh|en)(\/.*)?$/.exec(url.pathname)!;
  const locale = match[1] as Locale;
  let rest = match[2] ?? '/';
  const html = await c.env.ASSETS.fetch(new Request(new URL('/', url), { headers: c.req.raw.headers }));
  const site = canonicalSite(c);
  const place = /^\/place\/(rec_[0-9a-z]{26})(?:\/[^/]*)?\/?$/.exec(rest);
  let meta;
  if (place) {
    await ensureSchema(c.env.DB);
    const json = await placeDoc(c.env.DB, place[1]!);
    const doc = json ? (JSON.parse(json) as PlaceDoc) : null;
    if (doc) rest = `/place/${doc.id}${doc.slug ? `/${doc.slug}` : ''}`;
    meta = placeMeta(doc, locale, rest, `${site}/${locale}${rest}`);
  } else meta = pathMeta(locale, rest);
  return withMeta(html, meta, site, onPublicHost(c.env, url), !/^(localhost|127\.0\.0\.1)$/.test(url.hostname));
}

app.get('/zh', page);
app.get('/en', page);
app.get('/zh/*', page);
app.get('/en/*', page);

// Anything else is a static file, or the app's page for a path it knows.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { app };

export default {
  fetch: withMount<Env>(app.fetch),
  async scheduled(_controller, env, ctx) {
    const now = new Date();
    ctx.waitUntil(ensureSchema(env.DB).then(() => runCron(env, now, firstRunOfDay(now))));
  },
} satisfies ExportedHandler<Env>;
