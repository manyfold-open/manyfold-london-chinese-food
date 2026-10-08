/**
 * AI illustrations as work (AGENTS.md, invariant 18). The Worker calls no image model: it keeps
 * an `illustrate` work item open for every standard dish places serve that has no illustration,
 * most served first, with the prompt to use, and agents generate and upload them
 * (src/worker/uploads.ts). A maintainer looks at each; an approved one becomes its dish's picture
 * (src/worker/effects.ts) wherever no real photo of that dish at that place exists.
 */

import { CUISINE_LABELS } from '../../kinds/vocab';
import { standardDish } from '../shared/dish';
import { cleanText } from '../shared/kinds';
import { decide } from './console';
import { illustrationSettings, putSetting, type IllustrationSettings } from './settings';
import { HttpError } from './types';

/** How many dishes one run looks at for missing work items. */
const SYNC_MAX = 200;

/** The prompt for a dish, from the template the admin can edit. */
export function promptFor(template: string, dish: { key: string; zh: string | null; en: string | null }, note?: string | null): string {
  const entry = standardDish(dish.zh) ?? standardDish(dish.en) ?? standardDish(dish.key);
  const zh = entry?.zh ?? dish.zh ?? dish.key;
  const en = entry?.en ?? dish.en ?? zh;
  const cuisine = entry ? (CUISINE_LABELS[entry.cuisine]?.en ?? 'Chinese') : 'Chinese';
  const description = entry?.description ?? `A typical serving of ${en}.`;
  const prompt = template.replaceAll('{zh}', zh).replaceAll('{en}', en).replaceAll('{cuisine}', cuisine).replaceAll('{description}', description);
  return note ? `${prompt} Note from the last review: ${note}` : prompt;
}

/**
 * Opens a work item for each served dish with no illustration and none waiting, and refreshes the
 * priority (how many places serve it) of open ones. Items being worked on are left alone.
 */
export async function syncIllustrateWork(db: D1Database, now: Date): Promise<number> {
  const settings = await illustrationSettings(db);
  if (!settings.requested) return 0;
  const { results } = await db
    .prepare(
      `SELECT dish_key, name_zh, name_en, places FROM dishes INDEXED BY dishes_unillustrated
       WHERE illustration_id IS NULL AND places > 0 ORDER BY places DESC LIMIT ?`,
    )
    .bind(SYNC_MAX)
    .all<{ dish_key: string; name_zh: string | null; name_en: string | null; places: number }>();
  if (results.length === 0) return 0;
  const at = now.toISOString();
  const statements = results.map((dish) => {
    const entry = standardDish(dish.name_zh) ?? standardDish(dish.dish_key);
    const payload = {
      dish: dish.dish_key,
      name_zh: entry?.zh ?? dish.name_zh,
      name_en: entry?.en ?? dish.name_en,
      description: entry?.description ?? null,
      prompt: promptFor(settings.template, { key: dish.dish_key, zh: dish.name_zh, en: dish.name_en }),
      size: 'square, at least 1024 x 1024 pixels',
    };
    return db
      .prepare(
        `INSERT INTO work_items (id, type, subject, priority, payload_json, status, created_at, updated_at)
         VALUES ('wrk_' || lower(hex(randomblob(13))), 'illustrate', ?1, ?2, ?3, 'open', ?4, ?4)
         ON CONFLICT (type, subject) DO UPDATE SET priority = excluded.priority, updated_at = excluded.updated_at
           WHERE work_items.status = 'open' AND work_items.priority != excluded.priority`,
      )
      .bind(dish.dish_key, dish.places, JSON.stringify(payload), at);
  });
  const outcomes = await db.batch(statements);
  return outcomes.reduce((sum, outcome) => sum + Number(outcome.meta?.changes ?? 0), 0);
}

/**
 * The admin replaces a dish's illustration: the current one is rejected (off the site at once),
 * and its work item opens again with the admin's note in the prompt, for the next agent.
 */
export async function replaceIllustration(db: D1Database, id: string, body: { note?: unknown }, now: Date): Promise<{ reopened: boolean }> {
  const note = typeof body.note === 'string' ? cleanText(body.note).slice(0, 300) : '';
  const record = await db.prepare(`SELECT identity_key, status, data_json FROM records WHERE id = ? AND kind = 'illustration'`).bind(id).first<{ identity_key: string; status: string; data_json: string }>();
  if (!record) throw new HttpError(404, 'not_found', 'No illustration has that id.');
  if (record.status !== 'rejected') await decide(db, id, { status: 'rejected', reason: `Replaced by the admin${note ? `: ${note}` : ''}` }, now);
  const settings = await illustrationSettings(db);
  const data = JSON.parse(record.data_json) as { dish?: string };
  const prompt = promptFor(settings.template, { key: record.identity_key, zh: data.dish ?? null, en: null }, note || null);
  const result = await db
    .prepare(
      `UPDATE work_items SET status = 'open', handed_to = NULL, handed_until = NULL, record_id = NULL, note = ?,
         payload_json = json_set(coalesce(payload_json, '{}'), '$.prompt', ?), updated_at = ?
       WHERE type = 'illustrate' AND subject = ?`,
    )
    .bind(note || 'The last illustration was replaced.', prompt, now.toISOString(), record.identity_key)
    .run();
  return { reopened: Number(result.meta.changes ?? 0) > 0 };
}

/** The admin changes how illustrations are handled. */
export async function updateIllustrationSettings(db: D1Database, patch: Record<string, unknown>, now: Date): Promise<IllustrationSettings> {
  const current = await illustrationSettings(db);
  const next = { ...current };
  if (patch.shown !== undefined) {
    if (typeof patch.shown !== 'boolean') throw new HttpError(422, 'invalid_body', 'shown must be true or false.');
    next.shown = patch.shown;
  }
  if (patch.requested !== undefined) {
    if (typeof patch.requested !== 'boolean') throw new HttpError(422, 'invalid_body', 'requested must be true or false.');
    next.requested = patch.requested;
  }
  if (patch.daily !== undefined) {
    if (typeof patch.daily !== 'number' || !Number.isInteger(patch.daily) || patch.daily < 0 || patch.daily > 5000) {
      throw new HttpError(422, 'invalid_body', 'daily must be a whole number from 0 to 5000.');
    }
    next.daily = patch.daily;
  }
  if (patch.template !== undefined) {
    if (typeof patch.template !== 'string' || !patch.template.includes('{en}') || patch.template.length > 1000) {
      throw new HttpError(422, 'invalid_body', 'template must be at most 1000 characters and include {en}; {zh}, {cuisine} and {description} are filled in too.');
    }
    next.template = patch.template;
  }
  await putSetting(db, 'illustrations', JSON.stringify(next), now).run();
  return next;
}
