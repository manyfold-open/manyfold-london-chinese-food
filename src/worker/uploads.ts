/**
 * The two ways an image arrives (AGENTS.md, invariants 18–20):
 *
 *   uploadPhoto          a visitor's photo of a public place (or up to ten pages of its menu),
 *                        from the site's form: checked cheapest first, Turnstile on the server,
 *                        the site's daily count last
 *   suggestMenuLink      a visitor's link to a place's menu online: a hint for collectors, never
 *                        published itself
 *   uploadIllustration   an agent's generated picture of a standard dish, answering an
 *                        `illustrate` work item handed to it
 *
 * Both re-encode the image (src/worker/media.ts), store only the re-encoded sizes, and create a
 * pending record with a verify task in one batch. If the batch fails, the stored images go.
 */

import { KIND_CONFIGS } from '../../kinds/index';
import { normDish } from '../shared/dish';
import { cleanText, validateRecordData, type RecordData } from '../shared/kinds';
import { newId, sha256Hex } from './ids';
import { deleteImage, encodeImage, ILLUSTRATION_RULES, PHOTO_RULES, storeImage, type Encoded, type MediaKind } from './media';
import { blockedBy, blockedHosts } from './settings';
import { enforce, RULES } from './ratelimit';
import { standing, type Token } from './tokens';
import { verifyTurnstile } from './turnstile';
import { HttpError, type Env } from './types';

export const PHOTO_BYTES_MAX = 15 * 1024 * 1024;
export const ILLUSTRATION_BYTES_MAX = 10 * 1024 * 1024;
/** The pages of one menu a visitor may send together, and all of them at most this big. */
export const MENU_PAGES_MAX = 10;
const UPLOAD_BYTES_MAX = 60 * 1024 * 1024;
/** Links to one place's menu kept for collectors. */
export const MENU_LINKS_MAX = 5;

const field = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() ? value : undefined;
};

/** The IP as rate limits count it: hashed, so no address is stored. */
export const ipBucket = async (ip: string): Promise<string> => (await sha256Hex(`ip:${ip}`)).slice(0, 20);

function fileOf(form: FormData, max: number): File {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new HttpError(422, 'invalid_body', 'Send the image as the multipart field "file".');
  if (file.size > max) throw new HttpError(413, 'too_large', `The image must be at most ${Math.round(max / 1024 / 1024)} MB.`);
  return file;
}

/** The images of a multipart field, at most `most` of them, each within `max` bytes. */
function filesOf(form: FormData, max: number, most: number): File[] {
  const files = form.getAll('file').filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) throw new HttpError(422, 'invalid_body', 'Send the image as the multipart field "file".');
  if (files.length > most) {
    throw new HttpError(422, 'invalid_body', most === 1 ? 'Send one photo at a time; only the pages of a menu go together.' : `Send at most ${most} pages of a menu at once.`);
  }
  for (const file of files) if (file.size > max) throw new HttpError(413, 'too_large', `Each image must be at most ${Math.round(max / 1024 / 1024)} MB.`);
  return files;
}

function imageRecordStatements(
  env: Env,
  kind: MediaKind,
  id: string,
  row: { parentId: string | null; identity: string; data: RecordData; submittedBy: string; workItem?: string; tokenId?: string },
  now: Date,
): D1PreparedStatement[] {
  const at = now.toISOString();
  const statements = [
    env.DB
      .prepare(
        `INSERT INTO records (id, kind, parent_id, root_id, identity_key, status, data_json, source_url, evidence, observed_at, submitted_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, '', '', ?, ?, ?, ?)`,
      )
      .bind(id, kind, row.parentId, row.parentId, row.identity, JSON.stringify(row.data), at, row.submittedBy, at, at),
    env.DB
      .prepare(`INSERT INTO revisions (record_id, kind, actor, action, after_json, created_at) VALUES (?, ?, ?, 'submit', ?, ?)`)
      .bind(id, kind, row.submittedBy, JSON.stringify({ status: 'pending', data: row.data }), at),
    env.DB
      .prepare(`INSERT INTO tasks (id, record_id, record_kind, type, status, created_at) VALUES (?, ?, ?, 'verify', 'open', ?)`)
      .bind(newId('tsk', now.getTime()), id, kind, at),
  ];
  if (row.workItem) {
    statements.push(
      env.DB
        .prepare(`UPDATE work_items SET status = 'submitted', record_id = ?, updated_at = ? WHERE id = ? AND handed_to = ? AND status = 'open'`)
        .bind(id, at, row.workItem, row.tokenId ?? ''),
    );
  }
  return statements;
}

async function insertImageRecord(env: Env, kind: MediaKind, id: string, row: Parameters<typeof imageRecordStatements>[3], now: Date): Promise<void> {
  await env.DB.batch(imageRecordStatements(env, kind, id, row, now));
}

/** A visitor's photo of a public place, or the pages of its menu (one record each, one set). */
export async function uploadPhoto(
  env: Env,
  placeId: string,
  request: Request,
  context: { ip: string; hosts: readonly string[]; now: Date },
): Promise<{ id: string; ids: string[]; status: 'pending' }> {
  const { now } = context;
  const subject = await ipBucket(context.ip);
  await enforce(env.DB, [
    { scope: 'photo-hour', subject, rule: RULES.photoPerHour },
    { scope: 'photo-day', subject, rule: RULES.photoPerDay },
  ]);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > UPLOAD_BYTES_MAX + 100_000) throw new HttpError(413, 'too_large', 'Send at most 60 MB at once.');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'bad_form', 'Send the photo as multipart/form-data.');
  }
  const files = filesOf(form, PHOTO_BYTES_MAX, field(form, 'subject') === 'menu' ? MENU_PAGES_MAX : 1);
  if (field(form, 'license') !== 'CC-BY-4.0') {
    throw new HttpError(422, 'license_required', 'To share a photo here, agree to publish it under CC BY 4.0: tick the box.');
  }
  const config = KIND_CONFIGS.photo;
  const input: Record<string, unknown> = { place: placeId, subject: field(form, 'subject') };
  for (const name of ['dish_name', 'caption', 'attribution']) {
    const value = field(form, name);
    if (value !== undefined) input[name] = value;
  }
  const checked = validateRecordData(config, input);
  if (!checked.ok) throw new HttpError(422, 'invalid_body', checked.errors.map((error) => `${error.field} ${error.message}`).join('; '));
  const place = await env.DB.prepare(`SELECT status FROM records WHERE id = ? AND kind = 'place'`).bind(placeId).first<{ status: string }>();
  if (!place || (place.status !== 'verified' && place.status !== 'stale')) throw new HttpError(404, 'not_found', 'No public place has that id.');

  const verdict = await verifyTurnstile(env.TURNSTILE_SECRET, field(form, 'cf-turnstile-response') ?? '', {
    ip: context.ip,
    hosts: context.hosts,
    idempotencyKey: crypto.randomUUID(),
  });
  if (!verdict.ok) throw new HttpError(403, 'turnstile_failed', verdict.reason);
  // The site's daily bound comes last: an upload refused for any other reason never uses it up.
  // Every page counts: each is a photo for maintainers to look at.
  for (let page = 0; page < files.length; page += 1) await enforce(env.DB, [{ scope: 'photos-day', subject: 'site', rule: RULES.photosPerDay }]);

  // Every page is re-encoded before any is kept: one that is not a usable image refuses them all.
  const encoded: Encoded[] = [];
  for (const file of files) encoded.push(await encodeImage(env.IMAGES, file, PHOTO_RULES));
  const ids = encoded.map(() => newId('rec', now.getTime()));
  const stored: string[] = [];
  try {
    for (const [index, image] of encoded.entries()) {
      await storeImage(env.MEDIA, 'photo', ids[index]!, image);
      stored.push(ids[index]!);
    }
    await env.DB.batch(
      encoded.flatMap((image, index) => {
        const data: RecordData = {
          ...checked.value,
          width: image.width,
          height: image.height,
          license: 'CC-BY-4.0',
          ...(encoded.length > 1 ? { set: ids[0]!, page_no: index + 1 } : {}),
        };
        return imageRecordStatements(env, 'photo', ids[index]!, { parentId: placeId, identity: ids[index]!, data, submittedBy: 'visitor' }, now);
      }),
    );
  } catch (error) {
    for (const id of stored) await deleteImage(env.MEDIA, 'photo', id);
    throw error;
  }
  return { id: ids[0]!, ids, status: 'pending' };
}

/**
 * A visitor's link to a place's menu online (a page, PDF or image): it joins the place's
 * `menu-link` work item for collectors to transcribe. Links are never shown; the menu typed up from
 * one is, once a maintainer has checked it against the link.
 */
export async function suggestMenuLink(
  env: Env,
  placeId: string,
  input: Record<string, unknown>,
  context: { ip: string; hosts: readonly string[]; now: Date },
): Promise<{ status: 'received'; links: number }> {
  const subject = await ipBucket(context.ip);
  await enforce(env.DB, [
    { scope: 'menu-link-hour', subject, rule: RULES.menuLinkPerHour },
    { scope: 'menu-link-day', subject, rule: RULES.menuLinkPerDay },
  ]);
  const raw = typeof input.url === 'string' ? input.url.trim() : '';
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || raw.length > 500 || !url.hostname.includes('.')) {
    throw new HttpError(422, 'invalid_url', 'Send the address of the menu online: a link starting with https://.');
  }
  if (blockedBy(url.toString(), await blockedHosts(env.DB))) throw new HttpError(422, 'blocked_host', 'That site asked us not to quote it.');
  const place = await env.DB
    .prepare(`SELECT status, data_json FROM records WHERE id = ? AND kind = 'place'`)
    .bind(placeId)
    .first<{ status: string; data_json: string }>();
  if (!place || (place.status !== 'verified' && place.status !== 'stale')) throw new HttpError(404, 'not_found', 'No public place has that id.');

  const answer = typeof input['cf-turnstile-response'] === 'string' ? input['cf-turnstile-response'] : '';
  const verdict = await verifyTurnstile(env.TURNSTILE_SECRET, answer, { ip: context.ip, hosts: context.hosts, idempotencyKey: crypto.randomUUID() });
  if (!verdict.ok) throw new HttpError(403, 'turnstile_failed', verdict.reason);

  const data = JSON.parse(place.data_json) as RecordData;
  const brand = typeof data.brand === 'string' ? data.brand : null;
  const [existing, menus] = await env.DB.batch([
    env.DB.prepare(`SELECT payload_json FROM work_items WHERE type = 'menu-link' AND subject = ?`).bind(placeId),
    env.DB
      .prepare(`SELECT id FROM records INDEXED BY records_children WHERE parent_id IN (?, ?) AND kind = 'menu' AND status IN ('verified', 'stale')`)
      .bind(placeId, brand ?? placeId),
  ]);
  const before = ((existing?.results[0] as { payload_json: string | null } | undefined)?.payload_json ?? null);
  const known = before ? ((JSON.parse(before) as { links?: string[] }).links ?? []) : [];
  const link = url.toString();
  const links = [...known.filter((other) => other !== link), link].slice(-MENU_LINKS_MAX);
  const payload = {
    place: placeId,
    name: data.name_en ?? data.name_zh ?? null,
    postcode: data.postcode ?? null,
    links,
    // A place that has a menu: compare, and send an update if it changed.
    menus: ((menus?.results ?? []) as { id: string }[]).map((menu) => menu.id),
  };
  const at = context.now.toISOString();
  await env.DB
    .prepare(
      `INSERT INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
       VALUES (?, 'menu-link', ?, 8, ?, 'open', ?, ?)
       ON CONFLICT (type, subject) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at,
         status = CASE WHEN work_items.status IN ('done', 'dismissed') THEN 'open' ELSE work_items.status END,
         record_id = CASE WHEN work_items.status IN ('done', 'dismissed') THEN NULL ELSE work_items.record_id END,
         note = CASE WHEN work_items.status IN ('done', 'dismissed') THEN NULL ELSE work_items.note END`,
    )
    .bind(newId('wrk', context.now.getTime()), placeId, JSON.stringify(payload), at, at)
    .run();
  return { status: 'received', links: links.length };
}

/** An agent's illustration of a standard dish, answering a work item it holds. */
export async function uploadIllustration(env: Env, token: Token, request: Request, now: Date): Promise<{ id: string; status: 'pending' }> {
  await enforce(env.DB, [{ scope: 'illustration', subject: token.id, rule: RULES.illustrationPerHour }]);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'bad_form', 'Send the illustration as multipart/form-data with fields work_item, dish, model, prompt and file.');
  }
  const workItem = field(form, 'work_item') ?? '';
  const dish = cleanText(field(form, 'dish') ?? '');
  const item = await env.DB
    .prepare(`SELECT subject, handed_to, handed_until, status, note FROM work_items WHERE id = ? AND type = 'illustrate'`)
    .bind(workItem)
    .first<{ subject: string; handed_to: string | null; handed_until: string | null; status: string; note: string | null }>();
  if (item?.status === 'dismissed') throw new HttpError(422, 'invalid_body', `work_item ${workItem} is closed. ${item.note ?? ''} Ask for others with GET /api/work?type=illustrate.`);
  if (!item || item.handed_to !== token.id || item.status !== 'open' || !item.handed_until || item.handed_until <= now.toISOString()) {
    throw new HttpError(422, 'invalid_body', 'work_item must be an illustrate item you hold now; ask for one with GET /api/work?type=illustrate.');
  }
  if (normDish(dish) !== item.subject) throw new HttpError(422, 'invalid_body', `dish must be the work item's dish exactly; it is for "${item.subject}".`);

  const config = KIND_CONFIGS.illustration;
  const checked = validateRecordData(config, { dish, model: field(form, 'model'), prompt: field(form, 'prompt') });
  if (!checked.ok) throw new HttpError(422, 'invalid_body', checked.errors.map((error) => `${error.field} ${error.message}`).join('; '));
  const mine = await standing(env.DB, token, 'illustration', now);
  if (mine.pending >= mine.pending_cap) {
    throw new HttpError(429, 'over_cap', `You have ${mine.pending} illustrations waiting for review, which is your limit. Upload more once some are reviewed.`);
  }
  const file = fileOf(form, ILLUSTRATION_BYTES_MAX);
  const encoded = await encodeImage(env.IMAGES, file, ILLUSTRATION_RULES);
  const id = newId('rec', now.getTime());
  await storeImage(env.MEDIA, 'illustration', id, encoded);
  try {
    await insertImageRecord(
      env,
      'illustration',
      id,
      { parentId: null, identity: item.subject, data: { ...checked.value, width: encoded.width, height: encoded.height }, submittedBy: token.id, workItem, tokenId: token.id },
      now,
    );
  } catch (error) {
    await deleteImage(env.MEDIA, 'illustration', id);
    if (/UNIQUE/i.test(String(error))) throw new HttpError(409, 'duplicate', 'This dish already has an illustration waiting for review or approved.');
    throw error;
  }
  return { id, status: 'pending' };
}
