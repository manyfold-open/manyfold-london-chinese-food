/**
 * The two ways an image arrives (AGENTS.md, invariants 18–20), and the hints visitors send:
 *
 *   uploadPhoto          a visitor's photo of a public place (or up to ten pages of its menu),
 *                        from the site's form: checked cheapest first, Turnstile on the server,
 *                        the site's daily count last
 *   suggestMenuLink      a visitor's link to a place's menu online: a hint for collectors, never
 *                        published itself
 *   suggestPlace         a place a visitor says the site is missing: a lead for collectors, never
 *                        published itself
 *   uploadIllustration   an agent's generated picture of a standard dish, answering an
 *                        `illustrate` work item handed to it
 *
 * Both uploads re-encode the image (src/worker/media.ts), store only the re-encoded sizes, and
 * create a pending record with a verify task in one batch. If the batch fails, the stored images go.
 */

import { KIND_CONFIGS } from '../../kinds/index';
import { normDish } from '../shared/dish';
import { cleanText, findPostcode, normName, validateRecordData, type RecordData } from '../shared/kinds';
import { coreName, namesAlike } from '../shared/names';
import type { SuggestPlaceResponse } from '../shared/types';
import { newId, sha256Hex } from './ids';
import { deleteImage, encodeImage, ILLUSTRATION_RULES, PHOTO_RULES, storeImage, type Encoded, type MediaKind } from './media';
import { lookupPostcodes } from './postcodes';
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
/** Links kept on the lead visitors suggest for one place. */
export const LEAD_LINKS_MAX = 5;
/** Where visitors' leads wait among the others: a person said the place is there, so before the unqualified ones. */
export const VISITOR_LEAD_PRIORITY = 5;

/** A link a visitor sent, as a URL, or null when it is not the address of a page on the web. */
function webLink(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && raw.length <= 500 && url.hostname.includes('.') ? url : null;
}

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
  const url = webLink(typeof input.url === 'string' ? input.url.trim() : '');
  if (!url) throw new HttpError(422, 'invalid_url', 'Send the address of the menu online: a link starting with https://.');
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

/**
 * A place a visitor says the site is missing: its name and where it is, perhaps a page about it and
 * a note. It becomes a `lead` for collectors, as OpenStreetMap's and the FSA's do, and is never
 * shown itself: the place appears once a collector has found a page that shows its food and a
 * maintainer has checked it. A postcode in the address must be in Greater London. A public place at
 * that postcode with a name alike is answered with that place instead; one still waiting for review
 * needs no lead. The same suggestion twice is one lead, gathering its links, and a lead dismissed
 * before opens again only for a link it did not have.
 */
export async function suggestPlace(
  env: Env,
  input: Record<string, unknown>,
  context: { ip: string; hosts: readonly string[]; now: Date },
): Promise<SuggestPlaceResponse> {
  const visitor = await ipBucket(context.ip);
  await enforce(env.DB, [
    { scope: 'lead-hour', subject: visitor, rule: RULES.leadPerHour },
    { scope: 'lead-day', subject: visitor, rule: RULES.leadPerDay },
  ]);
  const text = (name: string) => (typeof input[name] === 'string' ? cleanText(input[name]) : '');
  const name = text('name');
  const where = text('where');
  const note = text('note');
  if (name.length < 2 || name.length > 120) throw new HttpError(422, 'invalid_body', "Send the place's name, in English or Chinese, as name: 2 to 120 characters.");
  if (where.length < 2 || where.length > 200) {
    throw new HttpError(422, 'invalid_body', 'Send where the place is as where: its address or postcode, or at least the street and area, in 2 to 200 characters.');
  }
  if (note.length > 300) throw new HttpError(422, 'invalid_body', 'Keep the note to 300 characters.');
  const raw = typeof input.url === 'string' ? input.url.trim() : '';
  const url = raw ? webLink(raw) : null;
  if (raw && !url) throw new HttpError(422, 'invalid_url', 'The link must be the address of a page about the place, starting with https://; or leave it out.');
  if (url && blockedBy(url.toString(), await blockedHosts(env.DB))) throw new HttpError(422, 'blocked_host', 'That site asked us not to quote it: send another link, or none.');

  const postcode = findPostcode(where);
  if (postcode) {
    const answer = (await lookupPostcodes(env.DB, [postcode], context.now)).get(postcode);
    if (answer === 'unknown') throw new HttpError(422, 'unknown_postcode', `No postcode ${postcode} is known: check it, or leave it out and give the street and area.`);
    if (answer && answer !== 'unavailable' && !answer.london) {
      throw new HttpError(422, 'outside_london', `${postcode} is not in Greater London, and the site lists places in Greater London only.`);
    }
    // Live places at that postcode, by the identity every place has (postcode|name): a range of
    // the identity index, whose conditions the query repeats so it can be used, not a scan.
    const { results } = await env.DB
      .prepare(
        `SELECT id, status, data_json FROM records INDEXED BY records_identity
         WHERE kind = 'place' AND identity_key >= ? AND identity_key < ? AND status IN ('pending', 'verified', 'stale') AND target_id IS NULL`,
      )
      .bind(`${postcode}|`, `${postcode}}`)
      .all<{ id: string; status: string; data_json: string }>();
    const alike = (other: unknown) => typeof other === 'string' && namesAlike({ name_en: name }, { name_en: other });
    const same = results
      .map((row) => ({ ...row, data: JSON.parse(row.data_json) as RecordData }))
      .sort((a, b) => Number(b.status !== 'pending') - Number(a.status !== 'pending'))
      .find((row) => alike(row.data.name_en) || alike(row.data.name_zh));
    if (same?.status === 'pending') return { status: 'received' };
    if (same) {
      const named = (value: unknown) => (typeof value === 'string' ? value : null);
      return { status: 'listed', place: { id: same.id, name_en: named(same.data.name_en), name_zh: named(same.data.name_zh) } };
    }
  }

  const answer = typeof input['cf-turnstile-response'] === 'string' ? input['cf-turnstile-response'] : '';
  const verdict = await verifyTurnstile(env.TURNSTILE_SECRET, answer, { ip: context.ip, hosts: context.hosts, idempotencyKey: crypto.randomUUID() });
  if (!verdict.ok) throw new HttpError(403, 'turnstile_failed', verdict.reason);
  // The site's daily bound comes last: a suggestion refused for any other reason never uses it up.
  await enforce(env.DB, [{ scope: 'leads-day', subject: 'site', rule: RULES.leadsPerDay }]);

  const subject = `visitor:${(await sha256Hex(`${postcode ?? normName(where)}|${coreName({ name_en: name }) || normName(name)}`)).slice(0, 24)}`;
  const link = url?.toString() ?? null;
  const hint = `A visitor suggested it on the site${note ? `, writing: "${note}"` : '.'}`;
  const at = context.now.toISOString();
  const existing = await env.DB
    .prepare(`SELECT status, payload_json FROM work_items WHERE type = 'lead' AND subject = ?`)
    .bind(subject)
    .first<{ status: string; payload_json: string | null }>();
  if (!existing) {
    const payload = { name, address: where, ...(postcode ? { postcode } : {}), hint, ...(link ? { sources: [link] } : {}) };
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
         VALUES (?, 'lead', ?, ?, ?, 'open', ?, ?)`,
      )
      .bind(newId('wrk', context.now.getTime()), subject, VISITOR_LEAD_PRIORITY, JSON.stringify(payload), at, at)
      .run();
    return { status: 'received' };
  }
  const before = (existing.payload_json ? JSON.parse(existing.payload_json) : {}) as Record<string, unknown>;
  const known = Array.isArray(before.sources) ? before.sources.filter((source): source is string => typeof source === 'string') : [];
  const fresh = link !== null && !known.includes(link);
  // Answered already (the place was listed from it), or dismissed and told nothing new: left as it is.
  if (existing.status === 'done' || (existing.status === 'dismissed' && !fresh)) return { status: 'received' };
  const payload = { ...before, ...(note ? { hint } : {}), ...(fresh ? { sources: [...known, link].slice(-LEAD_LINKS_MAX) } : {}) };
  await env.DB
    .prepare(
      existing.status === 'dismissed'
        ? `UPDATE work_items SET payload_json = ?, status = 'open', handed_to = NULL, handed_until = NULL, record_id = NULL, note = NULL, updated_at = ?
           WHERE type = 'lead' AND subject = ?`
        : `UPDATE work_items SET payload_json = ?, updated_at = ? WHERE type = 'lead' AND subject = ?`,
    )
    .bind(JSON.stringify(payload), at, subject)
    .run();
  return { status: 'received' };
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
