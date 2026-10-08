/**
 * The two ways an image arrives (AGENTS.md, invariants 18–20):
 *
 *   uploadPhoto          a visitor's photo of a public place, from the site's form: checked
 *                        cheapest first, Turnstile on the server, the site's daily count last
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
import { deleteImage, encodeImage, ILLUSTRATION_RULES, PHOTO_RULES, storeImage, type MediaKind } from './media';
import { enforce, RULES } from './ratelimit';
import { standing, type Token } from './tokens';
import { verifyTurnstile } from './turnstile';
import { HttpError, type Env } from './types';

export const PHOTO_BYTES_MAX = 15 * 1024 * 1024;
export const ILLUSTRATION_BYTES_MAX = 10 * 1024 * 1024;

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

async function insertImageRecord(
  env: Env,
  kind: MediaKind,
  id: string,
  row: { parentId: string | null; identity: string; data: RecordData; submittedBy: string; workItem?: string; tokenId?: string },
  now: Date,
): Promise<void> {
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
  await env.DB.batch(statements);
}

/** A visitor's photo of a public place. */
export async function uploadPhoto(
  env: Env,
  placeId: string,
  request: Request,
  context: { ip: string; hosts: readonly string[]; now: Date },
): Promise<{ id: string; status: 'pending' }> {
  const { now } = context;
  const subject = await ipBucket(context.ip);
  await enforce(env.DB, [
    { scope: 'photo-hour', subject, rule: RULES.photoPerHour },
    { scope: 'photo-day', subject, rule: RULES.photoPerDay },
  ]);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > PHOTO_BYTES_MAX + 100_000) throw new HttpError(413, 'too_large', 'The photo must be at most 15 MB.');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'bad_form', 'Send the photo as multipart/form-data.');
  }
  const file = fileOf(form, PHOTO_BYTES_MAX);
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
  await enforce(env.DB, [{ scope: 'photos-day', subject: 'site', rule: RULES.photosPerDay }]);

  const encoded = await encodeImage(env.IMAGES, file, PHOTO_RULES);
  const id = newId('rec', now.getTime());
  await storeImage(env.MEDIA, 'photo', id, encoded);
  const data: RecordData = { ...checked.value, width: encoded.width, height: encoded.height, license: 'CC-BY-4.0' };
  try {
    await insertImageRecord(env, 'photo', id, { parentId: placeId, identity: id, data, submittedBy: 'visitor' }, now);
  } catch (error) {
    await deleteImage(env.MEDIA, 'photo', id);
    throw error;
  }
  return { id, status: 'pending' };
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
    .prepare(`SELECT subject, handed_to, handed_until, status FROM work_items WHERE id = ? AND type = 'illustrate'`)
    .bind(workItem)
    .first<{ subject: string; handed_to: string | null; handed_until: string | null; status: string }>();
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
